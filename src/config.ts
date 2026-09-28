import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Config {
  serial?: string;
  timeout: number;
  quiet: boolean;
  debug: boolean;
  json: boolean;
  strictSelector: boolean;
  safety: "read" | "interactive" | "destructive";
  adbPath?: string;
}

export const DEFAULT_CONFIG: Config = {
  timeout: 30,
  quiet: false,
  debug: false,
  json: false,
  strictSelector: false,
  safety: "interactive",
};

export function loadConfigFile(): Partial<Config> {
  const localConfig = join(process.cwd(), ".u2ctl.json");
  const homeConfig = join(homedir(), ".config", "u2ctl", "config.json");

  let targetPath: string | null = null;
  if (process.env.U2CTL_CONFIG && existsSync(process.env.U2CTL_CONFIG)) {
    targetPath = process.env.U2CTL_CONFIG;
  } else if (existsSync(localConfig)) {
    targetPath = localConfig;
  } else if (existsSync(homeConfig)) {
    targetPath = homeConfig;
  }

  if (!targetPath) return {};

  try {
    const raw = readFileSync(targetPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      serial: parsed.serial || parsed.U2CTL_SERIAL,
      timeout: parsed.timeout ? Number(parsed.timeout) : undefined,
      quiet: parsed.quiet === true,
      debug: parsed.debug === true,
      strictSelector: parsed.strictSelector === true,
      safety: parsed.safety,
      adbPath: parsed.adbPath || parsed.ADB_PATH,
    };
  } catch {
    return {};
  }
}

export function resolveConfig(cliFlags: Partial<Config>): Config {
  const fileConfig = loadConfigFile();

  const envSerial = process.env.U2CTL_SERIAL || process.env.ANDROID_SERIAL;
  const envTimeout = process.env.U2CTL_TIMEOUT ? Number(process.env.U2CTL_TIMEOUT) : undefined;
  const envStrict = process.env.U2CTL_STRICT_SELECTOR === "1" || process.env.U2CTL_STRICT_SELECTOR === "true";
  const envSafety = process.env.U2CTL_SAFETY as Config["safety"] | undefined;
  const envAdb = process.env.ADB_PATH;

  return {
    serial: cliFlags.serial ?? envSerial ?? fileConfig.serial,
    timeout: cliFlags.timeout ?? envTimeout ?? fileConfig.timeout ?? DEFAULT_CONFIG.timeout,
    quiet: cliFlags.quiet ?? (fileConfig.quiet || DEFAULT_CONFIG.quiet),
    debug: cliFlags.debug ?? (fileConfig.debug || DEFAULT_CONFIG.debug),
    json: cliFlags.json ?? (fileConfig.json || DEFAULT_CONFIG.json),
    strictSelector: cliFlags.strictSelector ?? (envStrict || fileConfig.strictSelector || DEFAULT_CONFIG.strictSelector),
    safety: cliFlags.safety ?? envSafety ?? fileConfig.safety ?? DEFAULT_CONFIG.safety,
    adbPath: cliFlags.adbPath ?? envAdb ?? fileConfig.adbPath,
  };
}
