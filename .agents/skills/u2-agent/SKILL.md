---
name: u2-agent
description: Android UI Automator control CLI for token-efficient agent automation
---

# u2-agent Skill Guide

`u2-agent` is a zero-dependency, token-efficient Android UI Automator control CLI written in Bun/TypeScript.

## Core Invariants & Best Practices

1. **PowerShell Handle Quoting**: In PowerShell, always quote element handles (`--ref "@1"`) to prevent shell expansion of `@`.
2. **Handle-First Action Pattern**: Prefer `--ref "@N"` selectors derived from `ui snapshot` over raw coordinates or nested selectors.
3. **Minimal Token Footprint**: CLI outputs `ok` for successful actions and raw compact trees for snapshots.
4. **UTF-8 & Accents**: `ui.type` / `ui.input` automatically routes non-ASCII strings through AdbKeyboard broadcast to prevent clipboard encoding issues.

---

## Global CLI Flags

Every command supports:
- `--serial <serial>`: Target a specific device. Optional — a single connected device is auto-selected (see "Device Selection" below).
- `--json`: Output full structured JSON envelope (`{"ok": true, ...}`).
- `--quiet`: Suppress standard `ok` text output on success.
- `--timeout <seconds>`: Set command timeout in seconds (default: 30).
- `--help` / `-h`: Contextual help for domain or command.

---

## Device Selection

Routines are device-agnostic: never hardcode a serial.

- Run `device list` to see attached devices.
- Omit `--serial` when exactly one device is connected — it is auto-selected.
- Pass `--serial <SERIAL>` only when two or more devices are attached; otherwise commands fail with `DEVICE_AMBIGUOUS`.

---

## Command Reference

### Device Management (`device`)

- **Unlock screen** (wake + swipe unlock):
  ```bash
  bun run src/index.ts device unlock
  ```
- **Wake screen**:
  ```bash
  bun run src/index.ts device wake
  ```
- **Check screen state**:
  ```bash
  bun run src/index.ts device screen
  # Returns: on | off
  ```
- **Clipboard Management**:
  ```bash
  bun run src/index.ts device clipboard --action get
  bun run src/index.ts device clipboard --action set --text "token_value"
  ```
- **List devices**:
  ```bash
  bun run src/index.ts device list
  ```
- **Device Info**:
  ```bash
  bun run src/index.ts device info
  ```
- **Reconnect device / Restart ADB**:
  ```bash
  bun run src/index.ts device reconnect [--hard]
  ```

### App Lifecycle (`app`)

- **Start application**:
  ```bash
  bun run src/index.ts app start --package com.example.app [--activity .MainActivity]
  ```
- **Restart application** (force-stop + start):
  ```bash
  bun run src/index.ts app restart --package com.example.app
  ```
- **Stop application**:
  ```bash
  bun run src/index.ts app stop --package com.example.app
  ```
- **Reset app data / cache** (pm clear):
  ```bash
  bun run src/index.ts app clear --package com.example.app
  ```
- **Open URL / Deep link**:
  ```bash
  bun run src/index.ts app open_url --url "https://example.com"
  bun run src/index.ts app open_url --url "fb://profile"
  ```
- **Grant permissions** (without UI popups):
  ```bash
  bun run src/index.ts app grant_permissions --package com.example.app --permissions POST_NOTIFICATIONS,CAMERA
  ```
- **Get current foreground app**:
  ```bash
  bun run src/index.ts app current
  ```
- **List installed packages**:
  ```bash
  bun run src/index.ts app list [--third-party-only]
  ```

### UI Interaction (`ui`)

- **Take snapshot** (compact semantic hierarchy with handles `@1`, `@2`...):
  ```bash
  bun run src/index.ts ui snapshot [--limit 30] [--diff]
  ```
- **Fast screen state check** (fingerprint only, <15ms):
  ```bash
  bun run src/index.ts ui state
  ```
- **Tap element by handle or position**:
  ```bash
  bun run src/index.ts ui tap --ref "@1"
  bun run src/index.ts ui tap --pos "540,1200"
  bun run src/index.ts ui tap --text "Submit"
  ```
- **Type into input field**:
  ```bash
  bun run src/index.ts ui type --ref "@2" --text "Hello world"
  ```
- **Long press**:
  ```bash
  bun run src/index.ts ui long_press --ref "@1" --duration 1.5
  ```
- **Scroll with automatic snapshot** (saves 1 round-trip):
  ```bash
  bun run src/index.ts ui scroll --direction down --snapshot
  ```
- **Swipe**:
  ```bash
  bun run src/index.ts ui swipe --from-pos "540,1600" --to-pos "540,600"
  ```
- **Find element with auto-scroll**:
  ```bash
  bun run src/index.ts ui find --text "Save Changes" --scroll-direction down
  ```
- **Drag & drop**:
  ```bash
  bun run src/index.ts ui drag --from-ref "@1" --to-ref "@3"
  ```
- **Pinch zoom**:
  ```bash
  bun run src/index.ts ui pinch --ref "@2" --direction in
  bun run src/index.ts ui pinch --ref "@2" --direction out
  ```
- **Notifications**:
  ```bash
  bun run src/index.ts ui notifications --action expand
  bun run src/index.ts ui notifications --action read
  bun run src/index.ts ui notifications --action collapse
  ```
- **Screenshot** (saves PNG to local path without token inflation):
  ```bash
  bun run src/index.ts ui screenshot
  bun run src/index.ts ui screenshot --output path/to/screen.png
  ```
- **Hardware keys**:
  ```bash
  bun run src/index.ts ui press --key back
  bun run src/index.ts ui press --key home
  bun run src/index.ts ui press --key enter
  ```
- **Hide keyboard / IME**:
  ```bash
  bun run src/index.ts ui keyboard_hide
  ```

### Batch Execution (`run`)

- **Execute multiple actions in one round-trip**:
  ```bash
  bun run src/index.ts run steps --steps '[{"tool":"ui.tap","args":{"ref":"@1"}},{"tool":"ui.type","args":{"ref":"@2","text":"demo"}}]'
  ```

### Daemon Management (`daemon`)

- **Check daemon status**:
  ```bash
  bun run src/index.ts daemon status
  ```
- **Restart / Stop daemon**:
  ```bash
  bun run src/index.ts daemon restart
  bun run src/index.ts daemon stop
  ```

### Setup & Provisioning (`setup`)

- **Install / diagnose UiAutomator2 server**:
  ```bash
  bun run src/index.ts setup install
  bun run src/index.ts setup diagnose
  bun run src/index.ts setup start
  ```

### Tool & Schema Discovery (`tools`)

- **List available tools or export OpenAI schema**:
  ```bash
  bun run src/index.ts tools list
  bun run src/index.ts tools schema
  bun run src/index.ts tools show --tool ui.tap
  ```

---

## Contextual Help

Get full options for any domain or command:
```bash
bun run src/index.ts <domain> --help
bun run src/index.ts <domain> <command> --help
```


