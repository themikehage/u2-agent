import { describe, it, expect } from "bun:test";
import type { ActionElement } from "../../src/models";
import {
  computeNodeKey,
  computeSemanticDiff,
  formatSemanticDiffCompact,
  computeScreenFingerprint,
} from "../../src/domains/ui";

describe("SemanticDiff Engine & Token Footprint", () => {
  const baseElements: ActionElement[] = [
    {
      index: 0,
      ref: "@1",
      text: "Feed",
      resourceId: "",
      contentDesc: "",
      className: "android.widget.TextView",
      bounds: "[0,0][1080,100]",
      clickable: false,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    },
    {
      index: 1,
      ref: "@2",
      text: "Me gusta",
      resourceId: "com.example:id/like_btn",
      contentDesc: "",
      className: "android.widget.Button",
      bounds: "[100,500][300,600]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    },
    {
      index: 2,
      ref: "@3",
      text: "2 comentarios",
      resourceId: "",
      contentDesc: "",
      className: "android.widget.TextView",
      bounds: "[320,500][600,600]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    },
    {
      index: 3,
      ref: "@4",
      text: "Compartir",
      resourceId: "",
      contentDesc: "",
      className: "android.widget.Button",
      bounds: "[700,500][1000,600]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    },
  ];

  it("nodeKey is stable without resourceId", () => {
    const el1: ActionElement = {
      index: 0,
      ref: "@1",
      text: "Search",
      resourceId: "",
      contentDesc: "",
      className: "android.widget.EditText",
      bounds: "[50,100][500,200]",
      clickable: true,
      scrollable: false,
      focused: true,
      visible_to_selector_engine: true,
    };
    const key = computeNodeKey(el1);
    expect(key).toContain("android.widget.EditText");
    expect(key).toContain("Search");
    expect(key).toContain("50,100,500,200");
  });

  it("nodeKey collision tiebreak works in computeSemanticDiff", () => {
    const duplicates: ActionElement[] = [
      { ...baseElements[0], index: 0, ref: "@1", text: "Item" },
      { ...baseElements[0], index: 1, ref: "@2", text: "Item" },
    ];
    const diff = computeSemanticDiff(duplicates, "fp1", duplicates, "fp1");
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.modified.length).toBe(0);
  });

  it("diff is empty on identical fingerprints (early exit)", () => {
    const fp = computeScreenFingerprint(baseElements);
    const diff = computeSemanticDiff(baseElements, fp, baseElements, fp);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.modified.length).toBe(0);

    const formatted = formatSemanticDiffCompact(diff, "com.example.app");
    expect(formatted).toContain("unchanged");
  });

  it("diff detects text and state modifications in place", () => {
    const fp1 = computeScreenFingerprint(baseElements);

    const nextElements: ActionElement[] = [
      baseElements[0], // Feed (unchanged)
      {
        ...baseElements[1],
        text: "Te gusta",
        focused: true,
      },
      {
        ...baseElements[2],
        text: "3 comentarios",
      },
      baseElements[3], // Compartir (unchanged)
    ];
    const fp2 = computeScreenFingerprint(nextElements);

    const diff = computeSemanticDiff(baseElements, fp1, nextElements, fp2);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.modified.length).toBe(2);

    const modLike = diff.modified.find((m) => m.ref === "@2");
    expect(modLike).toBeDefined();
    expect(modLike?.changes.text).toBe("Te gusta");
    expect(modLike?.changes.focused).toBe(true);

    const modComment = diff.modified.find((m) => m.ref === "@3");
    expect(modComment).toBeDefined();
    expect(modComment?.changes.text).toBe("3 comentarios");
  });

  it("diff detects added and removed nodes", () => {
    const fp1 = computeScreenFingerprint(baseElements);

    // Remove Compartir (@4), Add Guardar (@5)
    const nextElements: ActionElement[] = [
      baseElements[0],
      baseElements[1],
      baseElements[2],
      {
        index: 3,
        ref: "@5",
        text: "Guardar",
        resourceId: "",
        contentDesc: "",
        className: "android.widget.Button",
        bounds: "[700,700][1000,800]",
        clickable: true,
        scrollable: false,
        focused: false,
        visible_to_selector_engine: true,
      },
    ];
    const fp2 = computeScreenFingerprint(nextElements);

    const diff = computeSemanticDiff(baseElements, fp1, nextElements, fp2);
    expect(diff.removed.length).toBe(1);
    expect(diff.removed[0].ref).toBe("@4");
    expect(diff.removed[0].text).toBe("Compartir");

    expect(diff.added.length).toBe(1);
    expect(diff.added[0].ref).toBe("@5");
    expect(diff.added[0].text).toBe("Guardar");
  });

  it("diff token footprint is under 200 chars for standard 3-change delta (REGRESSION GATE)", () => {
    const fp1 = "a1b2c3d4";
    const fp2 = "e5f6a7b8";

    // 1 removed (@4), 1 modified (@3), 1 added (@5)
    const nextElements: ActionElement[] = [
      baseElements[0],
      baseElements[1],
      { ...baseElements[2], text: "3 comentarios" },
      {
        index: 3,
        ref: "@5",
        text: "Guardar",
        resourceId: "",
        contentDesc: "",
        className: "android.widget.Button",
        bounds: "[700,700][1000,800]",
        clickable: true,
        scrollable: false,
        focused: false,
        visible_to_selector_engine: true,
      },
    ];

    const diff = computeSemanticDiff(baseElements, fp1, nextElements, fp2);
    const compactText = formatSemanticDiffCompact(diff, "com.facebook.katana");

    expect(compactText).toContain("[App: com.facebook.katana | diff: a1b2c3d4 -> e5f6a7b8]");
    expect(compactText).toContain("- [@4] Button \"Compartir\"");
    expect(compactText).toContain("+ [@5] Button \"Guardar\"");
    expect(compactText).toContain("~ [@3] Button \"2 comentarios\" -> \"3 comentarios\"");

    // Regression gate: length must be < 200 chars
    expect(compactText.length).toBeLessThan(200);
  });
});
