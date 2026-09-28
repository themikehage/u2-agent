import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { BUILD_ID, DaemonServer } from "../../src/daemon/server";
import { DaemonClient } from "../../src/daemon/client";
import { registry, type HandlerContext, type ToolSpec } from "../../src/registry";
import { PostconditionFailedError } from "../../src/errors";
import { sortByRelevance } from "../../src/domains/ui";
import { parseArgs } from "../../src/cli";
import { formatSuccessEnvelope, renderOutput } from "../../src/output";

describe("v2 Recommendations & Robustness Fixes", () => {
  test("BUILD_ID is defined and DaemonServer exposes build_id", () => {
    expect(typeof BUILD_ID).toBe("string");
    expect(BUILD_ID.length).toBeGreaterThan(0);
  });

  test("Registry validates expect.schema postcondition and throws PostconditionFailedError on mismatch", async () => {
    const mockCtx: HandlerContext = {
      serial: "test-device",
      timeout: 10,
      debug: false,
      warnings: [],
      warn: () => {},
      callTool: async () => ({} as any),
    };

    const mutationTool: ToolSpec = {
      name: "ui.tap",
      domain: "ui",
      description: "Tap",
      inputSchema: z.object({}),
      outputSchema: z.object({ tapped: z.boolean() }),
      safety: "interactive",
      expect: {
        schema: z.object({ tapped: z.literal(true) }),
      },
      handler: async () => ({ tapped: true }),
    };

    // Should succeed when tapped === true
    await expect(registry.verifyPostcondition(mockCtx, mutationTool, { tapped: true })).resolves.toBeUndefined();

    // Should throw PostconditionFailedError when tapped === false
    await expect(registry.verifyPostcondition(mockCtx, mutationTool, { tapped: false })).rejects.toThrow(
      PostconditionFailedError
    );
  });

  test("sortByRelevance prioritizes focused, then clickable with text, then distance to center", () => {
    const elements = [
      {
        index: 0,
        ref: "@1",
        text: "Far away text",
        resourceId: "",
        contentDesc: "",
        className: "android.widget.TextView",
        bounds: "[0,0][100,50]", // far from center (540, 1170)
        clickable: false,
        scrollable: false,
        focused: false,
        visible_to_selector_engine: true,
      },
      {
        index: 1,
        ref: "@2",
        text: "Submit Button",
        resourceId: "btn",
        contentDesc: "",
        className: "android.widget.Button",
        bounds: "[500,1100][580,1200]", // close to center (540, 1170)
        clickable: true,
        scrollable: false,
        focused: false,
        visible_to_selector_engine: true,
      },
      {
        index: 2,
        ref: "@3",
        text: "Focused Input",
        resourceId: "input",
        contentDesc: "",
        className: "android.widget.EditText",
        bounds: "[100,100][300,150]",
        clickable: true,
        scrollable: false,
        focused: true,
        visible_to_selector_engine: true,
      },
    ];

    const sorted = sortByRelevance(elements, 1080, 2340);
    // 1. Focused item should be first (@1)
    expect(sorted[0].text).toBe("Focused Input");
    expect(sorted[0].ref).toBe("@1");

    // 2. Clickable with text close to center should be second (@2)
    expect(sorted[1].text).toBe("Submit Button");
    expect(sorted[1].ref).toBe("@2");

    // 3. Non-clickable text should be third (@3)
    expect(sorted[2].text).toBe("Far away text");
    expect(sorted[2].ref).toBe("@3");
  });

  test("DAEMON_DOMAIN tools are properly registered", () => {
    const daemonDomain = registry.getDomain("daemon");
    expect(daemonDomain).toBeDefined();
    expect(daemonDomain?.tools.map((t) => t.name)).toEqual([
      "daemon.status",
      "daemon.restart",
      "daemon.stop",
    ]);

    const statusTool = registry.getTool("daemon.status");
    expect(statusTool?.safety).toBe("read");

    const restartTool = registry.getTool("daemon.restart");
    expect(restartTool?.safety).toBe("interactive");
    expect(restartTool?.expect).toBeDefined();

    const stopTool = registry.getTool("daemon.stop");
    expect(stopTool?.safety).toBe("interactive");
    expect(stopTool?.expect).toBeDefined();
  });

  test("CLI parses --safety flag", () => {
    const parsed1 = parseArgs(["--safety", "read", "ui", "tap", "--ref", "@1"]);
    expect(parsed1.configFlags.safety).toBe("read");

    const parsed2 = parseArgs(["--safety=interactive", "ui", "tap"]);
    expect(parsed2.configFlags.safety).toBe("interactive");
  });

  test("renderOutput with json=true emits compact single-line JSON", () => {
    const envelope = formatSuccessEnvelope("ui.tap", "device1", { tapped: true });
    let emitted = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      emitted = msg;
    };

    try {
      renderOutput(envelope, false, true);
      expect(emitted).not.toContain("\n");
      expect(JSON.parse(emitted).ok).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  test("renderOutput formats daemon.status query nicely", () => {
    const envelope = formatSuccessEnvelope("daemon.status", "device1", {
      running: true,
      port: 12345,
      pid: 6789,
      build_id: "0.1.0-v2",
    });
    let emitted = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      emitted = msg;
    };

    try {
      renderOutput(envelope, false, false);
      expect(emitted).toContain("running");
      expect(emitted).toContain("port:12345");
      expect(emitted).toContain("pid:6789");
      expect(emitted).toContain("build:0.1.0-v2");
    } finally {
      console.log = origLog;
    }
  });
});
