import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { getDaemonConfigPath, type DaemonInfo, BUILD_ID } from "./server";

export class DaemonClient {
  public serial: string;
  private port: number | null = null;

  constructor(serial?: string) {
    this.serial = serial || "";
  }

  private async ensureSerial(): Promise<string> {
    if (!this.serial) {
      const { selectTargetDevice } = await import("../runtime/adb");
      const { target } = await selectTargetDevice();
      this.serial = target.serial;
    }
    return this.serial;
  }

  private async getActivePort(): Promise<number | null> {
    await this.ensureSerial();
    if (this.port !== null) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/ping`, { signal: AbortSignal.timeout(300) });
        if (res.ok) {
          const data: any = await res.json();
          if (data.ok && data.serial === this.serial && data.build_id === BUILD_ID) {
            return this.port;
          }
        }
      } catch {
        this.port = null;
      }
    }

    const configPath = getDaemonConfigPath(this.serial);
    if (!existsSync(configPath)) return null;

    try {
      const content = readFileSync(configPath, "utf-8");
      const info: DaemonInfo = JSON.parse(content);

      // PID liveness check
      if (info.pid) {
        try {
          process.kill(info.pid, 0);
        } catch {
          // Process is not running
          try { unlinkSync(configPath); } catch {}
          return null;
        }
      }

      const res = await fetch(`http://127.0.0.1:${info.port}/ping`, { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        const data: any = await res.json();
        if (data.ok && data.serial === this.serial) {
          if (data.build_id === BUILD_ID) {
            this.port = info.port;
            return info.port;
          } else {
            // Version skew detected: shutdown outdated daemon
            try {
              await fetch(`http://127.0.0.1:${info.port}/shutdown`, { method: "POST", signal: AbortSignal.timeout(500) });
            } catch {}
            try { unlinkSync(configPath); } catch {}
            return null;
          }
        }
      }
    } catch {}

    try {
      unlinkSync(configPath);
    } catch {}

    return null;
  }

  public async ensureDaemon(): Promise<number> {
    let port = await this.getActivePort();
    if (port !== null) {
      this.port = port;
      return port;
    }

    const spawnArgs = this.buildDaemonSpawnArgs();
    const child = spawn(spawnArgs[0], spawnArgs.slice(1), {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: process.env,
    });
    child.unref();

    let delay = 20;
    let elapsed = 0;
    while (elapsed < 3000) {
      await new Promise((r) => setTimeout(r, delay));
      elapsed += delay;
      delay = Math.min(Math.round(delay * 1.5), 300);
      port = await this.getActivePort();
      if (port !== null) {
        this.port = port;
        return port;
      }
    }

    throw new Error(`Failed to start u2-agent daemon for device '${this.serial}'`);
  }

  private buildDaemonSpawnArgs(): string[] {
    // When running from source, server.ts exists on disk: spawn through `bun run`.
    const serverScript = join(import.meta.dir, "server.ts");
    if (existsSync(serverScript)) {
      return [process.execPath || "bun", "run", serverScript, "--serial", this.serial];
    }
    // Compiled binary: re-invoke ourselves in --daemon-server mode (server.ts is embedded).
    const selfExec = process.execPath || process.argv[0];
    return [selfExec, "--daemon-server", "--serial", this.serial];
  }

  public async stopDaemon(): Promise<boolean> {
    await this.ensureSerial();
    const configPath = getDaemonConfigPath(this.serial);
    let stopped = false;
    const port = await this.getActivePort();
    if (port !== null) {
      try {
        await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST", signal: AbortSignal.timeout(1000) });
        stopped = true;
      } catch {}
    }
    if (existsSync(configPath)) {
      try {
        unlinkSync(configPath);
      } catch {}
    }
    this.port = null;
    return stopped;
  }

  public async getStatus(): Promise<{
    running: boolean;
    port?: number;
    pid?: number;
    build_id?: string;
    health?: Record<string, unknown>;
  }> {
    const port = await this.getActivePort();
    if (port === null) {
      return { running: false };
    }

    try {
      const pingRes = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(500) });
      const pingData: any = pingRes.ok ? await pingRes.json() : {};

      let health: Record<string, unknown> | undefined = undefined;
      try {
        const healthRes = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
        if (healthRes.ok) {
          health = (await healthRes.json()) as Record<string, unknown>;
        }
      } catch {}

      return {
        running: true,
        port,
        pid: pingData.pid,
        build_id: pingData.build_id,
        ...(health ? { health } : {}),
      };
    } catch {
      return { running: false };
    }
  }

  public async request(endpoint: string, data: any = {}): Promise<any> {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const port = await this.ensureDaemon();
        const res = await fetch(`http://127.0.0.1:${port}${cleanEndpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Connection: "keep-alive" },
          body: JSON.stringify(data),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(`Daemon request ${endpoint} failed: ${err.error || res.statusText}`);
        }
        return await res.json();
      } catch (err: any) {
        this.port = null;
        if (attempt === 1) throw err;
      }
    }
  }

  public async snapshot(args: Record<string, unknown> = {}): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const port = await this.ensureDaemon();
        const res = await fetch(`http://127.0.0.1:${port}/snapshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Connection: "keep-alive" },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(`Daemon snapshot failed: ${err.error || res.statusText}`);
        }
        return await res.json();
      } catch (err: any) {
        this.port = null;
        if (attempt === 1) throw err;
      }
    }
  }

  public async state(args: Record<string, unknown> = {}): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const port = await this.ensureDaemon();
        const res = await fetch(`http://127.0.0.1:${port}/state`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Connection: "keep-alive" },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(`Daemon state failed: ${err.error || res.statusText}`);
        }
        return await res.json();
      } catch (err: any) {
        this.port = null;
        if (attempt === 1) throw err;
      }
    }
  }

  public async dump(args: Record<string, unknown> = {}): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const port = await this.ensureDaemon();
        const res = await fetch(`http://127.0.0.1:${port}/dump`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Connection: "keep-alive" },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(`Daemon dump failed: ${err.error || res.statusText}`);
        }
        return await res.json();
      } catch (err: any) {
        this.port = null;
        if (attempt === 1) throw err;
      }
    }
  }

  public async action(command: string, args: Record<string, unknown> = {}): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const port = await this.ensureDaemon();
        const res = await fetch(`http://127.0.0.1:${port}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Connection: "keep-alive" },
          body: JSON.stringify({ command, args }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const err: any = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(`Daemon action failed: ${err.error || res.statusText}`);
        }
        return await res.json();
      } catch (err: any) {
        this.port = null;
        if (attempt === 1) throw err;
      }
    }
  }
}
