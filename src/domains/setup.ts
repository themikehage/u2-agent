import { z } from "zod";
import type { DomainSpec } from "../registry";
import { verifySetup, installSetup, diagnoseSetup } from "../runtime/provisioning";

export const SETUP_DOMAIN: DomainSpec = {
  name: "setup",
  description: "Idempotent device provisioning, verification, and diagnostics",
  tools: [
    {
      name: "setup.verify",
      domain: "setup",
      description: "Read-only verification of device readiness and uiautomator2 runtime",
      inputSchema: z.object({}),
      outputSchema: z.object({
        status: z.enum(["ready", "not_ready"]),
        steps: z.array(
          z.object({
            name: z.string(),
            status: z.enum(["installed", "already_present", "skipped", "failed"]),
            detail: z.string(),
          })
        ),
      }),
      safety: "read",
      handler: async (ctx) => {
        return await verifySetup(ctx.serial);
      },
    },
    {
      name: "setup.install",
      domain: "setup",
      description: "Idempotently provision device runtime and helper services",
      inputSchema: z.object({
        keep_awake: z.boolean().optional().default(false),
      }),
      outputSchema: z.object({
        status: z.enum(["ready", "not_ready"]),
        steps: z.array(
          z.object({
            name: z.string(),
            status: z.enum(["installed", "already_present", "skipped", "failed"]),
            detail: z.string(),
          })
        ),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ status: z.literal("ready") }),
      },
      handler: async (ctx, args) => {
        return await installSetup(ctx.serial, args.keep_awake);
      },
    },
    {
      name: "setup.diagnose",
      domain: "setup",
      description: "Collect diagnostic facts from device without mutating state",
      inputSchema: z.object({}),
      outputSchema: z.record(z.unknown()),
      safety: "read",
      handler: async (ctx) => {
        return await diagnoseSetup(ctx.serial);
      },
    },
  ],
};
