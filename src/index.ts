#!/usr/bin/env bun
import { runCli } from "./cli";

if (process.platform === "win32") {
  process.env.BUN_FORCE_UTF8 = "1";
}

const args = Bun.argv.slice(2);

if (args[0] === "--daemon-server") {
  // Daemon mode: runDaemonServer exits on --stop/usage errors internally and
  // resolves right after Bun.serve starts. Kill the module execution here so we
  // never fall through to runCli (which would die with the process and take the
  // daemon down with it). Bun.serve keeps the event loop alive; the unresolved
  // promise below simply blocks the CLI path.
  const { runDaemonServer } = await import("./daemon/server");
  await runDaemonServer(args);
  await new Promise<void>(() => {});
}

const exitCode = await runCli(args);
process.exit(exitCode);

