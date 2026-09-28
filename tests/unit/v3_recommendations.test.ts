import { describe, test, expect } from "bun:test";
import { parseXmlDump, deduplicateAndFilterElements, UI_DOMAIN } from "../../src/domains/ui";
import { resolveSelector, OVERLAP_MERGE, OVERLAP_MATCH, OVERLAP_AMBIGUOUS } from "../../src/selectors/resolver";
import { BUILD_ID } from "../../src/daemon/server";
import { parseSelectorArgs } from "../../src/selectors/parser";
import type { ActionElement } from "../../src/models";
import { SelectorNotFoundError, UsageError } from "../../src/errors";

describe("v3 Recommendations & Robustness Fixes", () => {
  test("BUILD_ID is defined and versioned", () => {
    expect(BUILD_ID).toMatch(/^0\.1\.0-v\d+$/);
  });

  test("Overlap constants are consolidated and exported", () => {
    expect(OVERLAP_MERGE).toBe(0.85);
    expect(OVERLAP_MATCH).toBe(0.80);
    expect(OVERLAP_AMBIGUOUS).toBe(0.90);
  });

  test("Dedup: child button inside large feed container survives", () => {
    const parentContainer: ActionElement = {
      index: 0,
      ref: "@1",
      text: "Félix Fernández de Pinedo",
      contentDesc: "",
      className: "android.view.ViewGroup",
      bounds: "[0,0][1080,2340]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const childLikeButton: ActionElement = {
      index: 1,
      ref: "@2",
      text: "Me gusta",
      contentDesc: "Botón Me gusta",
      className: "android.widget.Button",
      bounds: "[0,1835][132,1967]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const result = deduplicateAndFilterElements([parentContainer, childLikeButton]);
    expect(result.length).toBe(2);
    expect(result[0].text).toBe("Félix Fernández de Pinedo");
    expect(result[1].text).toBe("Me gusta");
    expect(result.some((e) => e.text === "Me gusta")).toBe(true);
  });

  test("Dedup: two distinct labeled elements with same or overlapping bounds do not merge", () => {
    const item1: ActionElement = {
      index: 0,
      ref: "@1",
      text: "Like",
      contentDesc: "Like post",
      className: "android.widget.Button",
      bounds: "[100,100][300,200]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const item2: ActionElement = {
      index: 1,
      ref: "@2",
      text: "Comment",
      contentDesc: "Comment post",
      className: "android.widget.Button",
      bounds: "[100,100][300,200]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const result = deduplicateAndFilterElements([item1, item2]);
    expect(result.length).toBe(2);
    expect(result[0].text).toBe("Like");
    expect(result[1].text).toBe("Comment");
  });

  test("Dedup: unlabeled wrapper merges into labeled child", () => {
    const wrapper: ActionElement = {
      index: 0,
      ref: "@1",
      text: "",
      contentDesc: "",
      className: "android.widget.FrameLayout",
      bounds: "[100,100][300,200]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const childButton: ActionElement = {
      index: 1,
      ref: "@2",
      text: "Submit",
      contentDesc: "",
      className: "android.widget.Button",
      bounds: "[100,100][300,200]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const result = deduplicateAndFilterElements([wrapper, childButton]);
    expect(result.length).toBe(1);
    expect(result[0].text).toBe("Submit");
    expect(result[0].ref).toBe("@1");
  });

  test("parseXmlDump supports dedupe=false to return all raw actionable elements", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.facebook.katana" content-desc="" clickable="true" bounds="[0,0][1080,2340]">
    <node index="0" text="Félix Fernández" resource-id="com.facebook.katana:id/author" class="android.widget.TextView" package="com.facebook.katana" content-desc="Félix Fernández" clickable="true" bounds="[50,100][500,200]" />
    <node index="1" text="" resource-id="com.facebook.katana:id/like_wrapper" class="android.widget.FrameLayout" package="com.facebook.katana" content-desc="" clickable="true" bounds="[0,1835][132,1967]">
      <node index="0" text="Me gusta" resource-id="com.facebook.katana:id/like_button" class="android.widget.Button" package="com.facebook.katana" content-desc="Botón Me gusta" clickable="true" bounds="[0,1835][132,1967]" />
    </node>
  </node>
</hierarchy>`;

    const rawList = parseXmlDump(xml, false, false);
    const dedupedList = parseXmlDump(xml, false, true);

    expect(rawList.length).toBeGreaterThan(dedupedList.length);
    expect(dedupedList.some((e) => e.text === "Me gusta")).toBe(true);
    expect(dedupedList.some((e) => e.text === "Félix Fernández")).toBe(true);
  });

  test("resolveSelector falls back to rawElements when element is hidden by dedup", () => {
    const rawElement: ActionElement = {
      index: 0,
      ref: "@1",
      text: "Hidden in Dedup",
      contentDesc: "",
      className: "android.widget.Button",
      bounds: "[10,10][100,50]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const dedupedElements: ActionElement[] = [
      {
        index: 0,
        ref: "@1",
        text: "Visible Button",
        contentDesc: "",
        className: "android.widget.Button",
        bounds: "[200,200][400,300]",
        clickable: true,
        scrollable: false,
        focused: false,
        visible_to_selector_engine: true,
      },
    ];

    const query = parseSelectorArgs({ text: "Hidden in Dedup" });

    // Without rawElements fallback, throws SelectorNotFoundError
    expect(() => resolveSelector(dedupedElements, query)).toThrow(SelectorNotFoundError);

    // With rawElements fallback, successfully resolves with a warning
    const match = resolveSelector(dedupedElements, query, false, [rawElement]);
    expect(match.element.text).toBe("Hidden in Dedup");
    expect(match.warnings.length).toBe(1);
    expect(match.warnings[0]).toContain("hidden by deduplication");
  });

  test("ui.tap tool schema includes pos parameter", () => {
    const tapTool = UI_DOMAIN.tools.find((t) => t.name === "ui.tap")!;
    expect(tapTool).toBeDefined();

    const parsedWithPos = tapTool.inputSchema.safeParse({ pos: "540,1920" });
    expect(parsedWithPos.success).toBe(true);

    const parsedWithRef = tapTool.inputSchema.safeParse({ ref: "@1" });
    expect(parsedWithRef.success).toBe(true);
  });

  test("ui.dump tool schema includes filter=all and raw_count in outputSchema", () => {
    const dumpTool = UI_DOMAIN.tools.find((t) => t.name === "ui.dump")!;
    expect(dumpTool).toBeDefined();

    const parsedFilterAll = dumpTool.inputSchema.safeParse({ filter: "all" });
    expect(parsedFilterAll.success).toBe(true);

    const outputCheck = dumpTool.outputSchema.safeParse({
      screen_fingerprint: "12345678abcdef01",
      element_count: 5,
      raw_count: 12,
      elements: [],
    });
    expect(outputCheck.success).toBe(true);
  });

  test("UTF-8 special characters in content-desc and text are parsed accurately", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<hierarchy rotation="0">
  <node index="0" text="Félix Fernández de Pinedo" resource-id="com.app:id/title" class="android.widget.TextView" package="com.app" content-desc="Configuración y Más" clickable="true" bounds="[10,10][500,200]" />
</hierarchy>`;

    const elements = parseXmlDump(xml);
    expect(elements.length).toBe(1);
    expect(elements[0].text).toBe("Félix Fernández de Pinedo");
    expect(elements[0].contentDesc).toBe("Configuración y Más");
  });
});
