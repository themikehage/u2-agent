import { execAdb } from "./adb";
import { RuntimeDownError } from "../errors";
import { U2Client } from "./u2client";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const U2_JAR_REMOTE_PATH = "/data/local/tmp/u2.jar";
const U2_LOG_REMOTE_PATH = "/data/local/tmp/u2.log";
// Fallback download URL for u2.jar from openatx uiautomator2 releases if missing locally
const U2_JAR_DOWNLOAD_URL = "https://github.com/openatx/uiautomator2/releases/download/v2.13.0/u2.jar";

// A cold `app_process` start regularly exceeds 5s on emulators and slower devices.
// We poll up to this ceiling, but the hot path still returns on the first successful
// probe, so an already-healthy runtime is never penalized by the longer budget.
export const COLD_START_TIMEOUT_MS = 30_000;
export const POLL_INITIAL_INTERVAL_MS = 200;
export const POLL_MAX_INTERVAL_MS = 1_000;
const READINESS_PROBE_TIMEOUT_MS = 500;
const LOG_TAIL_MAX_CHARS = 1_500;

export interface PollOptions {
  /** Total budget for the wait. Defaults to COLD_START_TIMEOUT_MS. */
  timeoutMs?: number;
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  /** Injectable clock, defaults to Date.now. */
  now?: () => number;
  /** Injectable sleep, defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Polls `check` until it resolves true or the deadline elapses.
 * Uses bounded exponential backoff so a long cold start does not spam probes,
 * and never sleeps past the deadline.
 */
export async function pollUntil(
  check: () => Promise<boolean>,
  options: PollOptions = {}
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const initialIntervalMs = options.initialIntervalMs ?? POLL_INITIAL_INTERVAL_MS;
  const maxIntervalMs = options.maxIntervalMs ?? POLL_MAX_INTERVAL_MS;
  const deadline = now() + (options.timeoutMs ?? COLD_START_TIMEOUT_MS);

  let interval = initialIntervalMs;
  while (true) {
    if (await check()) return true;

    const remaining = deadline - now();
    if (remaining <= 0) return false;

    await sleep(Math.min(interval, remaining));
    interval = Math.min(interval * 2, maxIntervalMs);
  }
}

export async function isAdbHealthy(serial: string, adbPath?: string): Promise<boolean> {
  try {
    const { exitCode } = await execAdb(["-s", serial, "shell", "getprop", "ro.build.version.sdk"], adbPath);
    return exitCode === 0;
  } catch {
    return false;
  }
}

export async function isU2JarPresent(serial: string, adbPath?: string): Promise<boolean> {
  try {
    const { stdout, exitCode } = await execAdb(["-s", serial, "shell", "ls", U2_JAR_REMOTE_PATH], adbPath);
    return exitCode === 0 && stdout.includes("u2.jar") && !stdout.includes("No such file");
  } catch {
    return false;
  }
}

export async function ensureU2Jar(serial: string, adbPath?: string): Promise<void> {
  if (await isU2JarPresent(serial, adbPath)) {
    return;
  }

  // Check local assets or temp dir
  const localAssetPath = join(import.meta.dir, "../../assets/u2.jar");
  let jarPath = localAssetPath;

  if (!existsSync(localAssetPath)) {
    const tempJarPath = join(tmpdir(), "u2agent-u2.jar");
    if (!existsSync(tempJarPath)) {
      try {
        const res = await fetch(U2_JAR_DOWNLOAD_URL, { redirect: "follow" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = await res.arrayBuffer();
        writeFileSync(tempJarPath, new Uint8Array(buffer));
      } catch (err: any) {
        throw new RuntimeDownError(
          serial,
          `u2.jar missing on device and download failed: ${err.message || String(err)}`
        );
      }
    }
    jarPath = tempJarPath;
  }

  // Push u2.jar to device
  const { exitCode, stderr } = await execAdb(["-s", serial, "push", jarPath, U2_JAR_REMOTE_PATH], adbPath);
  if (exitCode !== 0) {
    throw new RuntimeDownError(serial, `Failed to push u2.jar to device: ${stderr}`);
  }
}

export async function checkU2Readiness(localPort: number, timeoutMs: number = 500): Promise<boolean> {
  try {
    const client = new U2Client(localPort, Math.ceil(timeoutMs / 1000));
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

async function readU2LogTail(serial: string, adbPath?: string): Promise<string | null> {
  try {
    const { stdout, exitCode } = await execAdb(["-s", serial, "shell", "cat", U2_LOG_REMOTE_PATH], adbPath);
    if (exitCode !== 0) return null;
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    return trimmed.length > LOG_TAIL_MAX_CHARS ? trimmed.slice(-LOG_TAIL_MAX_CHARS) : trimmed;
  } catch {
    return null;
  }
}

async function withLogTail(serial: string, adbPath: string | undefined, base: string): Promise<string> {
  const logTail = await readU2LogTail(serial, adbPath);
  return logTail ? `${base}\nlast u2.log lines:\n${logTail}` : `${base} (no u2.log output)`;
}

// Deduplicate concurrent cold starts for the same device/port within one process,
// so parallel commands cannot race two `app_process` launches.
const inflight = new Map<string, Promise<void>>();

export function ensureU2Runtime(
  serial: string,
  localPort: number = 9008,
  adbPath?: string,
  options: PollOptions = {}
): Promise<void> {
  const key = `${serial}:${localPort}`;
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = ensureU2RuntimeInternal(serial, localPort, adbPath, options).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}

async function ensureU2RuntimeInternal(
  serial: string,
  localPort: number,
  adbPath?: string,
  options: PollOptions = {}
): Promise<void> {
  // 1. Verify ADB is healthy (distinguishes device offline vs runtime down)
  const adbOk = await isAdbHealthy(serial, adbPath);
  if (!adbOk) {
    throw new RuntimeDownError(serial, "ADB connection to device failed");
  }

  // 2. Check if runtime ping succeeds right now
  if (await checkU2Readiness(localPort, READINESS_PROBE_TIMEOUT_MS)) {
    return;
  }

  // 3. Ensure u2.jar is present on device
  await ensureU2Jar(serial, adbPath);

  // 4. Re-check: another process may have started the server while we pushed the jar
  if (await checkU2Readiness(localPort, READINESS_PROBE_TIMEOUT_MS)) {
    return;
  }

  // 5. Start uiautomator2 server in background via app_process
  const launchCmd = `nohup sh -c 'CLASSPATH=${U2_JAR_REMOTE_PATH} app_process / com.wetest.uia2.Main -p ${localPort} > ${U2_LOG_REMOTE_PATH} 2>&1' > /dev/null 2>&1 &`;
  const { exitCode, stderr } = await execAdb(["-s", serial, "shell", launchCmd], adbPath);
  if (exitCode !== 0) {
    throw new RuntimeDownError(
      serial,
      await withLogTail(serial, adbPath, `Failed to launch server: ${stderr.trim() || "unknown error"}`)
    );
  }

  // 6. Poll for readiness until the cold-start deadline (backoff, no hot-path penalty)
  const ready = await pollUntil(
    () => checkU2Readiness(localPort, READINESS_PROBE_TIMEOUT_MS),
    options
  );
  if (ready) return;

  const budgetMs = options.timeoutMs ?? COLD_START_TIMEOUT_MS;
  throw new RuntimeDownError(
    serial,
    await withLogTail(
      serial,
      adbPath,
      `server did not become ready within ${Math.round(budgetMs / 1000)}s (cold start budget)`
    )
  );
}
