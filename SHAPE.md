# u2-agent — Functional Shape

How `u2-agent` behaves from the operator's point of view. This document describes **what** `u2-agent` does and how it feels to drive it — as a human on the terminal or as an LLM agent over the CLI.

---

## 1. Key Invariants & Behavioral Promises

- **Zero-Dependency & Ultra-Fast**: Built on Bun and TypeScript native APIs. Boots in sub-20ms.
- **Daemon-Backed & Persistent Hot Connection**: Automatically spawns a background IPC/HTTP daemon process (`u2-agent daemon`) to keep ADB and UIAutomator2 RPC sessions hot (<15ms per action).
- **Token-Efficiency First**: Default outputs are ultra-compact text (`ok`, raw compact `snapshot` strings, plain lists) saving 85-90% of LLM context window tokens compared to raw XML/DOM dumps.
- **Handle-First Selection (`@1..@N`)**: Elements are tagged with ephemeral numeric handles (`@1`, `@2`, ...). Actions specifying `--ref @N` execute directly from the daemon's RAM handle store without expensive re-dumps.
- **Semantic Node Deduplication**: Automatically filters layout container noise (`FrameLayout`, `RecyclerView`, etc.) and collapses ghost nodes with $\ge 85\%$ bounding box overlap into single semantic items (`Input`, `Button`, `Tab`, `Toggle`, `Item`).
- **Clean Output Channels**: `stdout` carries strictly machine/LLM readable output (`ok` or snapshot string). Diagnostics, warnings, and audit logs go exclusively to `stderr`.

---

## 2. Who Uses It, and Their Journey

### Persona A — Human Operator (Ad hoc testing & troubleshooting)

1. `bun run src/index.ts device list` — List attached ADB devices.
2. `bun run src/index.ts --serial <SERIAL> ui snapshot` — Inspect compact, readable semantic screen layout.
3. `bun run src/index.ts --serial <SERIAL> ui tap --ref @1` — Execute tap by handle.

### Persona B — LLM Agent (Claude Code, OpenCode, Gemini, etc.)

1. `bun run src/index.ts tools schema --format openai` — Discover capability catalog.
2. `bun run src/index.ts --serial <SERIAL> ui snapshot` — Get ultra-compact semantic tree + `@refs` (~250 tokens).
3. `bun run src/index.ts --serial <SERIAL> ui tap --ref @1` — Execute sub-15ms handle action, returning `ok`.
4. Loop: `ui snapshot` $\to$ choose `--ref @N` $\to$ `ui tap --ref @N` $\to$ verify `ok`.

---

## 3. Output Shapes by Command

### 3.1 `ui.snapshot` (LLM-Compact Semantic Tree)
Outputs plain text without JSON envelope noise:
```text
[App: com.google.android.youtube | fingerprint: 61fa698c]
[@1] Input "Search"
[@2] Button "All"
[@3] Item "Video 1"
```

### 3.2 Action Commands (`ui.tap`, `ui.input`, `ui.press`, `ui.swipe`, `ui.long_press`, `ui.wait`, `app.start`, `app.stop`)
Output a plain `ok` status:
```text
ok
```

### 3.3 Query Commands (`app.current`, `app.list`, `device.list`)
- `app.current`: `com.facebook.katana/com.facebook.katana.MainActivity`
- `app.list`: Plain list with one package per line.
- `device.list`: `<SERIAL> device Pixel 6`

---

## 4. Exit Codes

| Exit | Meaning |
|---:|---|
| 0 | Command succeeded. |
| 1 | Usage error (`USAGE`) or invalid arguments. |
| 2 | Device layer failure (`DEVICE_OFFLINE`, `DEVICE_NOT_FOUND`, `DEVICE_UNAUTHORIZED`). |
| 3 | Target element or app not found (`SELECTOR_NOT_FOUND`, `APP_NOT_FOUND`). |
| 4 | Provisioning failure (`PROVISION_BLOCKED`). |
| 5 | Timeout or postcondition failure (`TIMEOUT`, `POSTCONDITION_FAILED`). |
| 10 | Internal error. |

---

## 5. Functional Acceptance Checklist

- [ ] `ui snapshot` outputs ultra-compact text ($\le 300$ tokens) without JSON wrapper noise.
- [ ] Actions specifying `--ref @N` execute in <15ms via the background daemon.
- [ ] Nodos with $\ge 85\%$ bounds overlap and ghost wrappers are collapsed into single semantic elements.
- [ ] `stdout` contains strictly clean output (`ok`, snapshot text, or plain list); warnings and logs go to `stderr`.
- [ ] All 19 unit tests pass: `bun test tests/unit`.
