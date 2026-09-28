import { SelectorNotFoundError, UsageError } from "../errors";
import type { ActionElement } from "../models";
import { parseBoundsRect, type SelectorQuery } from "./parser";

export interface ResolvedElementMatch {
  element: ActionElement;
  centerX: number;
  centerY: number;
  matchedCount: number;
  warnings: string[];
}

export const OVERLAP_MERGE = 0.85;       // dedup: elements with same-size bounds collapse to one
export const OVERLAP_MATCH = 0.80;       // selector --bounds: permissive fuzzy match
export const OVERLAP_AMBIGUOUS = 0.90;   // disambiguation: all candidates overlap -> pick first

export function rectOverlapRatio(
  r1: { x1: number; y1: number; x2: number; y2: number },
  r2: { x1: number; y1: number; x2: number; y2: number }
): number {
  const ix1 = Math.max(r1.x1, r2.x1);
  const iy1 = Math.max(r1.y1, r2.y1);
  const ix2 = Math.min(r1.x2, r2.x2);
  const iy2 = Math.min(r1.y2, r2.y2);

  if (ix2 <= ix1 || iy2 <= iy1) return 0;

  const intersectionArea = (ix2 - ix1) * (iy2 - iy1);
  const area1 = (r1.x2 - r1.x1) * (r1.y2 - r1.y1);
  const area2 = (r2.x2 - r2.x1) * (r2.y2 - r2.y1);
  const minArea = Math.min(area1, area2);

  if (minArea <= 0) return 0;
  return intersectionArea / minArea;
}

function filterElementsMatchingQuery(elements: ActionElement[], query: SelectorQuery): ActionElement[] {
  return elements.filter((e) => {
    if (query.ref) {
      const matchRef = e.ref === query.ref || `@${e.index + 1}` === query.ref || `${e.index + 1}` === query.ref;
      if (!matchRef) return false;
    }
    if (query.resourceId && e.resourceId !== query.resourceId) return false;
    if (query.contentDesc && e.contentDesc !== query.contentDesc) return false;
    if (query.descContains && !e.contentDesc?.toLowerCase().includes(query.descContains.toLowerCase())) return false;
    if (query.text && e.text !== query.text) return false;
    if (query.textContains && !e.text?.toLowerCase().includes(query.textContains.toLowerCase())) return false;
    if (query.className && e.className !== query.className) return false;

    if (query.bounds) {
      const eRect = parseBoundsRect(e.bounds);
      if (!eRect) return false;
      const overlap = rectOverlapRatio(query.bounds, eRect);
      if (overlap < OVERLAP_MATCH) return false;
    }

    return true;
  });
}

export function resolveSelector(
  elements: ActionElement[],
  query: SelectorQuery,
  strictSelector: boolean = false,
  rawElements?: ActionElement[]
): ResolvedElementMatch {
  const warnings: string[] = [];

  let matches = filterElementsMatchingQuery(elements, query);

  if (matches.length === 0 && rawElements && rawElements.length > 0) {
    const rawMatches = filterElementsMatchingQuery(rawElements, query);
    if (rawMatches.length > 0) {
      warnings.push("Selector matched element only in raw element tree (hidden by deduplication).");
      matches = rawMatches;
    }
  }

  if (matches.length === 0) {
    const desc = JSON.stringify(query);
    throw new SelectorNotFoundError(desc);
  }

  if (matches.length === 1) {
    const target = matches[0];
    const rect = parseBoundsRect(target.bounds) || { x1: 0, y1: 0, x2: 0, y2: 0 };
    return {
      element: target,
      centerX: Math.round((rect.x1 + rect.x2) / 2),
      centerY: Math.round((rect.y1 + rect.y2) / 2),
      matchedCount: 1,
      warnings,
    };
  }

  // Ambiguity Policy (BUILDSPEC G4)
  if (strictSelector) {
    throw new SelectorNotFoundError(
      `Ambiguous selector query ${JSON.stringify(query)} matched ${matches.length} elements under --strict-selector`
    );
  }

  // Rule 1: Focused element wins
  const focusedMatches = matches.filter((m) => m.focused);
  if (focusedMatches.length === 1) {
    const target = focusedMatches[0];
    const rect = parseBoundsRect(target.bounds) || { x1: 0, y1: 0, x2: 0, y2: 0 };
    return {
      element: target,
      centerX: Math.round((rect.x1 + rect.x2) / 2),
      centerY: Math.round((rect.y1 + rect.y2) / 2),
      matchedCount: matches.length,
      warnings,
    };
  }

  // Rule 2: Overlapping rects (>=90%)
  const firstRect = parseBoundsRect(matches[0].bounds);
  if (firstRect) {
    const allOverlap = matches.every((m) => {
      const r = parseBoundsRect(m.bounds);
      return r && rectOverlapRatio(firstRect, r) >= OVERLAP_AMBIGUOUS;
    });
    if (allOverlap) {
      const target = matches[0];
      return {
        element: target,
        centerX: Math.round((firstRect.x1 + firstRect.x2) / 2),
        centerY: Math.round((firstRect.y1 + firstRect.y2) / 2),
        matchedCount: matches.length,
        warnings,
      };
    }
  }

  // Rule 3: First in document order + Warning
  const selected = matches[0];
  const boundsList = matches.map((m) => m.bounds).join(", ");
  warnings.push(`Ambiguous selector matched ${matches.length} elements (${boundsList}). Selected first element in document order.`);

  const rect = parseBoundsRect(selected.bounds) || { x1: 0, y1: 0, x2: 0, y2: 0 };
  return {
    element: selected,
    centerX: Math.round((rect.x1 + rect.x2) / 2),
    centerY: Math.round((rect.y1 + rect.y2) / 2),
    matchedCount: matches.length,
    warnings,
  };
}
