import { describe, test, expect } from "bun:test";
import { registry } from "../../src/registry";
import { DOMAINS } from "../../src/domains";

describe("Registry & Capability Contract", () => {
  test("All domains and tools are registered", () => {
    for (const d of DOMAINS) {
      if (!registry.hasDomain(d.name)) {
        registry.registerDomain(d);
      }
    }

    const tools = registry.listTools();
    expect(tools.length).toBeGreaterThan(15);

    for (const t of tools) {
      expect(t.name).toContain(".");
      expect(["read", "interactive", "destructive"]).toContain(t.safety || "read");
    }
  });

  test("Mutation tools declare expect postcondition contract", () => {
    const tools = registry.listTools();
    const mutations = tools.filter((t) => t.safety === "interactive" || t.safety === "destructive");

    for (const m of mutations) {
      expect(m.expect).toBeDefined();
    }
  });
});
