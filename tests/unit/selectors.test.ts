import { describe, test, expect } from "bun:test";
import { parseBoundsRect, parseSelectorArgs } from "../../src/selectors/parser";
import { resolveSelector, rectOverlapRatio } from "../../src/selectors/resolver";
import type { ActionElement } from "../../src/models";

describe("Selector parser & resolver", () => {
  test("parseBoundsRect parses bracket format", () => {
    const rect = parseBoundsRect("[270,1754][450,2058]");
    expect(rect).toEqual({ x1: 270, y1: 1754, x2: 450, y2: 2058 });
  });

  test("parseBoundsRect parses comma format", () => {
    const rect = parseBoundsRect("270,1754,450,2058");
    expect(rect).toEqual({ x1: 270, y1: 1754, x2: 450, y2: 2058 });
  });

  test("rectOverlapRatio calculates overlap", () => {
    const r1 = { x1: 0, y1: 0, x2: 100, y2: 100 };
    const r2 = { x1: 0, y1: 0, x2: 100, y2: 100 };
    expect(rectOverlapRatio(r1, r2)).toBe(1.0);
  });

  test("resolveSelector matches exact text", () => {
    const elements: ActionElement[] = [
      {
        index: 0,
        text: "Settings",
        resourceId: "id/settings",
        contentDesc: "",
        className: "Button",
        bounds: "[10,10][100,100]",
        clickable: true,
        scrollable: false,
        focused: false,
        visible_to_selector_engine: true,
      },
    ];

    const match = resolveSelector(elements, { text: "Settings" });
    expect(match.element.text).toBe("Settings");
    expect(match.centerX).toBe(55);
    expect(match.centerY).toBe(55);
  });

  test("resolveSelector matches text_contains and desc_contains substring", () => {
    const elements: ActionElement[] = [
      {
        index: 0,
        text: "Wi-Fi Preferences",
        resourceId: "id/wifi",
        contentDesc: "Open network settings",
        className: "Button",
        bounds: "[10,10][100,100]",
        clickable: true,
        scrollable: false,
        focused: false,
        visible_to_selector_engine: true,
      },
    ];

    const matchText = resolveSelector(elements, parseSelectorArgs({ text_contains: "Wi-Fi" }));
    expect(matchText.element.text).toBe("Wi-Fi Preferences");

    const matchDesc = resolveSelector(elements, parseSelectorArgs({ desc_contains: "network" }));
    expect(matchDesc.element.contentDesc).toBe("Open network settings");
  });
});
