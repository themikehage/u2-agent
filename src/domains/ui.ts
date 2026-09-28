import { z } from "zod";
import { createHash } from "node:crypto";
import * as path from "node:path";
import type { DomainSpec } from "../registry";
import { DeviceSession } from "../runtime/device";
import { selectTargetDevice, execAdb } from "../runtime/adb";
import type { ActionElement } from "../models";
import { parseSelectorArgs, parseBoundsRect } from "../selectors/parser";
import { resolveSelector, rectOverlapRatio, OVERLAP_MERGE } from "../selectors/resolver";
import { SelectorNotFoundError, TimeoutError, UsageError, U2Error, ExitCode } from "../errors";
import { DaemonClient } from "../daemon/client";

export interface ParsedNotification {
  package: string;
  title: string;
  text: string;
}

export function parseNotificationDumpsys(raw: string): ParsedNotification[] {
  const notifs: ParsedNotification[] = [];
  const records = raw.split(/NotificationRecord\(|Notification\s*\{/i);

  for (const block of records) {
    if (!block.trim()) continue;

    const pkgMatch = block.match(/pkg=([^\s,}]+)/i) || block.match(/package=([^\s,}]+)/i);
    const pkg = pkgMatch ? pkgMatch[1] : "";
    if (!pkg || pkg === "com.android.systemui") continue;

    let title = "";
    const titleMatch =
      block.match(/android\.title=(?:String|CharSequence)\s*\(([^)]*)\)/i) ||
      block.match(/android\.title=([^\n,]+)/i);
    if (titleMatch) title = titleMatch[1].trim();

    let text = "";
    const textMatch =
      block.match(/android\.text=(?:String|CharSequence)\s*\(([^)]*)\)/i) ||
      block.match(/android\.bigText=(?:String|CharSequence)\s*\(([^)]*)\)/i) ||
      block.match(/tickerText=([^\n,]+)/i);
    if (textMatch) text = textMatch[1].trim();

    if (title || text) {
      notifs.push({ package: pkg, title, text });
    }
  }

  const unique: ParsedNotification[] = [];
  const seen = new Set<string>();
  for (const n of notifs) {
    const key = `${n.package}:${n.title}:${n.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(n);
    }
  }

  return unique;
}

const ACTIONABLE_CLASSES = new Set([
  "android.widget.Button",
  "android.widget.ImageButton",
  "android.widget.CheckBox",
  "android.widget.RadioButton",
  "android.widget.Switch",
  "android.widget.EditText",
  "Button",
  "ImageButton",
  "CheckBox",
  "RadioButton",
  "Switch",
  "EditText",
]);

const DEFAULT_FILTER_PACKAGES = new Set([
  "com.android.systemui",
  "com.google.android.inputmethod.latin",
  "com.samsung.android.honeyboard",
  "com.swiftkey.swiftkeyapp",
  "com.baidu.input",
  "com.iflytek.inputmethod",
]);

export function computeScreenFingerprint(elements: ActionElement[]): string {
  const tuples = elements.map(
    (e) => `${e.resourceId}:${e.text}:${e.contentDesc}:${e.className}:${e.bounds}`
  );
  tuples.sort();
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (const t of tuples) {
    for (let i = 0; i < t.length; i++) {
      const code = t.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 0x01000193);
      h2 = Math.imul(h2 ^ (code >> 4), 0x01000193);
    }
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const part2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${part1}${part2}`;
}

const STRUCTURAL_CLASSES = new Set([
  "android.widget.FrameLayout",
  "android.widget.LinearLayout",
  "android.widget.RelativeLayout",
  "androidx.recyclerview.widget.RecyclerView",
  "androidx.recyclerview.widget.StaggeredGridLayoutManager",
  "android.view.ViewGroup",
  "android.view.View",
  "FrameLayout",
  "LinearLayout",
  "RelativeLayout",
  "RecyclerView",
  "StaggeredGridLayoutManager",
  "ViewGroup",
]);

export function getSemanticRole(el: ActionElement): string {
  const cls = el.className || "";
  const resId = (el.resourceId || "").toLowerCase();
  const text = el.text || el.contentDesc || "";
  
  if (cls.endsWith("EditText")) return "Input";
  if (cls.endsWith("Switch") || cls.endsWith("CheckBox") || cls.endsWith("RadioButton")) return "Toggle";
  if (cls.includes("Tab") || resId.includes("tab") || (text.length <= 20 && text.toLowerCase().includes("tab"))) return "Tab";
  if (cls.endsWith("Button") || cls.endsWith("ImageButton")) return "Button";
  if (cls.endsWith("TextView")) {
    return el.clickable ? "Button" : "Text";
  }
  if (el.clickable) return "Button";
  return text ? "Item" : "Element";
}

