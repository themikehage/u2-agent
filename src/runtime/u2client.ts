import { TimeoutError, TransientError } from "../errors";

export interface DeviceInfoRPC {
  currentPackageName?: string;
  displayHeight?: number;
  displayWidth?: number;
  displayRotation?: number;
  displaySizeDpX?: number;
  displaySizeDpY?: number;
  productName?: string;
  screenOn?: boolean;
  sdkInt?: number;
  naturalOrientation?: boolean;
}

export class U2Client {
  private baseUrl: string;
  private rpcId = 0;
  private timeoutMs: number;

  constructor(localPort: number = 9008, timeoutSeconds: number = 30) {
    this.baseUrl = `http://127.0.0.1:${localPort}/jsonrpc/0`;
    this.timeoutMs = timeoutSeconds * 1000;
  }

  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    const payload = {
      jsonrpc: "2.0",
      id: ++this.rpcId,
      method,
      params,
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        throw new TransientError(`JSON-RPC server returned HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as {
        result?: T;
        error?: { code?: number; message?: string };
      };

      if (data.error) {
        throw new TransientError(`JSON-RPC Error [${data.error.code || 0}]: ${data.error.message || "Unknown error"}`);
      }

      return data.result as T;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new TimeoutError(`JSON-RPC call '${method}' timed out after ${this.timeoutMs}ms`);
      }
      if (err instanceof TransientError || err instanceof TimeoutError) {
        throw err;
      }
      throw new TransientError(`Failed to connect to uiautomator2 JSON-RPC daemon: ${err.message || String(err)}`);
    }
  }

  async ping(): Promise<string> {
    return this.call<string>("ping");
  }

  async deviceInfo(): Promise<DeviceInfoRPC> {
    return this.call<DeviceInfoRPC>("deviceInfo");
  }

  async dumpHierarchy(compressed: boolean = false, maxDepth: number = 50): Promise<string> {
    return this.call<string>("dumpWindowHierarchy", [compressed, maxDepth]);
  }

  async click(x: number, y: number): Promise<boolean> {
    return this.call<boolean>("click", [Math.round(x), Math.round(y)]);
  }

  async longClick(x: number, y: number, duration: number = 1.0): Promise<boolean> {
    return this.call<boolean>("longClick", [Math.round(x), Math.round(y), duration]);
  }

  async swipe(x1: number, y1: number, x2: number, y2: number, steps: number = 20): Promise<boolean> {
    return this.call<boolean>("swipe", [
      Math.round(x1),
      Math.round(y1),
      Math.round(x2),
      Math.round(y2),
      steps,
    ]);
  }

  async pressKey(key: string): Promise<boolean> {
    return this.call<boolean>("pressKey", [key]);
  }

  async setInputText(text: string): Promise<boolean> {
    // The daemon's `setText` RPC takes (selector, text), not (text). Clipboard+paste
    // is the reliable path and mirrors uiautomator2's `send_keys`.
    await this.call("setClipboard", [null, text]);
    await this.call("pasteClipboard", []);
    return true;
  }

  async clearInputText(): Promise<boolean> {
    // `clearTextField` requires a selector; the no-arg device-level clear is `clearInputText`.
    return this.call<boolean>("clearInputText", []);
  }

  async openNotification(): Promise<boolean> {
    return this.call<boolean>("openNotification", []);
  }

  async openQuickSettings(): Promise<boolean> {
    return this.call<boolean>("openQuickSettings", []);
  }

  async getClipboard(): Promise<string> {
    return this.call<string>("getClipboard", []);
  }

  async setClipboardText(text: string): Promise<boolean> {
    return this.call<boolean>("setClipboard", [null, text]);
  }

  async drag(startX: number, startY: number, endX: number, endY: number, steps: number = 40): Promise<boolean> {
    return this.call<boolean>("drag", [
      Math.round(startX),
      Math.round(startY),
      Math.round(endX),
      Math.round(endY),
      steps,
    ]);
  }

  async pinchIn(bounds: { x1: number; y1: number; x2: number; y2: number }, percent: number = 50, steps: number = 30): Promise<boolean> {
    return this.call<boolean>("pinchIn", [
      Math.round(bounds.x1),
      Math.round(bounds.y1),
      Math.round(bounds.x2),
      Math.round(bounds.y2),
      steps,
      percent,
    ]);
  }

  async pinchOut(bounds: { x1: number; y1: number; x2: number; y2: number }, percent: number = 50, steps: number = 30): Promise<boolean> {
    return this.call<boolean>("pinchOut", [
      Math.round(bounds.x1),
      Math.round(bounds.y1),
      Math.round(bounds.x2),
      Math.round(bounds.y2),
      steps,
      percent,
    ]);
  }
}

