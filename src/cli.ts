import { z } from "zod";
import { resolveConfig, type Config } from "./config";
import { formatSuccessEnvelope, formatErrorEnvelope, renderOutput } from "./output";
import { U2Error, UsageError, InternalError } from "./errors";
import { registry, type HandlerContext, type ToolSpec, type DomainSpec } from "./registry";
import { DOMAINS } from "./domains";

// Register all domains at startup if not already registered
for (const domain of DOMAINS) {
  if (!registry.hasDomain(domain.name)) {
    registry.registerDomain(domain);
  }
}

export function parseArgs(rawArgs: string[]): {
  configFlags: Partial<Config>;
  domain?: string;
  subcommand?: string;
  toolArgs: Record<string, unknown>;
  showHelp: boolean;
  showVersion: boolean;
} {
  const configFlags: Partial<Config> = {};
  const toolArgs: Record<string, unknown> = {};
  const positional: string[] = [];
  let showHelp = false;
  let showVersion = false;

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];

    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      i++;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      showVersion = true;
      i++;
      continue;
    }

    if (arg === "--serial") {
      configFlags.serial = rawArgs[++i];
    } else if (arg.startsWith("--serial=")) {
      configFlags.serial = arg.split("=", 2)[1];
    } else if (arg === "--safety") {
      configFlags.safety = rawArgs[++i] as any;
    } else if (arg.startsWith("--safety=")) {
      configFlags.safety = arg.split("=", 2)[1] as any;
    } else if (arg === "--timeout") {
      configFlags.timeout = Number(rawArgs[++i]);
    } else if (arg.startsWith("--timeout=")) {
      configFlags.timeout = Number(arg.split("=", 2)[1]);
    } else if (arg === "--quiet") {
      configFlags.quiet = true;
    } else if (arg === "--debug") {
      configFlags.debug = true;
    } else if (arg === "--json") {
      configFlags.json = true;
    } else if (arg === "--strict-selector") {
      configFlags.strictSelector = true;
    } else if (arg.startsWith("--no-")) {
      const key = toSnakeCase(arg.slice(5));
      toolArgs[key] = false;
    } else if (arg.startsWith("--")) {
      const param = arg.slice(2);
      if (param.includes("=")) {
        const [k, v] = param.split("=", 2);
        toolArgs[toSnakeCase(k)] = parseTypedValue(v);
      } else {
        const next = rawArgs[i + 1];
        if (next !== undefined && (!next.startsWith("-") || next.startsWith("@") || /^-?\d+$/.test(next))) {
          toolArgs[toSnakeCase(param)] = parseTypedValue(next);
          i++;
        } else {
          toolArgs[toSnakeCase(param)] = true;
        }
      }
    } else {
      positional.push(arg);
    }
    i++;
  }

  const [domain, subcommand] = positional;

  return {
    configFlags,
    domain,
    subcommand,
    toolArgs,
    showHelp,
    showVersion,
  };
}

function toSnakeCase(str: string): string {
  return str.replace(/-/g, "_");
}

function parseTypedValue(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  if (!isNaN(Number(val)) && val.trim() !== "") return Number(val);
  return val;
}

export function printToolHelp(tool: ToolSpec): void {
  const subName = tool.name.split(".", 2)[1];
  console.log(`u2-agent ${tool.domain} ${subName} - ${tool.description}\n`);
  console.log(`Usage:`);
  console.log(`  u2-agent ${tool.domain} ${subName} [options]\n`);

  if (tool.inputSchema && tool.inputSchema instanceof z.ZodObject) {
    const shape = tool.inputSchema.shape;
    const entries = Object.entries(shape);
    if (entries.length > 0) {
      console.log(`Options:`);
      for (const [key, schema] of entries) {
        const flagName = `--${key.replace(/_/g, "-")}`;
        let desc = (schema as any).description || "";
        let typeStr = "";

        let inner: any = schema;
        let isOptional = false;
        let defaultVal: any = undefined;
        while (inner) {
          if (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable) {
            isOptional = true;
            inner = inner.unwrap();
          } else if (inner instanceof z.ZodDefault) {
            isOptional = true;
            defaultVal = inner._def.defaultValue();
            inner = inner._def.innerType;
          } else {
            break;
          }
        }

        if (inner instanceof z.ZodString) {
          typeStr = "STRING";
        } else if (inner instanceof z.ZodNumber) {
          typeStr = "NUMBER";
        } else if (inner instanceof z.ZodBoolean) {
          typeStr = "";
        } else if (inner instanceof z.ZodEnum) {
          typeStr = (inner._def.values as string[]).join("|");
        } else {
          typeStr = "VALUE";
        }

        const optStr = `${flagName} ${typeStr}`.trim();
        let fullDesc = desc;
        if (defaultVal !== undefined) {
          fullDesc += fullDesc ? ` (default: ${defaultVal})` : `(default: ${defaultVal})`;
        }
        console.log(`  ${optStr.padEnd(26)} ${fullDesc}`);
      }
      console.log("");
    }
  }

  console.log(`Safety Level: ${tool.safety || "read"}`);
}

