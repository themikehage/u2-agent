import { z } from "zod";
import * as fs from "fs";
import type { DomainSpec, HandlerContext } from "../registry";
import { registry } from "../registry";
import { UsageError, InternalError, U2Error } from "../errors";
import { DaemonClient } from "../daemon/client";

export async function executeBatchSteps(
  steps: Array<Record<string, unknown>>,
  ctx: HandlerContext
): Promise<Record<string, unknown>> {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new UsageError("Batch execution requires a non-empty list of steps");
  }

  const stepResults: Array<Record<string, unknown>> = [];
  let aborted = false;
  let failedStep: Record<string, unknown> | undefined = undefined;

  if (ctx.serial) {
    try {
      const daemonClient = new DaemonClient(ctx.serial);
      await daemonClient.ensureDaemon();
    } catch {}
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (typeof step !== "object" || step === null) {
      throw new UsageError(`Step at index ${i} must be an object with 'tool' and 'args'`);
    }

    const toolName = step.tool;
    if (typeof toolName !== "string" || !toolName) {
      throw new UsageError(`Step at index ${i} missing valid 'tool' string`);
    }

    const args = (step.args ?? {}) as Record<string, unknown>;
    if (typeof args !== "object" || args === null) {
      throw new UsageError(`Step at index ${i} 'args' must be an object`);
    }

    const startTime = Date.now();

    try {
      const toolSpec = registry.getTool(toolName);
      if (!toolSpec) {
        throw new UsageError(`Tool '${toolName}' at step index ${i} not found in registry`);
      }

      const validatedInput = toolSpec.inputSchema.parse(args);
      const res = await toolSpec.handler(ctx, validatedInput);
      const validatedResult = toolSpec.outputSchema.parse(res) as Record<string, unknown>;

      await registry.verifyPostcondition(ctx, toolSpec, validatedResult);

      const durationSec = Number(((Date.now() - startTime) / 1000).toFixed(3));
      stepResults.push({
        step_index: i,
        tool: toolName,
        duration_sec: durationSec,
        result: validatedResult,
      });
    } catch (err: any) {
      const durationSec = Number(((Date.now() - startTime) / 1000).toFixed(3));
      aborted = true;

      let uError: U2Error;
      if (err instanceof U2Error) {
        uError = err;
      } else if (err?.name === "ZodError") {
        uError = new UsageError(`Validation error at step ${i} (${toolName}): ${err.message}`);
      } else {
        uError = new InternalError(`Unexpected error at step ${i} (${toolName}): ${err.message || String(err)}`);
      }

      failedStep = {
        step_index: i,
        tool: toolName,
        duration_sec: durationSec,
        error: {
          code: uError.code,
          message: uError.message,
          exit_code: uError.exitCode,
        },
      };
      break;
    }
  }

  const output: Record<string, unknown> = {
    completed_steps: stepResults.length,
    total_steps: steps.length,
    aborted,
    step_results: stepResults,
  };

  if (failedStep) {
    output.failed_step = failedStep;
  }

  return output;
}

export const RUN_DOMAIN: DomainSpec = {
  name: "run",
  description: "Batch execution domain for multi-step atomic sequences",
  tools: [
    {
      name: "run.steps",
      domain: "run",
      description: "Execute multiple commands sequentially in a single process / connection batch.",
      inputSchema: z.object({
        steps: z.string().optional().describe("JSON array string containing step definitions [{'tool': ..., 'args': ...}]"),
        file: z.string().optional().describe("File path to JSON file containing step definitions array"),
      }),
      outputSchema: z.object({
        completed_steps: z.number(),
        total_steps: z.number(),
        aborted: z.boolean(),
        step_results: z.array(z.record(z.unknown())),
        failed_step: z.record(z.unknown()).optional(),
      }),
      safety: "interactive",
      idempotent: false,
      expect: {
        schema: z.object({
          completed_steps: z.number(),
          total_steps: z.number(),
        }),
      },
      handler: async (ctx, args) => {
        const stepsRaw = args.steps;
        const filePath = args.file;

        if (!stepsRaw && !filePath) {
          throw new UsageError("Must provide either '--steps' (JSON string) or '--file' (path to JSON file)");
        }
        if (stepsRaw && filePath) {
          throw new UsageError("Cannot specify both '--steps' and '--file'");
        }

        let stepsData: Array<Record<string, unknown>>;
        if (filePath) {
          if (!fs.existsSync(filePath)) {
            throw new UsageError(`Batch file not found: ${filePath}`);
          }
          try {
            const rawContent = fs.readFileSync(filePath, "utf-8");
            stepsData = JSON.parse(rawContent);
          } catch (e: any) {
            throw new UsageError(`Failed to parse batch JSON file ${filePath}: ${e.message || String(e)}`);
          }
        } else {
          try {
            stepsData = JSON.parse(stepsRaw!);
          } catch (e: any) {
            throw new UsageError(`Failed to parse '--steps' JSON string: ${e.message || String(e)}`);
          }
        }

        if (!Array.isArray(stepsData)) {
          throw new UsageError("Batch steps payload must be a JSON array of step objects");
        }

        return await executeBatchSteps(stepsData, ctx);
      },
    },
  ],
};
