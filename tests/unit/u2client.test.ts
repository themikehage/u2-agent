import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { U2Client } from "../../src/runtime/u2client";

describe("U2Client text input RPC protocol", () => {
  let fetchSpy: ReturnType<typeof spyOn>;
  const calls: { method: string; params: unknown[] }[] = [];

  beforeEach(() => {
    calls.length = 0;
    fetchSpy = spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  function stubRpcResult() {
    fetchSpy.mockImplementation(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ method: body.method, params: body.params });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
  }

  test("setInputText sends setClipboard then pasteClipboard (not setText)", async () => {
    stubRpcResult();
    const client = new U2Client();
    await client.setInputText("therry miranda");

    expect(calls.map((c) => c.method)).toEqual(["setClipboard", "pasteClipboard"]);
    expect(calls[0].params).toEqual([null, "therry miranda"]);
    expect(calls[1].params).toEqual([]);
  });

  test("clearInputText sends clearInputText (not clearTextField)", async () => {
    stubRpcResult();
    const client = new U2Client();
    await client.clearInputText();

    expect(calls.map((c) => c.method)).toEqual(["clearInputText"]);
    expect(calls[0].params).toEqual([]);
  });
});
