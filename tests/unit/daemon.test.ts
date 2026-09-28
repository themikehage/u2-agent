import { describe, expect, test } from "bun:test";
import { formatCompactSnapshot, parseXmlDump } from "../../src/domains/ui";
import { parseSelectorArgs } from "../../src/selectors/parser";
import { resolveSelector } from "../../src/selectors/resolver";
import { renderOutput, formatSuccessEnvelope } from "../../src/output";

describe("u2-agent Agent-Browser Parity & Minimal Output", () => {
  const sampleXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.settings" bounds="[0,0][1080,2400]">
    <node index="0" text="Network &amp; internet" resource-id="com.android.settings:id/title" class="android.widget.TextView" package="com.android.settings" bounds="[100,200][500,250]" clickable="true" />
    <node index="1" text="Connected devices" resource-id="com.android.settings:id/title" class="android.widget.TextView" package="com.android.settings" bounds="[100,300][500,350]" clickable="true" />
    <node index="2" text="Search settings" resource-id="com.android.settings:id/search" class="android.widget.EditText" package="com.android.settings" bounds="[50,50][1000,150]" focusable="true" />
  </node>
</hierarchy>`;

  const overlappingXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.facebook.katana" bounds="[0,0][1080,2400]">
    <node index="1" text="" resource-id="" class="android.widget.Button" package="com.facebook.katana" bounds="[897,430][1044,482]" clickable="true" />
    <node index="2" text="Ver todo" resource-id="" class="android.view.View" package="com.facebook.katana" bounds="[897,430][1044,482]" />
  </node>
</hierarchy>`;

  test("parseXmlDump assigns handles @1, @2, @3 automatically", () => {
    const elements = parseXmlDump(sampleXml);
    expect(elements.length).toBe(3);
    expect(elements[0].ref).toBe("@1");
    expect(elements[1].ref).toBe("@2");
    expect(elements[2].ref).toBe("@3");
  });

  test("formatCompactSnapshot produces ultra-compact LLM text format with semantic roles", () => {
    const elements = parseXmlDump(sampleXml);
    const textSnapshot = formatCompactSnapshot(elements, "com.android.settings", "a1b2c3d4");

    expect(textSnapshot).toContain("[App: com.android.settings | fingerprint: a1b2c3d4]");
    expect(textSnapshot).toContain('[@1] Button "Network & internet"');
    expect(textSnapshot).toContain('[@2] Button "Connected devices"');
    expect(textSnapshot).toContain('[@3] Input "Search settings"');
  });

  test("deduplicates ghost wrappers with overlapping bounds", () => {
    const elements = parseXmlDump(overlappingXml);
    expect(elements.length).toBe(1);
    expect(elements[0].ref).toBe("@1");
    expect(elements[0].text).toBe("Ver todo");
    expect(elements[0].clickable).toBe(true);
  });

  test("parseSelectorArgs parses --ref @1 into query", () => {
    const q1 = parseSelectorArgs({ ref: "@1" });
    expect(q1.ref).toBe("@1");

    const q2 = parseSelectorArgs({ ref: "2" });
    expect(q2.ref).toBe("@2");
  });

  test("resolveSelector matches elements by handle @1", () => {
    const elements = parseXmlDump(sampleXml);
    const query = parseSelectorArgs({ ref: "@2" });
    const match = resolveSelector(elements, query);

    expect(match.element.text).toBe("Connected devices");
    expect(match.centerX).toBe(300);
    expect(match.centerY).toBe(325);
  });

  test("renderOutput renders plain text for snapshot and ok for actions", () => {
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output += msg + "\n";
    };

    try {
      // 1. Action tap -> ok
      output = "";
      renderOutput(formatSuccessEnvelope("ui.tap", "da0f5e72", { tapped: true }), false);
      expect(output.trim()).toBe("ok");

      // 2. Action input -> ok
      output = "";
      renderOutput(formatSuccessEnvelope("ui.input", "da0f5e72", { success: true }), false);
      expect(output.trim()).toBe("ok");

      // 3. Action press -> ok
      output = "";
      renderOutput(formatSuccessEnvelope("ui.press", "da0f5e72", { pressed: true }), false);
      expect(output.trim()).toBe("ok");

      // 4. Snapshot -> plain snapshot string
      output = "";
      renderOutput(formatSuccessEnvelope("ui.snapshot", "da0f5e72", { snapshot: '[App: test]\n[@1] Button "OK"' }), false);
      expect(output.trim()).toBe('[App: test]\n[@1] Button "OK"');
    } finally {
      console.log = originalLog;
    }
  });

  test("preserves distinct child buttons and views inside large feed containers", () => {
    const feedXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.facebook.katana" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="com.facebook.katana:id/feed_card" class="android.view.ViewGroup" package="com.facebook.katana" bounds="[0,200][1080,1800]" clickable="true">
      <node index="0" text="Post title from user" resource-id="" class="android.widget.TextView" package="com.facebook.katana" bounds="[50,220][800,300]" />
      <node index="1" text="Like" resource-id="com.facebook.katana:id/like_btn" class="android.widget.Button" package="com.facebook.katana" bounds="[50,1700][200,1780]" clickable="true" />
      <node index="2" text="Comment" resource-id="com.facebook.katana:id/comment_btn" class="android.widget.Button" package="com.facebook.katana" bounds="[300,1700][500,1780]" clickable="true" />
      <node index="3" text="Share" resource-id="com.facebook.katana:id/share_btn" class="android.widget.Button" package="com.facebook.katana" bounds="[600,1700][800,1780]" clickable="true" />
    </node>
  </node>
</hierarchy>`;

    const elements = parseXmlDump(feedXml);
    // Should preserve all 4 child text/button elements without collapsing them
    expect(elements.length).toBe(4);
    const texts = elements.map((e) => e.text);
    expect(texts).toContain("Post title from user");
    expect(texts).toContain("Like");
    expect(texts).toContain("Comment");
    expect(texts).toContain("Share");
  });

  test("getDaemonConfigPath safely handles undefined and wifi serials", async () => {
    const { getDaemonConfigPath } = await import("../../src/daemon/server");
    expect(getDaemonConfigPath("192.168.1.19:5555")).toContain("192_168_1_19_5555");
    expect(getDaemonConfigPath(undefined)).toContain("default");
    expect(getDaemonConfigPath("")).toContain("default");
  });
});