export function printDomainHelp(domain: DomainSpec): void {
  console.log(`u2-agent ${domain.name} - ${domain.description}\n`);
  console.log(`Available Commands:`);
  for (const t of domain.tools) {
    const sub = t.name.split(".", 2)[1];
    console.log(`  ${sub.padEnd(16)} ${t.description}`);
  }
  console.log(`\nUse 'u2-agent ${domain.name} <command> --help' for command-specific options.`);
}

export function printHelp(): void {
  console.log(`u2-agent - Android UI Automator Control CLI (Bun rewrite)

Usage:
  u2-agent [--serial SERIAL] [--safety LEVEL] [--timeout SECONDS] [--quiet] <domain> <command> [options]

Domains & Commands:
${registry
  .listDomains()
  .map(
    (d) =>
      `  ${d.name.padEnd(12)} ${d.description}\n` +
      d.tools.map((t) => `    ${t.name.split(".", 2)[1].padEnd(14)} ${t.description}`).join("\n")
  )
  .join("\n\n")}

Global Options:
  --serial SERIAL       Target device ADB serial
  --safety LEVEL        Safety ceiling: read | interactive | destructive (default: destructive)
  --timeout SECONDS     Global timeout (default: 30)
  --quiet               Suppress diagnostic stderr output
  --strict-selector     Fail on ambiguous selector matches
  --json                Emit standard machine-readable JSON envelope
  --help, -h            Show help message
  --version, -v         Show version
`);
}

import { DaemonClient } from "./daemon/client";

