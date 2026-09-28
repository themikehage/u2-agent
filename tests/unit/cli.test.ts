import { describe, expect, test } from "bun:test";
import { parseArgs } from "../../src/cli";
import { renderOutput, formatErrorEnvelope, formatSuccessEnvelope } from "../../src/output";
import { UsageError } from "../../src/errors";

describe("CLI Argument Parser & Output Formatting", () => {
  test("normalizes kebab-case flags to snake_case for tool arguments", () => {
    const parsed = parseArgs([
      "ui",
      "tap",
      "--from-pos",
      "100,200",
      "--duration-steps",
      "50",
      "--expect-text-contains",
      "Welcome",
      "--use-daemon",
      "--no-include-handles",
    ]);

    expect(parsed.domain).toBe("ui");
    expect(parsed.subcommand).toBe("tap");
    expect(parsed.toolArgs.from_pos).toBe("100,200");
    expect(parsed.toolArgs.duration_steps).toBe(50);
    expect(parsed.toolArgs.expect_text_contains).toBe("Welcome");
    expect(parsed.toolArgs.use_daemon).toBe(true);
    expect(parsed.toolArgs.include_handles).toBe(false);
  });

  test("emits warnings to stderr before rendering result", () => {
    let stderrOutput = "";
    let stdoutOutput = "";
    const origErr = console.error;
    const origLog = console.log;

    console.error = (msg: string) => {
      stderrOutput += msg + "\n";
    };
    console.log = (msg: string) => {
      stdoutOutput += msg + "\n";
    };

    try {
      const envelope = formatSuccessEnvelope("ui.tap", "da0f5e72", { tapped: true }, [
        "Ambiguous selector matched 3 elements; choosing first in document order",
      ]);
      renderOutput(envelope, false);

      expect(stderrOutput).toContain("Warning: Ambiguous selector matched 3 elements; choosing first in document order");
      expect(stdoutOutput.trim()).toBe("ok");
    } finally {
      console.error = origErr;
      console.log = origLog;
    }
  });

  test("emits error code, message, hint and retryable to stderr", () => {
    let stderrOutput = "";
    const origErr = console.error;
    console.error = (msg: string) => {
      stderrOutput += msg + "\n";
    };

    try {
      const err = new UsageError("No element matched selector", "Use ui.snapshot first to see available elements");
      const envelope = formatErrorEnvelope("ui.tap", err, "da0f5e72");
      renderOutput(envelope, false);

      expect(stderrOutput).toContain("Error [USAGE]: No element matched selector");
      expect(stderrOutput).toContain("hint: Use ui.snapshot first to see available elements");
      expect(stderrOutput).toContain("retryable: false");
    } finally {
      console.error = origErr;
    }
  });
});
