import { describe, it, expect } from "bun:test";
import { registry } from "../../src/registry";
import { DOMAINS } from "../../src/domains";
import { parseNotificationDumpsys } from "../../src/domains/ui";
import { formatSuccessEnvelope, renderOutput } from "../../src/output";

// Ensure domains are registered
for (const domain of DOMAINS) {
  if (!registry.hasDomain(domain.name)) {
    registry.registerDomain(domain);
  }
}

describe("v5 Recommendations Feature Gap Validation", () => {
  it("app domain registers app.clear, app.open_url, and app.grant_permissions", () => {
    const clearTool = registry.getTool("app.clear");
    expect(clearTool).toBeDefined();
    expect(clearTool?.safety).toBe("destructive");
    expect(clearTool?.expect).toBeDefined();

    const openUrlTool = registry.getTool("app.open_url");
    expect(openUrlTool).toBeDefined();
    expect(openUrlTool?.safety).toBe("interactive");
    expect(openUrlTool?.expect).toBeDefined();

    const grantTool = registry.getTool("app.grant_permissions");
    expect(grantTool).toBeDefined();
    expect(grantTool?.safety).toBe("destructive");
    expect(grantTool?.expect).toBeDefined();
  });

  it("device domain registers device.clipboard tool", () => {
    const clipTool = registry.getTool("device.clipboard");
    expect(clipTool).toBeDefined();
    expect(clipTool?.safety).toBe("interactive");
    expect(clipTool?.expect).toBeDefined();
  });

  it("ui domain registers ui.notifications, ui.screenshot, ui.drag, and ui.pinch", () => {
    const notifsTool = registry.getTool("ui.notifications");
    expect(notifsTool).toBeDefined();
    expect(notifsTool?.safety).toBe("interactive");

    const screencapTool = registry.getTool("ui.screenshot");
    expect(screencapTool).toBeDefined();
    expect(screencapTool?.safety).toBe("read");

    const dragTool = registry.getTool("ui.drag");
    expect(dragTool).toBeDefined();
    expect(dragTool?.safety).toBe("interactive");
    expect(dragTool?.expect).toBeDefined();

    const pinchTool = registry.getTool("ui.pinch");
    expect(pinchTool).toBeDefined();
    expect(pinchTool?.safety).toBe("interactive");
    expect(pinchTool?.expect).toBeDefined();
  });

  it("parseNotificationDumpsys correctly parses notification dump and filters noise", () => {
    const rawDumpsys = `
      NotificationRecord(0x123: pkg=com.google.android.apps.messaging user=UserHandle{0} id=42: 
        android.title=String (Security Alert)
        android.text=String (Your OTP code is 492019)
      )
      NotificationRecord(0x456: pkg=com.android.systemui user=UserHandle{0} id=1: 
        android.title=String (USB debugging connected)
        android.text=String (Tap to disable USB debugging)
      )
      NotificationRecord(0x789: pkg=com.whatsapp user=UserHandle{0} id=99: 
        android.title=CharSequence (Alice)
        android.text=CharSequence (Hey! Let's meet at 5pm)
      )
    `;

    const parsed = parseNotificationDumpsys(rawDumpsys);
    expect(parsed.length).toBe(2);
    expect(parsed[0].package).toBe("com.google.android.apps.messaging");
    expect(parsed[0].title).toBe("Security Alert");
    expect(parsed[0].text).toBe("Your OTP code is 492019");

    expect(parsed[1].package).toBe("com.whatsapp");
    expect(parsed[1].title).toBe("Alice");
    expect(parsed[1].text).toBe("Hey! Let's meet at 5pm");
  });

  it("renderOutput formats action commands cleanly as ok", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      renderOutput(formatSuccessEnvelope("app.clear", "dev1", { package: "com.test", cleared: true }));
      expect(logs.pop()).toBe("ok");

      renderOutput(formatSuccessEnvelope("app.open_url", "dev1", { url: "https://x.com", opened: true }));
      expect(logs.pop()).toBe("ok");

      renderOutput(formatSuccessEnvelope("app.grant_permissions", "dev1", { package: "com.test", granted: ["POST_NOTIFICATIONS"] }));
      expect(logs.pop()).toBe("ok");

      renderOutput(formatSuccessEnvelope("ui.drag", "dev1", { dragged: true, from: { x: 10, y: 10 }, to: { x: 50, y: 50 } }));
      expect(logs.pop()).toBe("ok");

      renderOutput(formatSuccessEnvelope("ui.pinch", "dev1", { pinched: true, direction: "in", center: { x: 100, y: 100 } }));
      expect(logs.pop()).toBe("ok");

      renderOutput(formatSuccessEnvelope("device.clipboard", "dev1", { action: "set", success: true }));
      expect(logs.pop()).toBe("ok");
    } finally {
      console.log = origLog;
    }
  });

  it("renderOutput formats device.clipboard get and ui.screenshot paths", () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => logs.push(msg);

    try {
      renderOutput(formatSuccessEnvelope("device.clipboard", "dev1", { action: "get", text: "secret_token_123", success: true }));
      expect(logs.pop()).toBe("secret_token_123");

      renderOutput(formatSuccessEnvelope("ui.screenshot", "dev1", { path: "/tmp/screen.png", size_bytes: 4096, success: true }));
      expect(logs.pop()).toBe("/tmp/screen.png");

      renderOutput(
        formatSuccessEnvelope("ui.notifications", "dev1", {
          action: "read",
          notifications: [{ package: "com.whatsapp", title: "Mom", text: "Call me" }],
          count: 1,
          success: true,
        })
      );
      expect(logs.pop()).toBe("[com.whatsapp] Mom: Call me");

      renderOutput(
        formatSuccessEnvelope("ui.notifications", "dev1", {
          action: "read",
          notifications: [],
          count: 0,
          success: true,
        })
      );
      expect(logs.pop()).toBe("none");
    } finally {
      console.log = origLog;
    }
  });
});
