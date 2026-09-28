import { existsSync } from "node:fs";
import {
  ADBUnavailableError,
  DeviceNoneError,
  DeviceAmbiguousError,
  DeviceNotFoundError,
  DeviceOfflineError,
  DeviceUnauthorizedError,
} from "../errors";
import type { DeviceInfo } from "../models";

export function getAdbPath(customAdbPath?: string): string {
  if (customAdbPath && existsSync(customAdbPath)) {
    return customAdbPath;
  }

  // Check PATH or standard Windows locations
  const whichResult = Bun.which("adb");
  if (whichResult) return whichResult;

  const envPath = process.env.ADB_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  throw new ADBUnavailableError("`adb` command not found on system PATH. Install platform-tools or set ADB_PATH");
}

export async function execAdb(
  args: string[],
  customAdbPath?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const adbPath = getAdbPath(customAdbPath);
  const proc = Bun.spawn([adbPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

export async function listAdbDevices(customAdbPath?: string): Promise<DeviceInfo[]> {
  const { stdout, exitCode } = await execAdb(["devices", "-l"], customAdbPath);
  if (exitCode !== 0) {
    throw new ADBUnavailableError("Failed to execute `adb devices -l`");
  }

  const devices: DeviceInfo[] = [];
  const lines = stdout.trim().split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;

    const serial = parts[0];
    const state = parts[1];
    let model = "";
    const transport = serial.includes(":") ? "wifi" : "usb";

    for (let j = 2; j < parts.length; j++) {
      if (parts[j].startsWith("model:")) {
        model = parts[j].split(":", 2)[1];
      }
    }

    devices.push({ serial, state, model, transport });
  }

  return devices;
}

export async function selectTargetDevice(
  requestedSerial?: string,
  customAdbPath?: string
): Promise<{ target: DeviceInfo; devices: DeviceInfo[] }> {
  const devices = await listAdbDevices(customAdbPath);

  if (devices.length === 0) {
    throw new DeviceNoneError("No ADB devices connected");
  }

  let target: DeviceInfo;
  if (requestedSerial) {
    const matched = devices.filter((d) => d.serial === requestedSerial);
    if (matched.length === 0) {
      throw new DeviceNotFoundError(requestedSerial);
    }
    target = matched[0];
  } else {
    if (devices.length === 1) {
      target = devices[0];
    } else {
      const serials = devices.map((d) => d.serial).join(", ");
      throw new DeviceAmbiguousError(serials);
    }
  }

  // Mark selected
  for (const d of devices) {
    if (d.serial === target.serial) {
      d.selected = true;
    }
  }

  // Validate state
  if (target.state === "unauthorized") {
    throw new DeviceUnauthorizedError(target.serial);
  } else if (target.state === "offline") {
    throw new DeviceOfflineError(target.serial);
  } else if (target.state !== "device") {
    throw new DeviceOfflineError(target.serial);
  }

  return { target, devices };
}

export async function reconnectDevice(
  serial: string,
  hard: boolean = false,
  customAdbPath?: string
): Promise<string> {
  if (hard) {
    await execAdb(["kill-server"], customAdbPath);
    await execAdb(["start-server"], customAdbPath);
    return "Hard reconnect performed: adb server restarted";
  } else {
    const { stdout } = await execAdb(["reconnect", serial], customAdbPath);
    return stdout.trim() || `Soft reconnect sent to ${serial}`;
  }
}

export async function forwardPort(
  serial: string,
  localPort: number,
  remotePort: number,
  customAdbPath?: string
): Promise<void> {
  const { exitCode, stderr } = await execAdb(
    ["-s", serial, "forward", `tcp:${localPort}`, `tcp:${remotePort}`],
    customAdbPath
  );
  if (exitCode !== 0) {
    throw new ADBUnavailableError(`Failed to forward port tcp:${localPort} to tcp:${remotePort}: ${stderr}`);
  }
}

export async function inputTextViaAdbKeyboard(
  serial: string,
  text: string,
  customAdbPath?: string
): Promise<boolean> {
  const b64 = Buffer.from(text, "utf8").toString("base64");
  const { stdout } = await execAdb(
    ["-s", serial, "shell", "am", "broadcast", "-a", "ADB_KEYBOARD_INPUT_TEXT", "--es", "text", b64],
    customAdbPath
  );
  // The uiautomator2 AdbKeyboard receiver sets result=-1 on success; without a
  // registered receiver the broadcast completes with result=0 (no dispatch).
  const ok = stdout.includes("result=-1");
  if (ok) {
    await execAdb(
      ["-s", serial, "shell", "am", "broadcast", "-a", "ADB_KEYBOARD_HIDE"],
      customAdbPath
    );
  }
  return ok;
}