export function deduplicateAndFilterElements(elements: ActionElement[]): ActionElement[] {
  const filtered = elements.filter((el) => {
    const hasText = Boolean((el.text && el.text.trim()) || (el.contentDesc && el.contentDesc.trim()));
    if (!hasText) {
      const clsName = el.className || "";
      if (STRUCTURAL_CLASSES.has(clsName) || clsName.endsWith("Manager") || clsName.endsWith("Layout")) {
        return false;
      }
    }
    return true;
  });

  const elementRects = filtered.map((el) => parseBoundsRect(el.bounds));
  const result: ActionElement[] = [];
  const resultRects: (ReturnType<typeof parseBoundsRect>)[] = [];

  const CELL_SIZE = 150;
  const grid = new Map<string, number[]>();

  const getCellKeys = (rect: ReturnType<typeof parseBoundsRect>) => {
    if (!rect) return [];
    const minX = Math.floor(rect.x1 / CELL_SIZE);
    const maxX = Math.floor(rect.x2 / CELL_SIZE);
    const minY = Math.floor(rect.y1 / CELL_SIZE);
    const maxY = Math.floor(rect.y2 / CELL_SIZE);
    const keys: string[] = [];
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        keys.push(`${x},${y}`);
      }
    }
    return keys;
  };

  for (let idx = 0; idx < filtered.length; idx++) {
    const current = filtered[idx];
    const currentRect = elementRects[idx];
    if (!currentRect) {
      result.push(current);
      resultRects.push(null);
      continue;
    }

    const cellKeys = getCellKeys(currentRect);
    const candidateIndices = new Set<number>();
    for (const key of cellKeys) {
      const existingInCell = grid.get(key);
      if (existingInCell) {
        for (const i of existingInCell) candidateIndices.add(i);
      }
    }

    let merged = false;
    for (const i of candidateIndices) {
      const existingRect = resultRects[i];
      if (!existingRect) continue;

      const area1 = (currentRect.x2 - currentRect.x1) * (currentRect.y2 - currentRect.y1);
      const area2 = (existingRect.x2 - existingRect.x1) * (existingRect.y2 - existingRect.y1);
      const minArea = Math.min(area1, area2);
      const maxArea = Math.max(area1, area2);
      const sizeRatio = maxArea / Math.max(minArea, 1);

      const existing = result[i];
      const existingText = (existing.text || existing.contentDesc || "").trim();
      const currentText = (current.text || current.contentDesc || "").trim();

      // Never merge two elements with distinct non-empty labels
      if (existingText && currentText && existingText !== currentText) {
        continue;
      }

      // Check if both elements have the exact same non-empty label (e.g. parent Button + child Item)
      const sameLabel = Boolean(existingText && currentText && existingText === currentText);

      // Do not merge elements of vastly different sizes UNLESS they share the exact same non-empty label (ancestor-descendant duplicate)
      if (sizeRatio > 2.5 && !sameLabel) {
        continue;
      }

      const overlap = rectOverlapRatio(currentRect, existingRect);
      const isContained = (inner: { x1: number; y1: number; x2: number; y2: number }, outer: { x1: number; y1: number; x2: number; y2: number }) =>
        inner.x1 >= outer.x1 - 10 && inner.y1 >= outer.y1 - 10 && inner.x2 <= outer.x2 + 10 && inner.y2 <= outer.y2 + 10;

      const shouldMerge = overlap >= OVERLAP_MERGE || (sameLabel && (overlap >= 0.3 || isContained(currentRect, existingRect) || isContained(existingRect, currentRect)));

      if (shouldMerge) {
        const existingHasText = Boolean(existingText);
        const currentHasText = Boolean(currentText);
        const existingHasAction = existing.clickable || existing.className?.endsWith("Button") || existing.className?.endsWith("EditText");
        const currentHasAction = current.clickable || current.className?.endsWith("Button") || current.className?.endsWith("EditText");

        if ((!existingHasText && currentHasText) || (!existingHasAction && currentHasAction)) {
          result[i] = {
            ...current,
            index: existing.index,
            ref: existing.ref,
            clickable: existing.clickable || current.clickable,
            focused: existing.focused || current.focused,
          };
          resultRects[i] = currentRect;
        } else {
          result[i] = {
            ...existing,
            clickable: existing.clickable || current.clickable,
            focused: existing.focused || current.focused,
          };
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      const newIndex = result.length;
      result.push(current);
      resultRects.push(currentRect);
      for (const key of cellKeys) {
        let cell = grid.get(key);
        if (!cell) {
          cell = [];
          grid.set(key, cell);
        }
        cell.push(newIndex);
      }
    }
  }

  return result.map((el, idx) => ({
    ...el,
    index: idx,
    ref: `@${idx + 1}`,
  }));
}

export function sortByRelevance(
  elements: ActionElement[],
  screenWidth: number = 1080,
  screenHeight: number = 2340
): ActionElement[] {
  const centerX = screenWidth / 2;
  const centerY = screenHeight / 2;

  const sorted = [...elements].sort((a, b) => {
    // 1. Focused element first
    if (a.focused && !b.focused) return -1;
    if (!a.focused && b.focused) return 1;

    // 2. Clickable with non-empty text or contentDesc
    const aText = Boolean((a.text && a.text.trim()) || (a.contentDesc && a.contentDesc.trim()));
    const bText = Boolean((b.text && b.text.trim()) || (b.contentDesc && b.contentDesc.trim()));
    const aActionable = a.clickable && aText;
    const bActionable = b.clickable && bText;
    if (aActionable && !bActionable) return -1;
    if (!aActionable && bActionable) return 1;

    // 3. Distance to screen center
    const rectA = parseBoundsRect(a.bounds);
    const rectB = parseBoundsRect(b.bounds);
    if (rectA && rectB) {
      const distA = Math.hypot((rectA.x1 + rectA.x2) / 2 - centerX, (rectA.y1 + rectA.y2) / 2 - centerY);
      const distB = Math.hypot((rectB.x1 + rectB.x2) / 2 - centerX, (rectB.y1 + rectB.y2) / 2 - centerY);
      if (Math.abs(distA - distB) > 10) {
        return distA - distB;
      }
    }

    return (a.index ?? 0) - (b.index ?? 0);
  });

  return sorted.map((el, idx) => ({
    ...el,
    index: idx,
    ref: `@${idx + 1}`,
  }));
}

export function formatCompactSnapshot(
  elements: ActionElement[],
  packageName?: string,
  fingerprint?: string,
  changed?: boolean,
  totalCount?: number,
  locked?: boolean
): string {
  let header = `[App: ${packageName || "active"}`;
  if (locked) {
    header += ` | locked: true | hint: run device unlock`;
  } else if (changed !== undefined) {
    header += ` | changed: ${changed ? "yes" : "no"}`;
  } else if (fingerprint) {
    header += ` | fingerprint: ${fingerprint}`;
  }
  header += `]`;

  const lines = elements.map((e) => {
    const ref = e.ref || `@${e.index + 1}`;
    const role = getSemanticRole(e);
    const label = e.text || e.contentDesc || "";
    const labelStr = label ? ` "${label}"` : "";
    const rect = parseBoundsRect(e.bounds);
    const centerStr = (!label && rect) ? ` @x=${Math.round((rect.x1 + rect.x2) / 2)},y=${Math.round((rect.y1 + rect.y2) / 2)}` : "";
    const stateFlags: string[] = [];
    if (e.focused) stateFlags.push("focused");
    const stateStr = stateFlags.length > 0 ? ` [${stateFlags.join(", ")}]` : "";
    return `[${ref}] ${role}${labelStr}${centerStr}${stateStr}`;
  });

  if (totalCount !== undefined && totalCount > elements.length) {
    lines.push(`... (${totalCount - elements.length} more elements truncated, use --limit to expand)`);
  }

  return [header, ...lines].join("\n");
}

export function computeNodeKey(el: ActionElement): string {
  const rect = parseBoundsRect(el.bounds);
  let boundsGrid = "0,0,0,0";
  if (rect) {
    const gx1 = Math.floor(rect.x1 / 10) * 10;
    const gy1 = Math.floor(rect.y1 / 10) * 10;
    const gx2 = Math.floor(rect.x2 / 10) * 10;
    const gy2 = Math.floor(rect.y2 / 10) * 10;
    boundsGrid = `${gx1},${gy1},${gx2},${gy2}`;
  }
  const cls = el.className || "";
  const label = (el.contentDesc || el.text || "").trim().slice(0, 32);
  const resId = (el.resourceId || "").trim();
  return `${cls}|${resId}|${label}|${boundsGrid}`;
}

export interface ModifiedEntry {
  ref: string;
  oldElement?: ActionElement;
  newElement?: ActionElement;
  changes: Partial<Pick<ActionElement, "text" | "contentDesc" | "focused" | "clickable">>;
}

export interface SemanticDiff {
  baseFingerprint: string;
  newFingerprint: string;
  added: ActionElement[];
  removed: ActionElement[];
  modified: ModifiedEntry[];
}

export function computeSemanticDiff(
  base: ActionElement[],
  baseFingerprint: string,
  next: ActionElement[],
  nextFingerprint: string
): SemanticDiff {
  if (baseFingerprint && nextFingerprint && baseFingerprint === nextFingerprint) {
    return {
      baseFingerprint,
      newFingerprint: nextFingerprint,
      added: [],
      removed: [],
      modified: [],
    };
  }

  const buildMap = (elements: ActionElement[]) => {
    const map = new Map<string, ActionElement>();
    const counts = new Map<string, number>();
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const baseKey = computeNodeKey(el);
      const count = counts.get(baseKey) || 0;
      counts.set(baseKey, count + 1);
      const key = count === 0 ? baseKey : `${baseKey}#${count}`;
      map.set(key, el);
    }
    return map;
  };

  const baseMap = buildMap(base);
  const nextMap = buildMap(next);

  const added: ActionElement[] = [];
  const removed: ActionElement[] = [];
  const modified: ModifiedEntry[] = [];

  for (const [key, nextEl] of nextMap.entries()) {
    if (baseMap.has(key)) {
      const baseEl = baseMap.get(key)!;
      const textChanged = (baseEl.text || "") !== (nextEl.text || "");
      const descChanged = (baseEl.contentDesc || "") !== (nextEl.contentDesc || "");
      const focusedChanged = Boolean(baseEl.focused) !== Boolean(nextEl.focused);
      const clickableChanged = Boolean(baseEl.clickable) !== Boolean(nextEl.clickable);

      if (textChanged || descChanged || focusedChanged || clickableChanged) {
        modified.push({
          ref: baseEl.ref || nextEl.ref || `@${nextEl.index + 1}`,
          oldElement: baseEl,
          newElement: nextEl,
          changes: {
            ...(textChanged ? { text: nextEl.text } : {}),
            ...(descChanged ? { contentDesc: nextEl.contentDesc } : {}),
            ...(focusedChanged ? { focused: nextEl.focused } : {}),
            ...(clickableChanged ? { clickable: nextEl.clickable } : {}),
          },
        });
      }
    } else {
      added.push(nextEl);
    }
  }

  for (const [key, baseEl] of baseMap.entries()) {
    if (!nextMap.has(key)) {
      removed.push(baseEl);
    }
  }

  // Detect in-place mutations (e.g. text changed in same button with identical/high overlap bounds and same class)
  for (let r = removed.length - 1; r >= 0; r--) {
    const rem = removed[r];
    const remRect = parseBoundsRect(rem.bounds);
    if (!remRect) continue;

    for (let a = added.length - 1; a >= 0; a--) {
      const add = added[a];
      const addRect = parseBoundsRect(add.bounds);
      if (!addRect) continue;

      const sameClass = rem.className === add.className;
      const sameResId = !rem.resourceId || !add.resourceId || rem.resourceId === add.resourceId;
      const overlap = rectOverlapRatio(remRect, addRect);

      if (sameClass && sameResId && overlap >= 0.85) {
        const textChanged = (rem.text || "") !== (add.text || "");
        const descChanged = (rem.contentDesc || "") !== (add.contentDesc || "");
        const focusedChanged = Boolean(rem.focused) !== Boolean(add.focused);
        const clickableChanged = Boolean(rem.clickable) !== Boolean(add.clickable);

        modified.push({
          ref: rem.ref || add.ref || `@${add.index + 1}`,
          oldElement: rem,
          newElement: add,
          changes: {
            ...(textChanged ? { text: add.text } : {}),
            ...(descChanged ? { contentDesc: add.contentDesc } : {}),
            ...(focusedChanged ? { focused: add.focused } : {}),
            ...(clickableChanged ? { clickable: add.clickable } : {}),
          },
        });

        removed.splice(r, 1);
        added.splice(a, 1);
        break;
      }
    }
  }

  return {
    baseFingerprint,
    newFingerprint: nextFingerprint,
    added,
    removed,
    modified,
  };
}

