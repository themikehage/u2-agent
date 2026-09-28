import { describe, expect, test } from "bun:test";
import { getSemanticRole, formatCompactSnapshot } from "../../src/domains/ui";
import { TOOLS_DOMAIN } from "../../src/domains/tools";
import "../../src/cli"; // ensures registry is initialized

describe("Optimization Fixes Validation", () => {
  test("getSemanticRole does not mislabel Spanish phrases with ' de ' as Tab", () => {
    const profileElement = {
      index: 0,
      text: "Ver perfil de Julio Chirinos",
      resourceId: "com.linkedin.android:id/feed_profile",
      contentDesc: "",
      className: "android.widget.TextView",
      bounds: "[0,0][100,100]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    expect(getSemanticRole(profileElement)).toBe("Button");

    const tabElement = {
      index: 1,
      text: "Feed",
      resourceId: "com.linkedin.android:id/tab_bar_feed",
      contentDesc: "",
      className: "android.widget.TextView",
      bounds: "[0,0][100,100]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    expect(getSemanticRole(tabElement)).toBe("Tab");
  });

  test("formatCompactSnapshot does not use raw resourceId as label", () => {
    const element = {
      index: 0,
      ref: "@1",
      text: "",
      resourceId: "com.linkedin.android:id/ugly_long_resource_id_feed",
      contentDesc: "",
      className: "android.widget.Button",
      bounds: "[0,0][100,100]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const snapshot = formatCompactSnapshot([element], "com.test");
    expect(snapshot).not.toContain("ugly_long_resource_id_feed");
    expect(snapshot).toContain("[@1] Button");
  });

  test("formatCompactSnapshot excludes screen_fingerprint by default and supports changed", () => {
    const element = {
      index: 0,
      ref: "@1",
      text: "Submit",
      resourceId: "",
      contentDesc: "",
      className: "android.widget.Button",
      bounds: "[0,0][100,100]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    const defaultSnapshot = formatCompactSnapshot([element], "com.test");
    expect(defaultSnapshot).toBe('[App: com.test]\n[@1] Button "Submit"');

    const changedSnapshot = formatCompactSnapshot([element], "com.test", undefined, true);
    expect(changedSnapshot).toContain("[App: com.test | changed: yes]");
  });

  test("tools.show provides parameter definitions", async () => {
    const showTool = TOOLS_DOMAIN.tools.find((t) => t.name === "tools.show")!;
    const ctx: any = {};
    const res: any = await showTool.handler(ctx, { name: "ui.tap" });

    expect(res.name).toBe("ui.tap");
    expect(res.parameters).toBeDefined();
    expect(res.parameters.expect_text_contains).toBeDefined();
    expect(res.parameters.use_daemon).toBeDefined();
  });

  test("tools.schema exports populated openai parameters schema", async () => {
    const schemaTool = TOOLS_DOMAIN.tools.find((t) => t.name === "tools.schema")!;
    const ctx: any = {};
    const res: any = await schemaTool.handler(ctx, { format: "openai" });

    expect(res.functions).toBeDefined();
    const tapFn = res.functions.find((f: any) => f.name === "ui_tap");
    expect(tapFn).toBeDefined();
    expect(tapFn.parameters.properties.use_daemon).toBeDefined();
    expect(tapFn.parameters.properties.use_daemon.type).toBe("boolean");
  });
});
