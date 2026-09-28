import { describe, it, expect, afterEach } from "bun:test";
import { DaemonServer } from "../../src/daemon/server";
import type { ActionElement } from "../../src/models";

describe("SSE Session Protocol & Streaming Diff", () => {
  let server: DaemonServer | null = null;

  afterEach(() => {
    if (server) {
      server.stop();
      server = null;
    }
  });

  it("POST /session/open generates a session_id", async () => {
    server = new DaemonServer("test-device", 0);
    const info = await server.start();

    const res = await fetch(`http://127.0.0.1:${info.port}/session/open`, { method: "POST" });
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.ok).toBe(true);
    expect(data.session_id).toMatch(/^sess_/);
  });

  it("GET /session/stream connects and receives initial snapshot in text format", async () => {
    server = new DaemonServer("test-device", 0);
    const info = await server.start();

    const response = await fetch(`http://127.0.0.1:${info.port}/session/stream?session_id=test_sess_1`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    const { value } = await reader!.read();
    const text = decoder.decode(value);

    expect(text).toContain("event: connected");
    expect(text).toContain("data: [App:");

    await reader!.cancel();
  });

  it("GET /session/stream with format=json receives structured snapshot event", async () => {
    server = new DaemonServer("test-device", 0);
    const info = await server.start();

    const response = await fetch(`http://127.0.0.1:${info.port}/session/stream?session_id=test_json_sess&format=json`);
    expect(response.status).toBe(200);

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    const { value } = await reader!.read();
    const text = decoder.decode(value);

    expect(text).toContain("event: connected");
    expect(text).toContain('"type":"snapshot"');
    expect(text).toContain('"session_id":"test_json_sess"');

    await reader!.cancel();
  });

  it("broadcastDiff pushes delta updates to active SSE stream", async () => {
    server = new DaemonServer("test-device", 0);
    const info = await server.start();

    const baseEl: ActionElement = {
      index: 0,
      ref: "@1",
      text: "Me gusta",
      resourceId: "",
      contentDesc: "",
      className: "android.widget.Button",
      bounds: "[100,200][300,300]",
      clickable: true,
      scrollable: false,
      focused: false,
      visible_to_selector_engine: true,
    };

    // Pre-populate base elements
    (server as any).elements = [baseEl];
    (server as any).fingerprint = "base_fp_123";

    const response = await fetch(`http://127.0.0.1:${info.port}/session/stream?session_id=test_diff_sess`);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    // Read initial connected event
    await reader!.read();

    const nextEl: ActionElement = {
      ...baseEl,
      text: "Te gusta",
    };

    // Broadcast diff to connected client
    server.broadcastDiff([nextEl], "new_fp_999", "com.example.app");

    const { value } = await reader!.read();
    const diffText = decoder.decode(value);

    expect(diffText).toContain("event: diff");
    expect(diffText).toContain('~ [@1] Button "Me gusta" -> "Te gusta"');

    await reader!.cancel();
  });

  it("POST /session/close terminates registered session", async () => {
    server = new DaemonServer("test-device", 0);
    const info = await server.start();

    const openRes = await fetch(`http://127.0.0.1:${info.port}/session/open`, { method: "POST" });
    const { session_id } = (await openRes.json()) as any;

    const closeRes = await fetch(`http://127.0.0.1:${info.port}/session/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id }),
    });
    expect(closeRes.status).toBe(200);
    const closeData = (await closeRes.json()) as any;
    expect(closeData.ok).toBe(true);
  });
});
