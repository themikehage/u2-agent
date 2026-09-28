import { z } from "zod";
import { UsageError, InternalError, PostconditionFailedError } from "./errors";
import type { DeviceSession } from "./runtime/device";

export interface HandlerContext {
  deviceSession?: DeviceSession;
  serial?: string;
  timeout: number;
  debug: boolean;
  warnings: string[];
  callTool: <T = Record<string, unknown>>(toolName: string, args: Record<string, unknown>) => Promise<T>;
  warn: (message: string) => void;
}

export type SafetyClass = "read" | "interactive" | "destructive";

export interface ToolSpec<TInput = any, TOutput = any> {
  name: string;
  domain: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  handler: (ctx: HandlerContext, args: TInput) => Promise<TOutput>;
  safety?: SafetyClass;
  idempotent?: boolean;
  requires?: string[];
  expect?: Record<string, unknown>;
  // For CLI flag metadata export
  argDefinitions?: Record<string, { type: "string" | "number" | "boolean" | "array"; required?: boolean; description?: string; enum?: string[] }>;
}

export interface DomainSpec {
  name: string;
  description: string;
  tools: ToolSpec<any, any>[];
}

export class Registry {
  private domains: Map<string, DomainSpec> = new Map();
  private tools: Map<string, ToolSpec> = new Map();

  public registerDomain(domain: DomainSpec): void {
    if (domain.name === "macro") {
      throw new UsageError("Domain name 'macro' is reserved and cannot be registered in MVP");
    }

    for (const tool of domain.tools) {
      this.validateToolSpec(domain, tool);
      this.tools.set(tool.name, tool);
    }
    this.domains.set(domain.name, domain);
  }

  private validateToolSpec(domain: DomainSpec, tool: ToolSpec): void {
    if (tool.name.startsWith("macro.")) {
      throw new UsageError(`Tool '${tool.name}' is reserved for future macro domain`);
    }

    const expectedPrefix = `${domain.name}.`;
    if (!tool.name.startsWith(expectedPrefix)) {
      throw new UsageError(`Tool name '${tool.name}' must start with domain prefix '${expectedPrefix}'`);
    }

    if (this.tools.has(tool.name)) {
      throw new UsageError(`Duplicate tool registration: '${tool.name}'`);
    }

    const safety = tool.safety ?? "read";
    if (!["read", "interactive", "destructive"].includes(safety)) {
      throw new UsageError(`Invalid safety class '${safety}' for tool '${tool.name}'`);
    }

    if ((safety === "interactive" || safety === "destructive") && !tool.expect) {
      throw new UsageError(`Mutation tool '${tool.name}' (${safety}) must declare an 'expect' postcondition contract`);
    }

    if (typeof tool.handler !== "function") {
      throw new UsageError(`Handler for tool '${tool.name}' is not callable`);
    }
  }

  public getTool(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  public getDomain(name: string): DomainSpec | undefined {
    return this.domains.get(name);
  }

  public hasDomain(name: string): boolean {
    return this.domains.has(name);
  }

  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  public listDomains(): DomainSpec[] {
    return Array.from(this.domains.values());
  }

  public listTools(): ToolSpec[] {
    return Array.from(this.tools.values());
  }

  public async verifyPostcondition(ctx: HandlerContext, tool: ToolSpec, result: Record<string, unknown>): Promise<void> {
    if (!tool.expect) return;

    if (tool.expect.schema instanceof z.ZodType) {
      const parsed = tool.expect.schema.safeParse(result);
      if (!parsed.success) {
        throw new PostconditionFailedError(
          `Postcondition failed: result does not satisfy expected schema (${parsed.error.issues.map((i) => i.message).join(", ")})`
        );
      }
    }

    if (tool.expect.element) {
      const postcondRes = (result.postcondition as Record<string, unknown> | undefined);
      if (tool.expect.state === "exists" && postcondRes && !postcondRes.satisfied) {
        throw new PostconditionFailedError(`Postcondition failed: expected element matching ${JSON.stringify(tool.expect.element)} to exist`);
      }
    }
  }
}

export const registry = new Registry();
