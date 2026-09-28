import { describe, test, expect, beforeEach } from "bun:test";
import { registry, type HandlerContext } from "../../src/registry";
import { DOMAINS } from "../../src/domains";
import { executeBatchSteps } from "../../src/domains/run";
import { UsageError } from "../../src/errors";

describe("Batch Execution (run.steps)", () => {
  beforeEach(() => {
    for (const d of DOMAINS) {
      try {
        registry.registerDomain(d);
      } catch {
        // Domain already registered
      }
    }
  });

  test("Executes valid sequence of steps", async () => {
    const mockCtx: HandlerContext = {
      timeout: 30,
      debug: false,
      warnings: [],
      warn: () => {},
      callTool: async () => ({} as any),
    };

    // We can run tools.list as a read step
    const steps = [
      { tool: "tools.list", args: {} },
    ];

    const res = await executeBatchSteps(steps, mockCtx);
    expect(res.completed_steps).toBe(1);
    expect(res.total_steps).toBe(1);
    expect(res.aborted).toBe(false);
    expect(res.step_results).toBeArray();
  });

  test("Fails on non-existent tool in batch", async () => {
    const mockCtx: HandlerContext = {
      timeout: 30,
      debug: false,
      warnings: [],
      warn: () => {},
      callTool: async () => ({} as any),
    };

    const steps = [
      { tool: "invalid.tool", args: {} },
    ];

    const res = await executeBatchSteps(steps, mockCtx);
    expect(res.completed_steps).toBe(0);
    expect(res.total_steps).toBe(1);
    expect(res.aborted).toBe(true);
    expect(res.failed_step).toBeDefined();
  });

  test("Throws UsageError on empty steps array", async () => {
    const mockCtx: HandlerContext = {
      timeout: 30,
      debug: false,
      warnings: [],
      warn: () => {},
      callTool: async () => ({} as any),
    };

    expect(executeBatchSteps([], mockCtx)).rejects.toThrow(UsageError);
  });
});
