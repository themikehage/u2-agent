import { test, expect, describe } from "bun:test";
import { registry } from "../../src/registry";
import { parseArgs, runCli } from "../../src/cli";
import { formatSuccessEnvelope, renderOutput } from "../../src/output";

describe("Performance Audit Improvements (v6)", () => {
  test("device domain includes wake, unlock, and screen tools", () => {
    const wakeTool = registry.getTool("device.wake");
    expect(wakeTool).toBeDefined();
    expect(wakeTool?.domain).toBe("device");

    const unlockTool = registry.getTool("device.unlock");
    expect(unlockTool).toBeDefined();

    const screenTool = registry.getTool("device.screen");
    expect(screenTool).toBeDefined();
  });

  test("app domain includes app.restart tool", () => {
    const restartTool = registry.getTool("app.restart");
    expect(restartTool).toBeDefined();
    expect(restartTool?.inputSchema.safeParse({ package: "com.facebook.katana" }).success).toBe(true);
  });

  test("ui domain includes ui.keyboard_hide tool and scroll snapshot option", () => {
    const kbTool = registry.getTool("ui.keyboard_hide");
    expect(kbTool).toBeDefined();

    const scrollTool = registry.getTool("ui.scroll");
    expect(scrollTool).toBeDefined();
    const parsedArgs = scrollTool?.inputSchema.parse({ direction: "down", snapshot: true });
    expect(parsedArgs.snapshot).toBe(true);
  });

  test("renderOutput renders device.screen as on/off and action commands as ok", () => {
    const outputs: string[] = [];
    const origLog = console.log;
    console.log = (msg: any) => outputs.push(String(msg));

    try {
      // Screen on
      renderOutput(formatSuccessEnvelope("device.screen", "emulator-5554", { on: true }));
      expect(outputs.pop()).toBe("on");

      // Screen off
      renderOutput(formatSuccessEnvelope("device.screen", "emulator-5554", { on: false }));
      expect(outputs.pop()).toBe("off");

      // device.wake
      renderOutput(formatSuccessEnvelope("device.wake", "emulator-5554", { woken: true }));
      expect(outputs.pop()).toBe("ok");

      // device.unlock
      renderOutput(formatSuccessEnvelope("device.unlock", "emulator-5554", { unlocked: true }));
      expect(outputs.pop()).toBe("ok");

      // ui.keyboard_hide
      renderOutput(formatSuccessEnvelope("ui.keyboard_hide", "emulator-5554", { hidden: true }));
      expect(outputs.pop()).toBe("ok");

      // app.restart
      renderOutput(formatSuccessEnvelope("app.restart", "emulator-5554", { package: "com.test", restarted: true }));
      expect(outputs.pop()).toBe("ok");
    } finally {
      console.log = origLog;
    }
  });

  test("runCli with contextual --help prints command specific help", async () => {
    const outputs: string[] = [];
    const origLog = console.log;
    console.log = (msg: any) => outputs.push(String(msg));

    try {
      const exitCode = await runCli(["ui", "press", "--help"]);
      expect(exitCode).toBe(0);
      const fullText = outputs.join("\n");
      expect(fullText).toContain("u2-agent ui press");
      expect(fullText).toContain("--key");
      expect(fullText).toContain("Key name");
    } finally {
      console.log = origLog;
    }
  });

  test("runCli with domain --help prints domain commands list", async () => {
    const outputs: string[] = [];
    const origLog = console.log;
    console.log = (msg: any) => outputs.push(String(msg));

    try {
      const exitCode = await runCli(["device", "--help"]);
      expect(exitCode).toBe(0);
      const fullText = outputs.join("\n");
      expect(fullText).toContain("u2-agent device");
      expect(fullText).toContain("wake");
      expect(fullText).toContain("unlock");
      expect(fullText).toContain("screen");
    } finally {
      console.log = origLog;
    }
  });
});
