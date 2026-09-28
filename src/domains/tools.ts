import { z } from "zod";
import type { DomainSpec } from "../registry";
import { registry } from "../registry";

function extractZodParameters(schema: z.ZodTypeAny): {
  parameters: Record<string, { type: string; description?: string; optional: boolean; default?: unknown }>;
  required: string[];
} {
  const parameters: Record<string, { type: string; description?: string; optional: boolean; default?: unknown }> = {};
  const required: string[] = [];

  if (schema instanceof z.ZodObject) {
    for (const [key, field] of Object.entries(schema.shape)) {
      let fieldSchema: any = field;
      let isOpt = false;
      let defaultVal: unknown = undefined;

      if (fieldSchema instanceof z.ZodDefault) {
        defaultVal = fieldSchema._def.defaultValue();
        fieldSchema = fieldSchema._def.innerType;
        isOpt = true;
      }
      if (fieldSchema instanceof z.ZodOptional) {
        fieldSchema = fieldSchema._def.innerType;
        isOpt = true;
      }

      let typeName = "string";
      if (fieldSchema instanceof z.ZodNumber) typeName = "number";
      else if (fieldSchema instanceof z.ZodBoolean) typeName = "boolean";
      else if (fieldSchema instanceof z.ZodArray) typeName = "array";
      else if (fieldSchema instanceof z.ZodEnum) typeName = `enum(${fieldSchema._def.values.join("|")})`;
      else if (fieldSchema instanceof z.ZodRecord) typeName = "object";

      const description = fieldSchema.description || (field as any).description;

      if (!isOpt) {
        required.push(key);
      }

      parameters[key] = {
        type: typeName,
        ...(description ? { description } : {}),
        optional: isOpt,
        ...(defaultVal !== undefined ? { default: defaultVal } : {}),
      };
    }
  }

  return { parameters, required };
}

export const TOOLS_DOMAIN: DomainSpec = {
  name: "tools",
  description: "Capability catalog introspection and schema export for external agents",
  tools: [
    {
      name: "tools.list",
      domain: "tools",
      description: "List all registered agent capabilities and their safety classes",
      inputSchema: z.object({}),
      outputSchema: z.object({
        tools: z.array(
          z.object({
            name: z.string(),
            domain: z.string(),
            description: z.string(),
            safety: z.string(),
            idempotent: z.boolean(),
          })
        ),
      }),
      safety: "read",
      handler: async () => {
        const tools = registry.listTools().map((t) => ({
          name: t.name,
          domain: t.domain,
          description: t.description,
          safety: t.safety || "read",
          idempotent: t.idempotent ?? true,
        }));
        return { tools };
      },
    },
    {
      name: "tools.show",
      domain: "tools",
      description: "Show detailed specification for a specific capability or domain",
      inputSchema: z.object({
        name: z.string().describe("Tool name (e.g. ui.tap) or domain name (e.g. ui)"),
      }),
      outputSchema: z.record(z.unknown()),
      safety: "read",
      handler: async (_, args) => {
        const target = args.name;
        const tool = registry.getTool(target);
        if (tool) {
          const { parameters, required } = extractZodParameters(tool.inputSchema);
          return {
            name: tool.name,
            domain: tool.domain,
            description: tool.description,
            safety: tool.safety || "read",
            idempotent: tool.idempotent ?? true,
            parameters,
            required,
            requires: tool.requires || [],
          };
        }

        const domain = registry.getDomain(target);
        if (domain) {
          return {
            domain: domain.name,
            description: domain.description,
            tools: domain.tools.map((t) => t.name),
          };
        }

        return { error: `Neither tool nor domain named '${target}' found` };
      },
    },
    {
      name: "tools.schema",
      domain: "tools",
      description: "Export full capabilities schema in machine-readable JSON format",
      inputSchema: z.object({
        format: z.enum(["openai", "raw"]).optional().default("raw"),
      }),
      outputSchema: z.record(z.unknown()),
      safety: "read",
      handler: async (_, args) => {
        const tools = registry.listTools();

        if (args.format === "openai") {
          const functions = tools.map((t) => {
            const { parameters, required } = extractZodParameters(t.inputSchema);
            const properties: Record<string, any> = {};
            for (const [k, v] of Object.entries(parameters)) {
              let pType = v.type;
              if (pType.startsWith("enum")) pType = "string";
              properties[k] = {
                type: pType,
                ...(v.description ? { description: v.description } : {}),
              };
            }

            return {
              name: t.name.replace(/\./g, "_"),
              description: t.description,
              parameters: {
                type: "object",
                properties,
                ...(required.length > 0 ? { required } : {}),
              },
            };
          });
          return { functions };
        }

        const rawSpecs = tools.map((t) => {
          const { parameters, required } = extractZodParameters(t.inputSchema);
          return {
            name: t.name,
            domain: t.domain,
            description: t.description,
            safety: t.safety || "read",
            idempotent: t.idempotent ?? true,
            parameters,
            required,
          };
        });
        return { capabilities: rawSpecs };
      },
    },
  ],
};
