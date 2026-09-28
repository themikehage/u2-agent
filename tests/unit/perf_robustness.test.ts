import { describe, expect, test } from "bun:test";
import { RuntimeDownError, DeviceOfflineError, ExitCode } from "../../src/errors";
import { parseArgs } from "../../src/cli";
import { resolveConfig } from "../../src/config";
import { formatSuccessEnvelope, renderOutput } from "../../src/output";
import { parseXmlDump, deduplicateAndFilterElements, formatCompactSnapshot } from "../../src/domains/ui";

describe("Performance & Robustness Enhancements", () => {
  test("RuntimeDownError has code UIAUTOMATOR_DOWN and exit code PROVISION", () => {
    const err = new RuntimeDownError("test-serial", "connection refused");
    expect(err.code).toBe("UIAUTOMATOR_DOWN");
    expect(err.exitCode).toBe(ExitCode.PROVISION);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("test-serial");
    expect(err.message).toContain("connection refused");
  });

  test("CLI parses --json flag into config.json = true", () => {
    const parsed = parseArgs(["ui", "snapshot", "--json"]);
    expect(parsed.configFlags.json).toBe(true);

    const config = resolveConfig(parsed.configFlags);
    expect(config.json).toBe(true);
  });

  test("renderOutput with json=true emits valid JSON envelope to stdout", () => {
    const envelope = formatSuccessEnvelope("ui.snapshot", "test-device", { snapshot: "test snapshot" });
    let outputStr = "";
    const origLog = console.log;
    console.log = (msg: string) => {
      outputStr += msg;
    };

    try {
      renderOutput(envelope, false, true);
      const parsed = JSON.parse(outputStr);
      expect(parsed.ok).toBe(true);
      expect(parsed.command).toBe("ui.snapshot");
      expect(parsed.device).toBe("test-device");
      expect(parsed.result.snapshot).toBe("test snapshot");
    } finally {
      console.log = origLog;
    }
  });

  test("formatCompactSnapshot displays truncation message when totalCount > elements.length", () => {
    const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.test" bounds="[0,0][1080,2400]">
    <node index="1" text="Item 1" resource-id="" class="android.widget.TextView" package="com.test" bounds="[10,10][100,50]" />
  </node>
</hierarchy>`;
    const elements = parseXmlDump(xml);
    const snapshot = formatCompactSnapshot(elements, "com.test", "fp123", undefined, 10);
    expect(snapshot).toContain("9 more elements truncated, use --limit to expand");
  });

  test("deduplicateAndFilterElements correctly handles grid bucketing with multiple elements", () => {
    const elements = [
      {
        index: 0,
        ref: "@1",
        text: "Button 1",
        resourceId: "btn1",
        contentDesc: "",
        className: "android.widget.Button",
        bounds: "[10,10][100,50]",
        clickable: true,
        scrollable: false,
        focused: false,
        visible_to_selector_engine: true,
      },
      {
        index: 1,
        ref: "@2",
        text: "Button 2",
        resourceId: "btn2",
        contentDesc: "",
        className: "android.widget.Button",
        bounds: "[500,500][600,550]",
        clickable: true,
        scrollable: false,
        focused: false,
        visible_to_selector_engine: true,
      },
    ];

    const result = deduplicateAndFilterElements(elements);
    expect(result.length).toBe(2);
    expect(result[0].text).toBe("Button 1");
    expect(result[1].text).toBe("Button 2");
  });
});