export function formatSemanticDiffCompact(diff: SemanticDiff, packageName?: string): string {
  const isUnchanged = diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0;
  if (isUnchanged) {
    return `[App: ${packageName || "active"} | unchanged]`;
  }

  const header = `[App: ${packageName || "active"} | diff: ${diff.baseFingerprint || "init"} -> ${diff.newFingerprint}]`;
  const lines: string[] = [header];

  for (const rem of diff.removed) {
    const role = getSemanticRole(rem);
    const label = rem.text || rem.contentDesc || "";
    const labelStr = label ? ` "${label}"` : "";
    lines.push(`- [${rem.ref || `@${rem.index + 1}`}] ${role}${labelStr}`);
  }

  for (const add of diff.added) {
    const role = getSemanticRole(add);
    const label = add.text || add.contentDesc || "";
    const labelStr = label ? ` "${label}"` : "";
    lines.push(`+ [${add.ref || `@${add.index + 1}`}] ${role}${labelStr}`);
  }

  for (const mod of diff.modified) {
    const role = mod.newElement
      ? getSemanticRole(mod.newElement)
      : mod.oldElement
      ? getSemanticRole(mod.oldElement)
      : "Item";
    const oldLabel = mod.oldElement ? (mod.oldElement.text || mod.oldElement.contentDesc || "") : "";
    const newLabel = mod.newElement ? (mod.newElement.text || mod.newElement.contentDesc || "") : "";

    const stateFlags: string[] = [];
    if (mod.changes.focused !== undefined) stateFlags.push(mod.changes.focused ? "focused" : "unfocused");
    if (mod.changes.clickable !== undefined) stateFlags.push(mod.changes.clickable ? "clickable" : "disabled");
    const stateStr = stateFlags.length > 0 ? ` [${stateFlags.join(", ")}]` : "";

    if (oldLabel !== newLabel) {
      lines.push(`~ [${mod.ref}] ${role} "${oldLabel}" -> "${newLabel}"${stateStr}`);
    } else {
      const labelStr = newLabel ? ` "${newLabel}"` : "";
      lines.push(`~ [${mod.ref}] ${role}${labelStr}${stateStr}`);
    }
  }

  return lines.join("\n");
}

