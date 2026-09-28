import type { JsonEnvelope } from "./models";
import { U2Error } from "./errors";

export function formatSuccessEnvelope<T = Record<string, unknown>>(
  command: string,
  device?: string,
  result?: T,
  warnings: string[] = []
): JsonEnvelope<T> {
  return {
    schema_version: "1",
    ok: true,
    command,
    ...(device ? { device } : {}),
    result: result ?? ({} as T),
    warnings,
  };
}

export function formatErrorEnvelope(
  command: string,
  error: Error | U2Error,
  device?: string,
  warnings: string[] = []
): JsonEnvelope {
  if (error instanceof U2Error) {
    return {
      schema_version: "1",
      ok: false,
      command,
      ...(device ? { device } : {}),
      warnings,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        hint: error.hint,
        ...(error.details ? { details: error.details } : {}),
      },
    };
  }

  return {
    schema_version: "1",
    ok: false,
    command,
    ...(device ? { device } : {}),
    warnings,
    error: {
      code: "INTERNAL",
      message: error.message || "An unexpected error occurred",
      retryable: false,
      hint: "Report the command + JSON envelope",
    },
  };
}

export function renderOutput(
  envelope: JsonEnvelope,
  quiet: boolean = false,
  json: boolean = false
): void {
  // Always emit warnings to stderr immediately so they are never lost
  if (envelope.warnings && envelope.warnings.length > 0) {
    for (const w of envelope.warnings) {
      console.error(`Warning: ${w}`);
    }
  }

  if (quiet && envelope.ok) {
    return;
  }

  if (json) {
    console.log(JSON.stringify(envelope));
    return;
  }

  if (!envelope.ok && envelope.error) {
    console.error(`Error [${envelope.error.code}]: ${envelope.error.message}`);
    if (envelope.error.hint) {
      console.error(`hint: ${envelope.error.hint}`);
    }
    if (envelope.error.retryable !== undefined) {
      console.error(`retryable: ${envelope.error.retryable}`);
    }
    return;
  }

  const res = envelope.result as Record<string, any> | undefined;

  if (res) {
    // 1. ui.snapshot: output snapshot text string directly
    if (typeof res.snapshot === "string") {
      console.log(res.snapshot);
      return;
    }

    // 1b. ui.state: fast compact state string
    if (envelope.command === "ui.state" || (typeof res.screen_fingerprint === "string" && !res.snapshot && !res.elements)) {
      let stateLine = `[App: ${res.package || "active"} | fingerprint: ${res.screen_fingerprint}`;
      if (res.locked) stateLine += ` | locked: true`;
      if (res.changed !== undefined) stateLine += ` | changed: ${res.changed ? "yes" : "no"}`;
      stateLine += `]`;
      console.log(stateLine);
      return;
    }

    if (envelope.command === "ui.screenshot" && typeof res.path === "string") {
      console.log(res.path);
      return;
    }

    if (envelope.command === "device.clipboard") {
      if (res.action === "get") {
        console.log(res.text ?? "");
        return;
      }
      console.log("ok");
      return;
    }

    if (envelope.command === "ui.notifications") {
      if (res.action === "read" && Array.isArray(res.notifications)) {
        if (res.notifications.length === 0) {
          console.log("none");
        } else {
          const lines = res.notifications.map((n: any) =>
            n.title && n.text ? `[${n.package}] ${n.title}: ${n.text}` : `[${n.package}] ${n.title || n.text}`
          );
          console.log(lines.join("\n"));
        }
        return;
      }
      console.log("ok");
      return;
    }

    // 2. Query commands: app.current, app.list, device.list, device.status/auto, daemon.status
    if (typeof res.running === "boolean") {
      if (res.running) {
        console.log(`running\tport:${res.port}\tpid:${res.pid}\tbuild:${res.build_id || ""}`);
      } else {
        console.log("stopped");
      }
      return;
    }
    if (typeof res.package === "string" && typeof res.activity === "string" && !res.started && !res.stopped) {
      console.log(`${res.package}/${res.activity}`);
      return;
    }
    if (Array.isArray(res.packages)) {
      console.log(res.packages.join("\n"));
      return;
    }
    if (Array.isArray(res.devices)) {
      const lines = res.devices.map((d: any) => `${d.serial}\t${d.state}\t${d.model || ""}`.trim());
      console.log(lines.join("\n"));
      return;
    }
    if (typeof res.serial === "string" && typeof res.state === "string") {
      console.log(`${res.serial}\t${res.state}\t${res.model || ""}`.trim());
      return;
    }

    if (typeof res.on === "boolean" && envelope.command === "device.screen") {
      console.log(res.on ? "on" : "off");
      return;
    }

    // 3. Action commands: check by command name or action flags
    const ACTION_COMMANDS = new Set([
      "ui.tap",
      "ui.press",
      "ui.input",
      "ui.type",
      "ui.swipe",
      "ui.scroll",
      "ui.long_press",
      "ui.keyboard_hide",
      "ui.drag",
      "ui.pinch",
      "app.start",
      "app.stop",
      "app.restart",
      "app.clear",
      "app.open_url",
      "app.grant_permissions",
      "device.wake",
      "device.unlock",
      "device.reconnect",
      "daemon.stop",
      "daemon.restart",
    ]);

    if (
      ACTION_COMMANDS.has(envelope.command) ||
      res.tapped ||
      res.success ||
      res.pressed ||
      res.swiped ||
      res.started ||
      res.stopped ||
      res.restarted ||
      res.cleared ||
      res.opened ||
      res.granted ||
      res.dragged ||
      res.pinched ||
      res.woken ||
      res.unlocked ||
      res.hidden ||
      res.satisfied ||
      res.duration !== undefined ||
      Object.keys(res).length === 0
    ) {
      console.log("ok");
      return;
    }

    // Fallback if result is a raw object
    console.log(JSON.stringify(res, null, 2));
  } else {
    console.log("ok");
  }
}
