import { z } from "zod";
import type { DomainSpec } from "../registry";
import { DaemonClient } from "../daemon/client";
import { selectTargetDevice } from "../runtime/adb";

export const DAEMON_DOMAIN: DomainSpec = {
  name: "daemon",
  description: "Background cache daemon process lifecycle and health monitoring",
  tools: [
    {
      name: "daemon.status",
      domain: "daemon",
      description: "Check status, port, PID, version build_id, and health of local background daemon",
      inputSchema: z.object({}),
      outputSchema: z.object({
        running: z.boolean(),
        serial: z.string().optional(),
        port: z.number().optional(),
        pid: z.number().optional(),
        build_id: z.string().optional(),
        health: z.record(z.unknown()).optional(),
      }),
      safety: "read",
      handler: async (ctx) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;
        const serial = target.serial;
        const client = new DaemonClient(serial);
        const status = await client.getStatus();
        return {
          serial,
          ...status,
        };
      },
    },
    {
      name: "daemon.restart",
      domain: "daemon",
      description: "Restart background daemon for specified device target",
      inputSchema: z.object({}),
      outputSchema: z.object({
        restarted: z.boolean(),
        serial: z.string().optional(),
        port: z.number().optional(),
        pid: z.number().optional(),
        build_id: z.string().optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ restarted: z.literal(true) }),
      },
      handler: async (ctx) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;
        const serial = target.serial;
        const client = new DaemonClient(serial);
        await client.stopDaemon();
        const port = await client.ensureDaemon();
        const status = await client.getStatus();
        return {
          restarted: true,
          serial,
          port,
          pid: status.pid,
          build_id: status.build_id,
        };
      },
    },
    {
      name: "daemon.stop",
      domain: "daemon",
      description: "Stop background daemon and remove config file for target device",
      inputSchema: z.object({}),
      outputSchema: z.object({
        stopped: z.boolean(),
        serial: z.string().optional(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ stopped: z.literal(true) }),
      },
      handler: async (ctx) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;
        const serial = target.serial;
        const client = new DaemonClient(serial);
        const stopped = await client.stopDaemon();
        return {
          stopped: true,
          serial,
        };
      },
    },
  ],
};
