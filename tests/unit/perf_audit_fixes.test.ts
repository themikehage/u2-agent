import { describe, test, expect } from "bun:test";
import { parseArgs } from "../../src/cli";
import { parseSelectorArgs } from "../../src/selectors/parser";
import { computeScreenFingerprint, UI_DOMAIN } from "../../src/domains/ui";
import { renderOutput } from "../../src/output";
import { BUILD_ID } from "../../src/daemon/server";
import type { ActionElement, JsonEnvelope } from "../../src/models";

describe("Performance Audit & Speed Fixes", () => {
  test("BUILD_ID is updated to v5", () => {
    expect(BUILD_ID).toBe("0.1.0-v5");
  });

  test("CLI parses --ref @12 as string and not boolean", () => {
    const parsed = parseArgs(["ui", "tap", "--ref", "@12"]);
    expect(parsed.toolArgs.ref).toBe("@12");
  });

  test("CLI parses --ref 12 as number/handle and parseSelectorArgs converts to @12", () => {
    const parsed = parseArgs(["ui", "tap", "--ref", "12"]);
    expect(parsed.toolArgs.ref).toBe(12);

    const query = parseSelectorArgs(parsed.toolArgs);
    expect(query.ref).toBe("@12");
  });

  test("CLI parses --ref=@12 correctly", () => {
    const parsed = parseArgs(["ui", "tap", "--ref=@12"]);
    expect(parsed.toolArgs.ref).toBe("@12");
  });

  test("computeScreenFingerprint returns 16-hex characters fast hash", () => {
    const elements: ActionElement[] = [
      {
        index: 0,
        ref: "@1",
        text: "Buscar",
        className: "android.widget.Button",
        bounds: "[0,0][100,100]",
      },
    ];
    const fp1 = computeScreenFingerprint(elements);
    expect(fp1).toHaveLength(16);
    expect(fp1).toMatch(/^[0-9a-f]{16}$/);

    const fp2 = computeScreenFingerprint(elements);
    expect(fp1).toBe(fp2);
  });

  test("ui.type tool schema supports value parameter", () => {
    const tool = UI_DOMAIN.tools.find((t) => t.name === "ui.type");
    expect(tool).toBeDefined();

    const parsed = tool!.inputSchema.parse({
      description: "Search",
      value: "tarta red velvet",
    });
    expect(parsed.value).toBe("tarta red velvet");
  });

  test("ui.dump tool schema includes use_daemon default true", () => {
    const tool = UI_DOMAIN.tools.find((t) => t.name === "ui.dump");
    expect(tool).toBeDefined();

    const parsed = tool!.inputSchema.parse({});
    expect(parsed.use_daemon).toBe(true);
  });

  test("renderOutput dispatches action commands to 'ok'", () => {
    let captured = "";
    const originalLog = console.log;
    console.log = (msg: string) => { captured = msg; };

    try {
      const envelope: JsonEnvelope = {
        schema_version: "1",
        ok: true,
        command: "ui.tap",
        result: { tapped: true, x: 100, y: 200 },
      };
      renderOutput(envelope, false, false);
      expect(captured).toBe("ok");
    } finally {
      console.log = originalLog;
    }
  });
});
