import { z } from "zod";
import type { DomainSpec } from "../registry";
import { selectTargetDevice, listAdbDevices, reconnectDevice, execAdb } from "../runtime/adb";
import { DeviceSession } from "../runtime/device";
import { DeviceNoneError, DeviceAmbiguousError, UsageError } from "../errors";

export const DEVICE_DOMAIN: DomainSpec = {
  name: "device",
  description: "Device discovery, status, inspection, and connection recovery",
  tools: [
    {
      name: "device.list",
      domain: "device",
      description: "List all connected ADB devices with status and transport type",
      inputSchema: z.object({
        online: z.boolean().optional().default(false),
      }),
      outputSchema: z.object({
        devices: z.array(
          z.object({
            serial: z.string(),
            state: z.string(),
            model: z.string(),
            transport: z.string(),
            selected: z.boolean().optional(),
          })
        ),
      }),
      safety: "read",
      handler: async (_, args) => {
        let devices = await listAdbDevices();
        if (args.online) {
          devices = devices.filter((d) => d.state === "device");
        }
        return { devices };
      },
    },
    {
      name: "device.auto",
      domain: "device",
      description: "Auto-detect and resolve the single online Android device serial",
      inputSchema: z.object({}),
      outputSchema: z.object({
        serial: z.string(),
        model: z.string(),
        state: z.string(),
      }),
      safety: "read",
      handler: async () => {
        const devices = await listAdbDevices();
        const online = devices.filter((d) => d.state === "device");
        if (online.length === 0) {
          throw new DeviceNoneError();
        }
        if (online.length > 1) {
          throw new DeviceAmbiguousError(online.map((d) => d.serial).join(", "));
        }
        return {
          serial: online[0].serial,
          model: online[0].model,
          state: online[0].state,
        };
      },
    },
    {
      name: "device.status",
      domain: "device",
      description: "Check status and selected state of target device",
      inputSchema: z.object({}),
      outputSchema: z.object({
        serial: z.string(),
        state: z.string(),
        model: z.string(),
        transport: z.string(),
        ready: z.boolean(),
      }),
      safety: "read",
      handler: async (ctx) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;
        return {
          serial: target.serial,
          state: target.state,
          model: target.model,
          transport: target.transport,
          ready: target.state === "device",
        };
      },
    },
    {
      name: "device.info",
      domain: "device",
      description: "Get detailed Android device metadata and uiautomator2 runtime info",
      inputSchema: z.object({}),
      outputSchema: z.object({
        serial: z.string(),
        model: z.string(),
        sdk_version: z.string(),
        screen_on: z.boolean(),
        display_width: z.number(),
        display_height: z.number(),
        current_package: z.string(),
      }),
      safety: "read",
      handler: async (ctx) => {
        const session = new DeviceSession(ctx.serial, ctx.timeout);
        const client = await session.connect();
        ctx.serial = session.serial;

        const info = await client.deviceInfo();
        const { stdout: sdkOut } = await execAdb(["-s", session.serial, "shell", "getprop", "ro.build.version.sdk"]);

        return {
          serial: session.serial,
          model: info.productName || "unknown",
          sdk_version: sdkOut.trim(),
          screen_on: info.screenOn ?? true,
          display_width: info.displayWidth || 0,
          display_height: info.displayHeight || 0,
          current_package: info.currentPackageName || "",
        };
      },
    },
    {
      name: "device.wake",
      domain: "device",
      description: "Wake up device screen using KEYEVENT_WAKEUP",
      inputSchema: z.object({}),
      outputSchema: z.object({
        woken: z.boolean(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ woken: z.literal(true) }),
      },
      handler: async (ctx) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;
        await execAdb(["-s", target.serial, "shell", "input", "keyevent", "224"]);
        return { woken: true };
      },
    },
    {
      name: "device.unlock",
      domain: "device",
      description: "Wake screen and dismiss standard swipe lockscreen",
      inputSchema: z.object({}),
      outputSchema: z.object({
        unlocked: z.boolean(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ unlocked: z.literal(true) }),
      },
      handler: async (ctx) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;

        // Wake screen first
        await execAdb(["-s", target.serial, "shell", "input", "keyevent", "224"]);
        
        // Small delay then swipe up to unlock
        await new Promise((r) => setTimeout(r, 200));

        // Get display dimensions or use sensible defaults
        let width = 1080;
        let height = 2340;
        try {
          const { stdout } = await execAdb(["-s", target.serial, "shell", "wm", "size"]);
          const match = stdout.match(/Physical size:\s*(\d+)x(\d+)/);
          if (match) {
            width = parseInt(match[1], 10);
            height = parseInt(match[2], 10);
          }
        } catch {}

        const startX = Math.round(width / 2);
        const startY = Math.round(height * 0.85);
        const endY = Math.round(height * 0.15);

        // Perform swipe up + menu key to dismiss lockscreen
        await execAdb(["-s", target.serial, "shell", "input", "swipe", String(startX), String(startY), String(startX), String(endY), "150"]);
        await execAdb(["-s", target.serial, "shell", "input", "keyevent", "82"]);

        return { unlocked: true };
      },
    },
    {
      name: "device.screen",
      domain: "device",
      description: "Quickly check if device screen is on or off",
      inputSchema: z.object({}),
      outputSchema: z.object({
        on: z.boolean(),
      }),
      safety: "read",
      handler: async (ctx) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;

        let screenOn = true;
        try {
          const { stdout } = await execAdb(["-s", target.serial, "shell", "dumpsys", "power"]);
          for (const line of stdout.split("\n")) {
            if (line.includes("mHoldingDisplaySuspendBlocker") || line.includes("Display Power: state=")) {
              if (line.includes("false") || line.includes("state=OFF")) {
                screenOn = false;
                break;
              }
              if (line.includes("true") || line.includes("state=ON")) {
                screenOn = true;
                break;
              }
            }
          }
        } catch {
          // Fallback to session
          const session = new DeviceSession(ctx.serial, ctx.timeout);
          const client = await session.connect();
          const info = await client.deviceInfo();
          screenOn = info.screenOn ?? true;
        }

        return { on: screenOn };
      },
    },
    {
      name: "device.reconnect",
      domain: "device",
      description: "Perform soft reconnect or hard adb server restart to recover device connection",
      inputSchema: z.object({
        hard: z.boolean().optional().default(false),
      }),
      outputSchema: z.object({
        message: z.string(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ message: z.string() }),
      },
      handler: async (ctx, args) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;
        const msg = await reconnectDevice(target.serial, args.hard);
        return { message: msg };
      },
    },
    {
      name: "device.clipboard",
      domain: "device",
      description: "Read or write Android system clipboard text",
      inputSchema: z.object({
        action: z.enum(["get", "set"]).optional().default("get").describe("Operation: 'get' to read, 'set' to write"),
        text: z.string().optional().describe("Text content to write when action is 'set'"),
      }),
      outputSchema: z.object({
        action: z.string(),
        text: z.string().optional(),
        success: z.boolean(),
      }),
      safety: "interactive",
      expect: {
        schema: z.object({ success: z.literal(true) }),
      },
      handler: async (ctx, args) => {
        const { target } = await selectTargetDevice(ctx.serial);
        ctx.serial = target.serial;

        if (args.action === "set") {
          if (args.text === undefined) {
            throw new UsageError("Flag '--text' is required when action is 'set'");
          }
          let setOk = false;
          try {
            const session = new DeviceSession(ctx.serial, ctx.timeout);
            const client = await session.connect();
            setOk = await client.setClipboardText(args.text);
          } catch {}

          if (!setOk) {
            await execAdb(["-s", target.serial, "shell", "cmd", "clipboard", "set", "text", args.text]);
          }

          return { action: "set", text: args.text, success: true };
        } else {
          // action === "get"
          let clipText = "";
          let gotClip = false;
          try {
            const session = new DeviceSession(ctx.serial, ctx.timeout);
            const client = await session.connect();
            clipText = await client.getClipboard();
            gotClip = true;
          } catch {}

          if (!gotClip) {
            try {
              const res = await execAdb(["-s", target.serial, "shell", "cmd", "clipboard", "get"]);
              if (res.exitCode === 0) {
                clipText = res.stdout.trim();
              }
            } catch {}
          }

          return { action: "get", text: clipText || "", success: true };
        }
      },
    },
  ],
};
