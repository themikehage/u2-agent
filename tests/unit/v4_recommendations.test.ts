import { describe, test, expect } from "bun:test";
import { deduplicateAndFilterElements, formatCompactSnapshot, UI_DOMAIN } from "../../src/domains/ui";
import { APP_DOMAIN } from "../../src/domains/app";
import { renderOutput, formatSuccessEnvelope } from "../../src/output";
import type { ActionElement } from "../../src/models";

describe("Phase 1 Performance & Quick Wins Fixes", () => {
  test("Dedup: ancestor and descendant with identical text label merge into one actionable element", () => {
    const parentButton: ActionElement = {
      index: 0,
      ref: "@1",
      text: "Amigos, pestaña 3 de 6, 8 nuevos",
      contentDesc: "",
      className: "android.widget.Button",
      bounds: "[0,100][300,200]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const childItem: ActionElement = {
      index: 1,
      ref: "@2",
      text: "Amigos, pestaña 3 de 6, 8 nuevos",
      contentDesc: "",
      className: "android.widget.TextView",
      bounds: "[50,120][250,180]",
      clickable: false,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const result = deduplicateAndFilterElements([parentButton, childItem]);
    expect(result.length).toBe(1);
    expect(result[0].text).toBe("Amigos, pestaña 3 de 6, 8 nuevos");
    expect(result[0].clickable).toBe(true);
  });

  test("ui.type tool schema has optional screen_fingerprint", () => {
    const typeTool = UI_DOMAIN.tools.find((t) => t.name === "ui.type");
    expect(typeTool).toBeDefined();
    const parsed = typeTool?.outputSchema.safeParse({
      text_typed: "Hello",
      postcondition: { satisfied: true },
    });
    expect(parsed?.success).toBe(true);
  });

  test("ui.press tool schema supports pressed without screen_fingerprint", () => {
    const pressTool = UI_DOMAIN.tools.find((t) => t.name === "ui.press");
    expect(pressTool).toBeDefined();
    const parsed = pressTool?.outputSchema.safeParse({
      key: "back",
      pressed: true,
    });
    expect(parsed?.success).toBe(true);
  });

  test("app.start output schema includes optional launcher flag", () => {
    const startTool = APP_DOMAIN.tools.find((t) => t.name === "app.start");
    expect(startTool).toBeDefined();
    const parsed = startTool?.outputSchema.safeParse({
      package: "com.google.android.youtube",
      started: true,
      launcher: true,
    });
    expect(parsed?.success).toBe(true);
  });
});

describe("Phase 2 Robustness & Token Reduction", () => {
  test("formatCompactSnapshot displays centroid for unlabeled buttons (@x=N,y=N)", () => {
    const emptyButton: ActionElement = {
      index: 0,
      ref: "@1",
      text: "",
      contentDesc: "",
      className: "android.widget.ImageButton",
      bounds: "[100,500][200,600]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const snapshot = formatCompactSnapshot([emptyButton], "com.facebook.katana");
    expect(snapshot).toContain('[@1] Button @x=150,y=550');
  });

  test("formatCompactSnapshot formats locked screen header with unlock hint", () => {
    const el: ActionElement = {
      index: 0,
      ref: "@1",
      text: "Emergencia",
      contentDesc: "",
      className: "android.widget.Button",
      bounds: "[100,100][300,200]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const snapshot = formatCompactSnapshot([el], "com.android.systemui", undefined, undefined, undefined, true);
    expect(snapshot).toContain("[App: com.android.systemui | locked: true | hint: run device unlock]");
  });

  test("ui.state tool is registered and validates outputSchema", () => {
    const stateTool = UI_DOMAIN.tools.find((t) => t.name === "ui.state");
    expect(stateTool).toBeDefined();
    const parsed = stateTool?.outputSchema.safeParse({
      screen_fingerprint: "a1b2c3d4e5f6",
      package: "com.android.settings",
      changed: true,
      locked: false,
    });
    expect(parsed?.success).toBe(true);
  });

  test("renderOutput formats ui.state into compact state line", () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output += msg + "\n";
    };

    try {
      renderOutput(
        formatSuccessEnvelope("ui.state", "da0f5e72", {
          screen_fingerprint: "f1a2b3c4",
          package: "com.android.settings",
          changed: true,
        }),
        false
      );
      expect(output.trim()).toBe("[App: com.android.settings | fingerprint: f1a2b3c4 | changed: yes]");
    } finally {
      console.log = originalLog;
    }
  });
});