export async function runStreamSession(config: Config, args: Record<string, unknown>): Promise<number> {
  const daemon = new DaemonClient(config.serial);
  let port: number;
  try {
    port = await daemon.ensureDaemon();
  } catch (err: any) {
    console.error(`Error: Failed to connect to or start u2-agent daemon: ${err.message || String(err)}`);
    return 1;
  }

  const format = args.format === "json" || config.json ? "json" : "text";
  const sessionId = String(args.session_id || `cli_sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const sseUrl = `http://127.0.0.1:${port}/session/stream?session_id=${sessionId}&format=${format}`;

  const abortController = new AbortController();

  let response: Response;
  try {
    response = await fetch(sseUrl, { signal: abortController.signal });
  } catch (err: any) {
    console.error(`Failed to connect to stream: ${err.message}`);
    return 1;
  }

  if (!response.ok || !response.body) {
    console.error(`Stream error: HTTP ${response.status}`);
    return 1;
  }

  (async () => {
    try {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const block of parts) {
          const lines = block.split("\n");
          let eventType = "message";
          const dataLines: string[] = [];

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataLines.push(line.slice(6));
            }
          }

          if (eventType === "ping") continue;

          if (dataLines.length > 0) {
            console.log(dataLines.join("\n"));
          }
        }
      }
    } catch {}
  })();

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "exit" || trimmed === "quit") {
      break;
    }

    if (trimmed === "snapshot") {
      try {
        const res = await daemon.request("/snapshot", {
          fingerprint: true,
          include_handles: true,
        });
        if (format === "json") {
          console.log(JSON.stringify(res));
        } else if (res.snapshot) {
          console.log(res.snapshot);
        }
      } catch (err: any) {
        console.error(`[error] ${err.message || String(err)}`);
      }
      continue;
    }

    const tokens = trimmed.split(/\s+/);
    let cmd = tokens[0];
    const cmdArgs = tokens.slice(1);

    if (cmd.startsWith("ui.")) cmd = cmd.slice(3);
    const parsedLine = parseArgs([cmd, ...cmdArgs]);

    try {
      const res = await daemon.request("/action", {
        command: parsedLine.domain || cmd,
        args: parsedLine.toolArgs,
      });

      if (format === "json") {
        console.log(JSON.stringify(res));
      } else {
        if (!res.ok) {
          console.error(`[error] ${res.error || "Action failed"}`);
        } else {
          console.log("ok");
        }
      }
    } catch (err: any) {
      console.error(`[error] ${err.message || String(err)}`);
    }
  }

  abortController.abort();
  await fetch(`http://127.0.0.1:${port}/session/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  }).catch(() => {});

  return 0;
}

export async function runCli(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const config = resolveConfig(parsed.configFlags);

  if (parsed.showVersion) {
    console.log("u2-agent 0.2.0 (Bun)");
    return 0;
  }

  if (parsed.showHelp || (!parsed.domain && !parsed.subcommand)) {
    if (parsed.domain && parsed.subcommand) {
      const toolName = `${parsed.domain}.${parsed.subcommand.replace(/-/g, "_")}`;
      const tool = registry.getTool(toolName);
      if (tool) {
        printToolHelp(tool);
        return 0;
      }
    } else if (parsed.domain) {
      const domain = registry.getDomain(parsed.domain);
      if (domain) {
        printDomainHelp(domain);
        return 0;
      }
    }
    printHelp();
    return 0;
  }

  if (parsed.domain === "stream" || (parsed.domain === "daemon" && parsed.subcommand === "stream")) {
    return await runStreamSession(config, parsed.toolArgs);
  }

  const domainName = parsed.domain;
  const subName = parsed.subcommand;
  const toolName = `${domainName}.${subName?.replace(/-/g, "_")}`;

  const tool = registry.getTool(toolName);
  if (!tool) {
    const err = new UsageError(`Unknown command '${domainName} ${subName || ""}'. Use --help for available commands.`);
    const envelope = formatErrorEnvelope(toolName, err, config.serial);
    renderOutput(envelope, config.quiet, config.json);
    return err.exitCode;
  }

  // Enforce safety ceiling (G7)
  const safetyOrder: Record<string, number> = { read: 0, interactive: 1, destructive: 2 };
  if (safetyOrder[tool.safety || "read"] > safetyOrder[config.safety]) {
    const err = new UsageError(
      `Tool '${tool.name}' requires safety level '${tool.safety}', but ceiling is locked to '${config.safety}'`
    );
    const envelope = formatErrorEnvelope(tool.name, err, config.serial);
    renderOutput(envelope, config.quiet, config.json);
    return err.exitCode;
  }

  const warnings: string[] = [];
  const ctx: HandlerContext = {
    serial: config.serial,
    timeout: config.timeout,
    debug: config.debug,
    warnings,
    warn: (msg: string) => warnings.push(msg),
    callTool: async <T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> => {
      const subTool = registry.getTool(name);
      if (!subTool) throw new InternalError(`Delegated tool '${name}' not found`);
      const validatedInput = subTool.inputSchema.parse(args);
      const res = await subTool.handler(ctx, validatedInput);
      return subTool.outputSchema.parse(res) as T;
    },
  };

  try {
    const validatedArgs = tool.inputSchema.parse(parsed.toolArgs);
    const result = await tool.handler(ctx, validatedArgs);
    const validatedResult = tool.outputSchema.parse(result) as Record<string, unknown>;

    await registry.verifyPostcondition(ctx, tool, validatedResult);

    const envelope = formatSuccessEnvelope(tool.name, ctx.serial, validatedResult, warnings);
    renderOutput(envelope, config.quiet, config.json);
    return 0;
  } catch (error: any) {
    let uError: U2Error;
    if (error instanceof U2Error) {
      uError = error;
    } else if (error?.name === "ZodError" || error instanceof z.ZodError) {
      const firstIssue = error.issues?.[0];
      const path = firstIssue?.path?.join(".") || "arguments";
      const fieldDesc = path ? `--${path.replace(/_/g, "-")}` : "arguments";
      const msg = firstIssue ? `Invalid value for ${fieldDesc}: ${firstIssue.message}` : error.message;
      uError = new UsageError(msg);
    } else {
      uError = new InternalError(error.message || String(error));
    }

    const envelope = formatErrorEnvelope(tool.name, uError, ctx.serial, warnings);
    renderOutput(envelope, config.quiet, config.json);
    return uError.exitCode;
  }
}