function decodeXmlEntities(str: string): string {
  if (!str) return str;
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const ATTR_REGEX_CACHE = new Map<string, RegExp>();
function getAttrRegex(key: string): RegExp {
  let re = ATTR_REGEX_CACHE.get(key);
  if (!re) {
    re = new RegExp(`${key}="([^"]*)"`);
    ATTR_REGEX_CACHE.set(key, re);
  }
  return re;
}

export function parseXmlDump(
  xmlContent: string,
  includeSystemBars: boolean = false,
  dedupe: boolean = true
): ActionElement[] {
  const elements: ActionElement[] = [];
  if (!xmlContent) return elements;

  const nodeRegex = /<node\s+([^>]+)\/?>/g;
  const attrRegex = /([a-zA-Z0-9_\-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  let indexCounter = 0;

  while ((match = nodeRegex.exec(xmlContent)) !== null) {
    const attrStr = match[1];
    let attrMatch: RegExpExecArray | null;
    attrRegex.lastIndex = 0;

    let resId = "";
    let pkgName = "";
    let text = "";
    let desc = "";
    let clsName = "";
    let bounds = "";
    let clickable = false;
    let scrollable = false;
    let checkable = false;
    let focused = false;
    let focusable = false;

    while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
      const key = attrMatch[1];
      const val = attrMatch[2];
      switch (key) {
        case "resource-id": resId = decodeXmlEntities(val); break;
        case "package": pkgName = decodeXmlEntities(val); break;
        case "text": text = decodeXmlEntities(val); break;
        case "content-desc": desc = decodeXmlEntities(val); break;
        case "class": clsName = decodeXmlEntities(val); break;
        case "bounds": bounds = val; break;
        case "clickable": clickable = val === "true"; break;
        case "scrollable": scrollable = val === "true"; break;
        case "checkable": checkable = val === "true"; break;
        case "focused": focused = val === "true"; break;
        case "focusable": focusable = val === "true"; break;
      }
    }

    if (!bounds) continue;

    const editable = focusable && clsName.endsWith("EditText");

    if (!includeSystemBars) {
      if (
        DEFAULT_FILTER_PACKAGES.has(pkgName) ||
        resId.startsWith("com.android.systemui") ||
        Array.from(DEFAULT_FILTER_PACKAGES).some((p) => resId.startsWith(`${p}:`))
      ) {
        continue;
      }
    }

    const isActionable =
      clickable ||
      scrollable ||
      checkable ||
      focused ||
      editable ||
      ACTIONABLE_CLASSES.has(clsName) ||
      (text.length > 0 && text.length <= 200) ||
      (desc.length > 0 && desc.length <= 200);

    if (!isActionable) continue;

    const nextIndex = indexCounter++;
    elements.push({
      index: nextIndex,
      ref: `@${nextIndex + 1}`,
      text,
      resourceId: resId,
      contentDesc: desc,
      className: clsName,
      bounds,
      clickable,
      scrollable,
      focused,
      visible_to_selector_engine: true,
    });
  }

  if (!dedupe) {
    return elements;
  }

  return deduplicateAndFilterElements(elements);
}

export function checkExpect(
  args: Record<string, unknown>,
  postElements: ActionElement[]
): [boolean, Record<string, unknown> | null] {
  const expectDescContains = args.expect_desc_contains as string | undefined;
  const expectTextContains = args.expect_text_contains as string | undefined;
  const expectElementAbsent = Boolean(args.expect_element_absent);

  if (expectElementAbsent) {
    let sel: Record<string, unknown> = {};
    if (expectDescContains) {
      sel.desc_contains = expectDescContains;
    } else if (expectTextContains) {
      sel.text_contains = expectTextContains;
    } else {
      sel = args;
    }

    try {
      const query = parseSelectorArgs(sel);
      const match = resolveSelector(postElements, query);
      return [false, match.element as unknown as Record<string, unknown>];
    } catch {
      return [true, null];
    }
  }

  const sel: Record<string, unknown> = {};
  if (expectDescContains) sel.desc_contains = expectDescContains;
  if (expectTextContains) sel.text_contains = expectTextContains;

  if (Object.keys(sel).length === 0) {
    return [true, null];
  }

  try {
    const query = parseSelectorArgs(sel);
    const match = resolveSelector(postElements, query);
    return [true, match.element as unknown as Record<string, unknown>];
  } catch {
    return [false, null];
  }
}

export const handleRefSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" || !String(v).startsWith("@") ? `@${v}` : String(v)))
  .optional()
  .describe("Element handle from ui.snapshot (e.g. @1, @2)");

export const UI_DOMAIN: DomainSpec = {
  name: "ui",
  description: "UI hierarchy projection, semantic selector interaction, gestures, and text input",
  tools: [
    {
      name: "ui.snapshot",
      domain: "ui",
      description: "Dump ultra-compact semantic UI snapshot with element handles (@1, @2, ...) optimized for LLMs",
      inputSchema: z.object({
        limit: z.number().optional().default(30),
        include_system_bars: z.boolean().optional().default(false),
        include_handles: z.boolean().optional().default(false),
        use_daemon: z.boolean().optional().default(true),
        diff: z.boolean().optional().default(false),
        fingerprint: z.boolean().optional().default(false),
      }),
      outputSchema: z.object({
        screen_fingerprint: z.string(),
        element_count: z.number(),
        raw_count: z.number().optional(),
        snapshot: z.string(),
        locked: z.boolean().optional(),
        handles: z.record(z.unknown()).optional(),
      }),
      safety: "read",
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.snapshot(args);
            ctx.serial = daemonClient.serial || ctx.serial;
            return {
              screen_fingerprint: daemonRes.screen_fingerprint,
              element_count: daemonRes.element_count,
              raw_count: daemonRes.raw_count,
              snapshot: daemonRes.snapshot,
              ...(daemonRes.locked ? { locked: true } : {}),
              ...(daemonRes.handles ? { handles: daemonRes.handles } : {}),
            };
          } catch {}
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        let packageName: string | undefined = undefined;
        let locked = false;
        try {
          const info = await client.deviceInfo();
          packageName = info.currentPackageName;
          if (packageName === "com.android.systemui") locked = true;
        } catch {}

        const xml = await client.dumpHierarchy(true);
        const rawElements = parseXmlDump(xml, args.include_system_bars, false);
        const rawCount = rawElements.length;
        let elements = deduplicateAndFilterElements(rawElements);
        const totalCount = elements.length;
        if (args.limit > 0 && elements.length > args.limit) {
          elements = sortByRelevance(elements).slice(0, args.limit);
        }

        const fp = computeScreenFingerprint(elements);
        const snapshotText = formatCompactSnapshot(
          elements,
          packageName,
          args.fingerprint ? fp : undefined,
          undefined,
          totalCount,
          locked
        );

        const handlesObj: Record<string, unknown> = {};
        if (args.include_handles) {
          elements.forEach((el) => {
            if (el.ref) {
              handlesObj[el.ref] = { text: el.text, resourceId: el.resourceId, bounds: el.bounds };
            }
          });
        }

        return {
          screen_fingerprint: fp,
          element_count: elements.length,
          raw_count: rawCount,
          snapshot: snapshotText,
          ...(locked ? { locked: true } : {}),
          ...(args.include_handles ? { handles: handlesObj } : {}),
        };
      },
    },
    {
      name: "ui.state",
      domain: "ui",
      description: "Fast screen state hash and package check without rendering full snapshot tree",
      inputSchema: z.object({
        include_system_bars: z.boolean().optional().default(false),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        screen_fingerprint: z.string(),
        package: z.string().optional(),
        changed: z.boolean().optional(),
        locked: z.boolean().optional(),
      }),
      safety: "read",
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.state(args);
            ctx.serial = daemonClient.serial || ctx.serial;
            return {
              screen_fingerprint: daemonRes.screen_fingerprint,
              package: daemonRes.package,
              changed: daemonRes.changed,
              locked: daemonRes.locked,
            };
          } catch {}
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        let packageName: string | undefined = undefined;
        let locked = false;
        try {
          const info = await client.deviceInfo();
          packageName = info.currentPackageName;
          if (packageName === "com.android.systemui") locked = true;
        } catch {}

        const xml = await client.dumpHierarchy(true);
        const elements = parseXmlDump(xml, args.include_system_bars, true);
        const fp = computeScreenFingerprint(elements);

        return {
          screen_fingerprint: fp,
          package: packageName,
          locked: locked ? true : undefined,
        };
      },
    },
    {
      name: "ui.dump",
      domain: "ui",
      description: "Dump UI hierarchy and actionable elements with screen fingerprint",
      inputSchema: z.object({
        filter: z.enum(["actionable", "all"]).optional().default("actionable"),
        limit: z.number().optional().default(30),
        include_system_bars: z.boolean().optional().default(false),
        raw: z.boolean().optional().default(false),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        screen_fingerprint: z.string(),
        element_count: z.number(),
        raw_count: z.number().optional(),
        elements: z.array(z.record(z.unknown())),
        raw_xml: z.string().optional(),
      }),
      safety: "read",
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.dump(args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) {
              return {
                screen_fingerprint: daemonRes.screen_fingerprint,
                element_count: daemonRes.element_count,
                raw_count: daemonRes.raw_count,
                elements: daemonRes.elements,
                ...(daemonRes.raw_xml ? { raw_xml: daemonRes.raw_xml } : {}),
              };
            }
          } catch {}
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        const xml = await client.dumpHierarchy(true);
        const dedupe = args.filter !== "all";
        const rawElements = parseXmlDump(xml, args.include_system_bars, false);
        const rawCount = rawElements.length;
        let elements = dedupe ? deduplicateAndFilterElements(rawElements) : rawElements;

        if (args.limit > 0 && elements.length > args.limit) {
          elements = sortByRelevance(elements).slice(0, args.limit);
        }

        const fingerprint = computeScreenFingerprint(elements);

        return {
          screen_fingerprint: fingerprint,
          element_count: elements.length,
          raw_count: rawCount,
          elements: elements as unknown as Record<string, unknown>[],
          ...(args.raw ? { raw_xml: xml } : {}),
        };
      },
    },
    {
      name: "ui.tap",
      domain: "ui",
      description: "Tap visible UI element matching selector or bounds coordinates",
      inputSchema: z.object({
        ref: handleRefSchema,
        pos: z.string().optional().describe("Direct tap coordinates 'X,Y' (bypasses selector resolution)"),
        text: z.string().optional(),
        text_contains: z.string().optional(),
        resource_id: z.string().optional(),
        description: z.string().optional(),
        desc_contains: z.string().optional(),
        class_name: z.string().optional(),
        bounds: z.string().optional(),
        expect_desc_contains: z.string().optional(),
        expect_text_contains: z.string().optional(),
        expect_element_absent: z.boolean().optional(),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        tapped: z.boolean(),
        x: z.number(),
        y: z.number(),
        postcondition: z.record(z.unknown()).optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ tapped: z.literal(true) }),
      },
      handler: async (ctx, args) => {
        const hasExpect = Boolean(args.expect_desc_contains || args.expect_text_contains || args.expect_element_absent);
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.action("tap", args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) {
              return daemonRes.result;
            }
          } catch {}
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        let targetX = 0;
        let targetY = 0;
        let preFingerprint = "";

        if (args.pos) {
          const parts = args.pos.replace(/\s+/g, "").split(",").map(Number);
          if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
            throw new UsageError(`Invalid --pos coordinates '${args.pos}'. Expected 'X,Y' format.`);
          }
          targetX = parts[0];
          targetY = parts[1];
          if (hasExpect) {
            const xml = await client.dumpHierarchy(true);
            const elements = parseXmlDump(xml, true);
            preFingerprint = computeScreenFingerprint(elements);
          }
        } else {
          const xml = await client.dumpHierarchy(true);
          const rawElements = parseXmlDump(xml, true, false);
          const elements = deduplicateAndFilterElements(rawElements);
          preFingerprint = computeScreenFingerprint(elements);

          const query = parseSelectorArgs(args as Record<string, unknown>);
          const matched = resolveSelector(elements, query, false, rawElements);

          if (matched.warnings.length > 0) {
            for (const w of matched.warnings) ctx.warn(w);
          }
          targetX = matched.centerX;
          targetY = matched.centerY;
        }

        await client.click(targetX, targetY);

        const postcondition: Record<string, unknown> = {};

        if (hasExpect) {
          const postXml = await client.dumpHierarchy(true);
          const postElements = parseXmlDump(postXml, true);
          const postFingerprint = computeScreenFingerprint(postElements);
          postcondition.screen_changed = preFingerprint !== postFingerprint;
          postcondition.screen_fingerprint = postFingerprint;

          const [satisfied, matchedElem] = checkExpect(args as Record<string, unknown>, postElements);
          postcondition.expect_satisfied = satisfied;
          if (matchedElem) postcondition.matched_element = matchedElem;
        }

        return {
          tapped: true,
          x: targetX,
          y: targetY,
          ...(hasExpect ? { postcondition } : {}),
        };
      },
    },
    {
      name: "ui.long_press",
      domain: "ui",
      description: "Long-press one visible UI element matched by selector",
      inputSchema: z.object({
        ref: handleRefSchema,
        text: z.string().optional(),
        text_contains: z.string().optional(),
        resource_id: z.string().optional(),
        description: z.string().optional(),
        desc_contains: z.string().optional(),
        bounds: z.string().optional(),
        duration: z.number().optional().default(1.0),
        expect_desc_contains: z.string().optional(),
        expect_text_contains: z.string().optional(),
        expect_element_absent: z.boolean().optional(),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        duration: z.number(),
        postcondition: z.record(z.unknown()),
        element: z.record(z.unknown()).optional(),
        bounds: z.string().optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ postcondition: z.record(z.unknown()) }),
      },
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.action("long_press", args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) return daemonRes.result;
          } catch {}
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        const xml = await client.dumpHierarchy(true);
        const rawElements = parseXmlDump(xml, true, false);
        const elements = deduplicateAndFilterElements(rawElements);
        const preFingerprint = computeScreenFingerprint(elements);

        const query = parseSelectorArgs(args as Record<string, unknown>);
        const matched = resolveSelector(elements, query, false, rawElements);

        if (matched.warnings.length > 0) {
          for (const w of matched.warnings) ctx.warn(w);
        }

        const duration = args.duration ?? 1.0;
        await client.longClick(matched.centerX, matched.centerY, duration);

        const postXml = await client.dumpHierarchy(true);
        const postElements = parseXmlDump(postXml, true);
        const postFingerprint = computeScreenFingerprint(postElements);

        const postcondition: Record<string, unknown> = {
          screen_changed: preFingerprint !== postFingerprint,
          screen_fingerprint: postFingerprint,
        };

        const hasExpect = Boolean(args.expect_desc_contains || args.expect_text_contains || args.expect_element_absent);
        if (hasExpect) {
          const [satisfied, matchedElem] = checkExpect(args as Record<string, unknown>, postElements);
          postcondition.expect_satisfied = satisfied;
          if (matchedElem) postcondition.matched_element = matchedElem;
        }

        return {
          duration,
          postcondition,
          element: matched.element as unknown as Record<string, unknown>,
          bounds: matched.element.bounds,
        };
      },
    },
    {
      name: "ui.input",
      domain: "ui",
      description: "Send text input to currently focused field or target element",
      inputSchema: z.object({
        text: z.string().describe("Text string to input"),
        clear_first: z.boolean().optional().default(false),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        text: z.string(),
        success: z.boolean(),
        text_typed: z.string().optional(),
        input_method: z.string().optional(),
        postcondition: z.record(z.unknown()).optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ success: z.literal(true) }),
      },
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.action("input", args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) return daemonRes.result;
          } catch {}
        }
        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        if (args.clear_first) {
          await client.clearInputText();
        }

        const inputMethod = await session.setInputText(args.text);
        return {
          text: args.text,
          text_typed: args.text,
          success: true,
          input_method: inputMethod,
          postcondition: { satisfied: true },
        };
      },
    },
    {
      name: "ui.swipe",
      domain: "ui",
      description: "Perform swipe gesture from start coordinates to end coordinates",
      inputSchema: z.object({
        from_pos: z.string().optional().describe("Start position 'X,Y'"),
        to_pos: z.string().optional().describe("End position 'X,Y'"),
        from_x: z.number().optional(),
        from_y: z.number().optional(),
        to_x: z.number().optional(),
        to_y: z.number().optional(),
        duration: z.number().optional().default(0.2),
        duration_steps: z.number().optional().default(20),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        swiped: z.boolean(),
        from: z.array(z.number()).optional(),
        to: z.array(z.number()).optional(),
        duration: z.number().optional(),
        screen_fingerprint: z.string().optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ swiped: z.literal(true) }),
      },
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.action("swipe", args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) return daemonRes.result;
          } catch {}
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        let fx = 0, fy = 0, tx = 0, ty = 0;

        if (args.from_pos && args.to_pos) {
          const fParts = args.from_pos.replace(/\s+/g, "").split(",").map(Number);
          const tParts = args.to_pos.replace(/\s+/g, "").split(",").map(Number);
          fx = fParts[0]; fy = fParts[1];
          tx = tParts[0]; ty = tParts[1];
        } else if (
          args.from_x !== undefined &&
          args.from_y !== undefined &&
          args.to_x !== undefined &&
          args.to_y !== undefined
        ) {
          fx = args.from_x; fy = args.from_y;
          tx = args.to_x; ty = args.to_y;
        } else {
          throw new UsageError("Must specify either '--from-pos X,Y --to-pos X,Y' or '--from-x ... --from-y ... --to-x ... --to-y ...'");
        }

        const steps = args.duration_steps ?? Math.round((args.duration ?? 0.2) * 100);
        await client.swipe(fx, fy, tx, ty, steps);

        return {
          swiped: true,
          from: [fx, fy],
          to: [tx, ty],
          duration: args.duration ?? 0.2,
        };
      },
    },
    {
      name: "ui.scroll",
      domain: "ui",
      description: "Perform high-level scroll gesture in specified direction",
      inputSchema: z.object({
        direction: z.enum(["down", "up", "left", "right"]).optional().default("down"),
        duration: z.number().optional().default(0.3),
        snapshot: z.boolean().optional().default(false).describe("Capture and return updated snapshot after scroll"),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        swiped: z.boolean(),
        direction: z.string(),
        snapshot: z.string().optional(),
        screen_fingerprint: z.string().optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ swiped: z.literal(true) }),
      },
      handler: async (ctx, args) => {
        if (args.use_daemon && !args.snapshot) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.action("scroll", args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) return daemonRes.result;
          } catch {}
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        const info = await client.deviceInfo();
        const width = info.displayWidth || 1080;
        const height = info.displayHeight || 2340;

        const dir = args.direction ?? "down";
        const duration = args.duration ?? 0.3;
        let fx = 0, fy = 0, tx = 0, ty = 0;

        if (dir === "down") {
          fx = Math.round(width / 2); fy = Math.round(height * 0.75);
          tx = Math.round(width / 2); ty = Math.round(height * 0.25);
        } else if (dir === "up") {
          fx = Math.round(width / 2); fy = Math.round(height * 0.25);
          tx = Math.round(width / 2); ty = Math.round(height * 0.75);
        } else if (dir === "left") {
          fx = Math.round(width * 0.85); fy = Math.round(height / 2);
          tx = Math.round(width * 0.15); ty = Math.round(height / 2);
        } else if (dir === "right") {
          fx = Math.round(width * 0.15); fy = Math.round(height / 2);
          tx = Math.round(width * 0.85); ty = Math.round(height / 2);
        }

        const steps = Math.round(duration * 100);
        await client.swipe(fx, fy, tx, ty, steps);

        if (args.snapshot) {
          await new Promise((r) => setTimeout(r, 200));
          const snapRes = await ctx.callTool<{ snapshot: string }>("ui.snapshot", {});
          return {
            swiped: true,
            direction: dir,
            snapshot: snapRes.snapshot,
          };
        }

        return {
          swiped: true,
          direction: dir,
        };
      },
    },
    {
      name: "ui.type",
      domain: "ui",
      description: "Macro to focus input field (via selector) and type text in one step",
      inputSchema: z.object({
        ref: handleRefSchema,
        text: z.string().optional().describe("Text to type"),
        value: z.string().optional().describe("Text to type (preferred over --text)"),
        text_contains: z.string().optional(),
        resource_id: z.string().optional(),
        description: z.string().optional(),
        desc_contains: z.string().optional(),
        bounds: z.string().optional(),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        text_typed: z.string(),
        screen_fingerprint: z.string().optional(),
        postcondition: z.record(z.unknown()).optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ text_typed: z.string() }),
      },
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.action("type", args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) return daemonRes.result;
          } catch {}
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        const textToType = String(args.value ?? args.text ?? "");
        const selectorArgs = { ...args };
        delete selectorArgs.value;
        if (args.value === undefined) {
          delete selectorArgs.text;
        }

        const refKey = args.ref !== undefined && args.ref !== null ? (String(args.ref).startsWith("@") ? String(args.ref) : `@${args.ref}`) : undefined;
        const hasSelector = Boolean(
          refKey ||
          selectorArgs.text ||
          selectorArgs.text_contains ||
          selectorArgs.resource_id ||
          selectorArgs.description ||
          selectorArgs.desc_contains ||
          selectorArgs.bounds
        );

        if (hasSelector) {
          const xml = await client.dumpHierarchy(true);
          const rawElements = parseXmlDump(xml, true, false);
          const elements = deduplicateAndFilterElements(rawElements);
          const query = parseSelectorArgs(selectorArgs as Record<string, unknown>);
          const matched = resolveSelector(elements, query, false, rawElements);

          if (matched.warnings.length > 0) {
            for (const w of matched.warnings) ctx.warn(w);
          }

          await client.click(matched.centerX, matched.centerY);
        }

        await session.setInputText(textToType);

        return {
          text_typed: textToType,
          postcondition: { satisfied: true },
        };
      },
    },
    {
      name: "ui.press",
      domain: "ui",
      description: "Press hardware key or navigation key (back, home, enter, etc.)",
      inputSchema: z.object({
        key: z.string().describe("Key name (e.g. back, home, enter, power, menu, delete, volume_up, volume_down, tab, recent, search)"),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        key: z.string(),
        pressed: z.boolean(),
        screen_fingerprint: z.string().optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ pressed: z.literal(true) }),
      },
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.action("press", args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) return daemonRes.result;
          } catch {}
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        await client.pressKey(args.key.toLowerCase());

        return {
          key: args.key,
          pressed: true,
        };
      },
    },
    {
      name: "ui.keyboard_hide",
      domain: "ui",
      description: "Dismiss virtual soft keyboard / IME if currently open",
      inputSchema: z.object({}),
      outputSchema: z.object({
        hidden: z.boolean(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ hidden: z.literal(true) }),
      },
      handler: async (ctx) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;
        // Keyevent 111 is KEYCODE_ESCAPE which hides soft keyboard without triggering back navigation
        await execAdb(["-s", target.serial, "shell", "input", "keyevent", "111"]);
        return { hidden: true };
      },
    },
    {
      name: "ui.wait",
      domain: "ui",
      description: "Wait for an element matching selector to become present or absent",
      inputSchema: z.object({
        ref: handleRefSchema,
        text: z.string().optional(),
        text_contains: z.string().optional(),
        resource_id: z.string().optional(),
        description: z.string().optional(),
        desc_contains: z.string().optional(),
        bounds: z.string().optional(),
        timeout: z.number().optional().default(10),
        timeout_seconds: z.number().optional().default(10),
        absent: z.boolean().optional().default(false),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        waited_seconds: z.number(),
        satisfied: z.boolean(),
        found: z.boolean().optional(),
        element: z.record(z.unknown()).nullable().optional(),
      }),
      safety: "read",
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.action("wait", args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) return daemonRes.result;
          } catch (e: any) {
            ctx.warn(`Daemon wait action failed, falling back to direct RPC: ${e.message}`);
          }
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        const query = parseSelectorArgs(args as Record<string, unknown>);
        const timeoutSec = Math.min(args.timeout ?? args.timeout_seconds ?? ctx.timeout ?? 10, 120);
        const absent = Boolean(args.absent);

        const startTime = Date.now();
        const deadline = startTime + timeoutSec * 1000;

        let pollInterval = 100;
        while (Date.now() < deadline) {
          try {
            const xml = await client.dumpHierarchy(true);
            const rawElements = parseXmlDump(xml, true, false);
            const elements = deduplicateAndFilterElements(rawElements);
            const matched = resolveSelector(elements, query, false, rawElements);

            if (!absent) {
              const duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
              return {
                waited_seconds: duration,
                satisfied: true,
                found: true,
                element: matched.element as unknown as Record<string, unknown>,
              };
            }
          } catch (e: any) {
            if (absent && e instanceof SelectorNotFoundError) {
              const duration = Number(((Date.now() - startTime) / 1000).toFixed(2));
              return {
                waited_seconds: duration,
                satisfied: true,
                found: false,
                element: null,
              };
            }
          }
          await new Promise((r) => setTimeout(r, pollInterval));
          pollInterval = Math.min(Math.round(pollInterval * 1.5), 800);
        }

        throw new TimeoutError(`Wait timed out after ${timeoutSec}s for selector matching ${JSON.stringify(query)}`);
      },
    },
    {
      name: "ui.find",
      domain: "ui",
      description: "Scroll repeatedly until selector element is found or max scrolls reached",
      inputSchema: z.object({
        ref: handleRefSchema,
        text: z.string().optional(),
        text_contains: z.string().optional(),
        resource_id: z.string().optional(),
        description: z.string().optional(),
        desc_contains: z.string().optional(),
        bounds: z.string().optional(),
        scroll_direction: z.enum(["down", "up", "left", "right"]).optional().default("down"),
        max_scrolls: z.number().int().max(30).optional().default(10),
        scroll_duration: z.number().optional().default(0.3),
        use_daemon: z.boolean().optional().default(true),
      }),
      outputSchema: z.object({
        found: z.boolean(),
        element: z.record(z.unknown()).nullable().optional(),
        scrolls_performed: z.number(),
        screen_fingerprint: z.string(),
      }),
      safety: "read",
      handler: async (ctx, args) => {
        if (args.use_daemon) {
          try {
            const daemonClient = new DaemonClient(ctx.serial);
            const daemonRes = await daemonClient.action("find", args);
            ctx.serial = daemonClient.serial || ctx.serial;
            if (daemonRes.ok) return daemonRes.result;
          } catch (e: any) {
            ctx.warn(`Daemon find action failed, falling back to direct RPC: ${e.message}`);
          }
        }

        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        const info = await client.deviceInfo();
        const width = info.displayWidth || 1080;
        const height = info.displayHeight || 2340;

        const query = parseSelectorArgs(args as Record<string, unknown>);
        const scrollDirection = args.scroll_direction ?? "down";
        const maxScrolls = Math.min(args.max_scrolls ?? 10, 30);
        const scrollDuration = args.scroll_duration ?? 0.3;

        let scrollsPerformed = 0;

        while (true) {
          const xml = await client.dumpHierarchy(true);
          const rawElements = parseXmlDump(xml, false, false);
          const elements = deduplicateAndFilterElements(rawElements);
          const fingerprint = computeScreenFingerprint(elements);

          try {
            const matched = resolveSelector(elements, query, false, rawElements);
            return {
              found: true,
              element: matched.element as unknown as Record<string, unknown>,
              scrolls_performed: scrollsPerformed,
              screen_fingerprint: fingerprint,
            };
          } catch (e: any) {
            if (!(e instanceof SelectorNotFoundError)) throw e;

            if (scrollsPerformed >= maxScrolls) {
              return {
                found: false,
                element: null,
                scrolls_performed: scrollsPerformed,
                screen_fingerprint: fingerprint,
              };
            }

            let fx = 0, fy = 0, tx = 0, ty = 0;
            if (scrollDirection === "down") {
              fx = Math.round(width / 2); fy = Math.round(height * 0.75);
              tx = Math.round(width / 2); ty = Math.round(height * 0.25);
            } else if (scrollDirection === "up") {
              fx = Math.round(width / 2); fy = Math.round(height * 0.25);
              tx = Math.round(width / 2); ty = Math.round(height * 0.75);
            } else if (scrollDirection === "left") {
              fx = Math.round(width * 0.85); fy = Math.round(height / 2);
              tx = Math.round(width * 0.15); ty = Math.round(height / 2);
            } else if (scrollDirection === "right") {
              fx = Math.round(width * 0.15); fy = Math.round(height / 2);
              tx = Math.round(width * 0.85); ty = Math.round(height / 2);
            }

            const steps = Math.round(scrollDuration * 100);
            await client.swipe(fx, fy, tx, ty, steps);
            scrollsPerformed++;
          }
        }
      },
    },
    {
      name: "ui.notifications",
      domain: "ui",
      description: "Manage and inspect Android system notifications (expand, collapse, read)",
      inputSchema: z.object({
        action: z.enum(["expand", "collapse", "read"]).optional().default("read").describe("Action: expand, collapse, or read notifications"),
      }),
      outputSchema: z.object({
        action: z.string(),
        success: z.boolean(),
        notifications: z.array(
          z.object({
            package: z.string(),
            title: z.string(),
            text: z.string(),
          })
        ).optional(),
        count: z.number().optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ success: z.literal(true) }),
      },
      handler: async (ctx, args) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;

        if (args.action === "expand") {
          let ok = false;
          try {
            const session = new DeviceSession(ctx.serial, ctx.timeout);
            const client = await session.connect();
            ok = await client.openNotification();
          } catch {}

          if (!ok) {
            await execAdb(["-s", target.serial, "shell", "cmd", "statusbar", "expand-notifications"]);
          }
          return { action: "expand", success: true };
        } else if (args.action === "collapse") {
          await execAdb(["-s", target.serial, "shell", "cmd", "statusbar", "collapse"]);
          return { action: "collapse", success: true };
        } else {
          // read
          let rawDumpsys = "";
          try {
            const res = await execAdb(["-s", target.serial, "shell", "dumpsys", "notification", "--noredact"]);
            rawDumpsys = res.stdout;
          } catch {
            const res = await execAdb(["-s", target.serial, "shell", "dumpsys", "notification"]);
            rawDumpsys = res.stdout;
          }

          const notifications = parseNotificationDumpsys(rawDumpsys);
          return {
            action: "read",
            notifications,
            count: notifications.length,
            success: true,
          };
        }
      },
    },
    {
      name: "ui.screenshot",
      domain: "ui",
      description: "Capture PNG screenshot of device display and save to local path",
      inputSchema: z.object({
        output: z.string().optional().describe("Local filesystem path for PNG image (defaults to ./screenshot_<timestamp>.png)"),
      }),
      outputSchema: z.object({
        path: z.string(),
        size_bytes: z.number(),
        success: z.boolean(),
      }),
      safety: "read",
      handler: async (ctx, args) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;

        const outPath = args.output || path.join(process.cwd(), `screenshot_${Date.now()}.png`);
        const proc = Bun.spawn(["adb", "-s", target.serial, "exec-out", "screencap", "-p"], {
          stdout: "pipe",
          stderr: "pipe",
        });

        const bytes = await Bun.readableStreamToArrayBuffer(proc.stdout);
        if (bytes.byteLength === 0) {
          throw new U2Error("DEVICE_OFFLINE", "Failed to capture screenshot from device", ExitCode.DEVICE, true, "Verify device connection");
        }

        await Bun.write(outPath, bytes);

        return {
          path: outPath,
          size_bytes: bytes.byteLength,
          success: true,
        };
      },
    },
    {
      name: "ui.drag",
      domain: "ui",
      description: "Drag from source element or coordinates to destination element or coordinates",
      inputSchema: z.object({
        from_ref: handleRefSchema.describe("Source element handle (e.g. @1)"),
        to_ref: handleRefSchema.describe("Destination element handle (e.g. @2)"),
        from_pos: z.string().optional().describe("Source coordinates 'X,Y'"),
        to_pos: z.string().optional().describe("Destination coordinates 'X,Y'"),
        from_x: z.number().optional(),
        from_y: z.number().optional(),
        to_x: z.number().optional(),
        to_y: z.number().optional(),
        steps: z.number().optional().default(40).describe("Drag interpolation steps (default 40)"),
      }),
      outputSchema: z.object({
        dragged: z.boolean(),
        from: z.object({ x: z.number(), y: z.number() }),
        to: z.object({ x: z.number(), y: z.number() }),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ dragged: z.literal(true) }),
      },
      handler: async (ctx, args) => {
        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        let fromX = args.from_x;
        let fromY = args.from_y;
        let toX = args.to_x;
        let toY = args.to_y;

        if (args.from_pos) {
          const parts = args.from_pos.split(",").map(Number);
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            fromX = parts[0];
            fromY = parts[1];
          }
        }
        if (args.to_pos) {
          const parts = args.to_pos.split(",").map(Number);
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            toX = parts[0];
            toY = parts[1];
          }
        }

        if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) {
          const xml = await client.dumpHierarchy(true);
          const rawElements = parseXmlDump(xml, true, false);
          const elements = deduplicateAndFilterElements(rawElements);

          if (fromX === undefined || fromY === undefined) {
            if (!args.from_ref) {
              throw new UsageError("Missing source: specify --from-ref or --from-pos / --from-x/y");
            }
            const query = parseSelectorArgs({ ref: args.from_ref });
            const matched = resolveSelector(elements, query, false, rawElements);
            fromX = matched.centerX;
            fromY = matched.centerY;
          }

          if (toX === undefined || toY === undefined) {
            if (!args.to_ref) {
              throw new UsageError("Missing destination: specify --to-ref or --to-pos / --to-x/y");
            }
            const query = parseSelectorArgs({ ref: args.to_ref });
            const matched = resolveSelector(elements, query, false, rawElements);
            toX = matched.centerX;
            toY = matched.centerY;
          }
        }

        await client.drag(fromX, fromY, toX, toY, args.steps);

        return {
          dragged: true,
          from: { x: fromX, y: fromY },
          to: { x: toX, y: toY },
        };
      },
    },
    {
      name: "ui.pinch",
      domain: "ui",
      description: "Perform two-pointer pinch gesture (in or out) on an element or screen region",
      inputSchema: z.object({
        ref: handleRefSchema.describe("Element handle to pinch within (e.g. @1)"),
        pos: z.string().optional().describe("Center coordinate 'X,Y'"),
        cx: z.number().optional(),
        cy: z.number().optional(),
        direction: z.enum(["in", "out"]).optional().default("in").describe("Direction: 'in' (zoom out) or 'out' (zoom in)"),
        percent: z.number().optional().default(50).describe("Pinch scale percent 1-100 (default 50)"),
        steps: z.number().optional().default(30).describe("Gesture steps (default 30)"),
      }),
      outputSchema: z.object({
        pinched: z.boolean(),
        direction: z.string(),
        center: z.object({ x: z.number(), y: z.number() }),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ pinched: z.literal(true) }),
      },
      handler: async (ctx, args) => {
        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        let boundsRect: { x1: number; y1: number; x2: number; y2: number } | null = null;
        let centerX = args.cx;
        let centerY = args.cy;

        if (args.pos) {
          const parts = args.pos.split(",").map(Number);
          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            centerX = parts[0];
            centerY = parts[1];
          }
        }

        if (args.ref) {
          const xml = await client.dumpHierarchy(true);
          const rawElements = parseXmlDump(xml, true, false);
          const elements = deduplicateAndFilterElements(rawElements);
          const query = parseSelectorArgs({ ref: args.ref });
          const matched = resolveSelector(elements, query, false, rawElements);
          centerX = matched.centerX;
          centerY = matched.centerY;
          boundsRect = parseBoundsRect(matched.element.bounds);
        }

        if (!boundsRect) {
          const info = await client.deviceInfo();
          const w = info.displayWidth || 1080;
          const h = info.displayHeight || 2340;
          if (centerX === undefined || centerY === undefined) {
            centerX = Math.round(w / 2);
            centerY = Math.round(h / 2);
          }
          const radiusX = Math.round(w * 0.35);
          const radiusY = Math.round(h * 0.35);
          boundsRect = {
            x1: Math.max(0, centerX - radiusX),
            y1: Math.max(0, centerY - radiusY),
            x2: Math.min(w, centerX + radiusX),
            y2: Math.min(h, centerY + radiusY),
          };
        }

        if (args.direction === "out") {
          await client.pinchOut(boundsRect, args.percent, args.steps);
        } else {
          await client.pinchIn(boundsRect, args.percent, args.steps);
        }

        return {
          pinched: true,
          direction: args.direction,
          center: { x: centerX, y: centerY },
        };
      },
    },
  ],
};
