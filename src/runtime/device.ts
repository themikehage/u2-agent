import { selectTargetDevice, forwardPort, inputTextViaAdbKeyboard } from "./adb";
import { U2Client } from "./u2client";
import { DeviceOfflineError, U2Error } from "../errors";
import { ensureU2Runtime } from "./runtime";

export class DeviceSession {
  public serial: string = "";
  public timeout: number;
  public adbPath?: string;
  public localPort: number;

  public client?: U2Client;

  constructor(serial?: string, timeout: number = 30, adbPath?: string, localPort: number = 9008) {
    if (serial) this.serial = serial;
    this.timeout = timeout;
    this.adbPath = adbPath;
    this.localPort = localPort;
  }

  async connect(): Promise<U2Client> {
    const { target } = await selectTargetDevice(this.serial, this.adbPath);
    this.serial = target.serial;

    try {
      await forwardPort(this.serial, this.localPort, 9008, this.adbPath);
      await ensureU2Runtime(this.serial, this.localPort, this.adbPath);
      const client = new U2Client(this.localPort, this.timeout);
      await client.ping();
      this.client = client;
      return client;
    } catch (err: any) {
      if (err instanceof U2Error) {
        throw err;
      }
      throw new DeviceOfflineError(this.serial, err.message || String(err));
    }
  }

  async getClient(): Promise<U2Client> {
    if (!this.client) {
      return this.connect();
    }
    return this.client;
  }

  async setInputText(text: string): Promise<string> {
    // Non-ASCII text is corrupted by the clipboard+paste RPC path; the
    // AdbKeyboard IME broadcast preserves UTF-8 correctly.
    if (/[^\x00-\x7F]/.test(text)) {
      const ok = await inputTextViaAdbKeyboard(this.serial, text, this.adbPath);
      if (ok) return "adb_keyboard";
    }
    const client = await this.getClient();
    await client.setInputText(text);
    return "clipboard";
  }
}
