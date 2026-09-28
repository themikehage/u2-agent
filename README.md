<div align="center">
  <h1>u2-agent</h1>
  <p><strong>LLM-native Android automation. 85% fewer tokens. Sub-15ms actions.</strong></p>

  <p>
    <a href="https://github.com/themikehage/u2-agent/actions/workflows/ci.yml"><img src="https://github.com/themikehage/u2-agent/actions/workflows/ci.yml/badge.svg" alt="CI Status" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License" /></a>
    <a href="https://bun.sh"><img src="https://img.shields.io/badge/bun-%3E%3D1.1.0-fbf0df.svg?logo=bun" alt="Bun" /></a>
    <a href="https://u2agent.therry.dev"><img src="https://img.shields.io/badge/docs-u2agent.therry.dev-00ff9d.svg" alt="Website" /></a>
  </p>
</div>

---

## The Problem

When AI agents control mobile devices, existing automation tools (Appium, Android ViewServer, raw UIAutomator XML dumps) flood the context window with **5,000 to 20,000 tokens per screen snapshot**.

A standard 15-step agent interaction can burn hundreds of thousands of tokens just reading nested layout containers (`FrameLayout`, `LinearLayout`, `RecyclerView`), leading to:
- Excessive API costs and rate limit exhaustion.
- Lost in the middle phenomena and degraded reasoning accuracy.
- 500ms to 2000ms latency per step due to heavy XML serialization.

---

## How u2-agent Solves It

`u2-agent` is a zero-dependency, ultra-fast CLI built on Bun and TypeScript native APIs. It interfaces directly with a native `uiautomator2` JSON-RPC daemon over ADB, deduplicating the view hierarchy into an ultra-compact semantic tree where every actionable element receives an ephemeral handle (`@1`, `@2`, ...).

| Automation Tool | Tokens per Screen | Execution Latency | Architecture |
| :--- | :---: | :---: | :--- |
| **UIAutomator XML Dump** | ~15,000 | ~800ms | Heavy XML string |
| **Appium Source Inspector** | ~8,000 | ~1,200ms | WebDriver JSON-Wire |
| **u2-agent (this project)** | **~250** | **<15ms** | **In-memory daemon & handles** |

---

## Quick Start (< 2 minutes)

### Prerequisites
- [Bun](https://bun.sh) (>= 1.1)
- Android SDK Platform-Tools (`adb` in your `PATH`)
- An Android device (USB / Wi-Fi) with Developer Options & USB Debugging enabled

### 1. Installation
Clone and install dependencies:
```bash
git clone https://github.com/themikehage/u2-agent.git
cd u2-agent
bun install
```

Alternatively, compile a single standalone binary:
```bash
bun run build
# Creates ./u2-agent executable
```

### 2. Provision Target Device
Initialize and start the lightweight UIAutomator2 RPC server:
```bash
bun run src/index.ts setup install
```

### 3. Take Your First Semantic Snapshot
```bash
bun run src/index.ts ui snapshot
```

---

## Example: Agent Interaction Loop

```text
# 1. Agent asks for current screen layout:
$ u2-agent ui snapshot

[App: com.google.android.youtube]
[@1] Input "Search YouTube"
[@2] Button "Explore"
[@3] Item "Live lo-fi hip hop radio - beats to relax/study to"
[@4] Button "Subscribe"

# 2. Agent taps the search field by reference handle (<15ms via background daemon):
$ u2-agent ui tap --ref @1
ok

# 3. Agent types query (supports UTF-8 accents and Unicode):
$ u2-agent ui type --ref @1 --text "synthwave radio"
ok

# 4. Agent presses Enter:
$ u2-agent ui press --key enter
ok
```

---

## LLM & Agent Integration

### OpenAI Function Calling / Tool Calling Schema
Export standard tool schemas ready to drop into OpenAI, Anthropic, or Gemini tool call configurations:
```bash
u2-agent tools schema
```

### Model Context Protocol (MCP) & Claude Integration
`u2-agent` provides direct exit codes and machine-readable text on `stdout` (`ok` or snapshot tree) and diagnostics on `stderr`, making it seamless for AI orchestrators (OpenCode, Claude Code, Cursor, Antigravity).

---

## CLI Reference

### Command Domains

| Domain | Description | Common Commands |
| :--- | :--- | :--- |
| `ui` | Screen inspection and user interactions | `snapshot`, `tap`, `type`, `input`, `swipe`, `scroll`, `press`, `wait`, `screenshot` |
| `app` | Application lifecycle management | `start`, `stop`, `restart`, `current`, `list`, `clear`, `grant_permissions` |
| `device` | Hardware inspection & connectivity | `list`, `auto`, `info`, `wake`, `unlock`, `screen`, `clipboard`, `reconnect` |
| `tools` | Capabilities discovery for agents | `list`, `show`, `schema` |
| `daemon` | Background session management | `status`, `restart`, `stop` |
| `setup` | Device bootstrap & diagnostics | `install`, `verify`, `diagnose` |
| `run` | Atomic multi-step batch execution | `steps` |

For detailed flags and options, pass `--help` to any command:
```bash
u2-agent ui tap --help
u2-agent device --help
```

---

## Architecture

```
   +------------------------------------+
   |   AI Agent (Claude / GPT / Agent)  |
   +------------------------------------+
                    |  CLI Command
                    v
   +------------------------------------+
   |       u2-agent CLI (Bun)          |
   +------------------------------------+
                    |  IPC / HTTP (<15ms)
                    v
   +------------------------------------+
   |   u2-agent Daemon (Background)     |
   |   - RAM Handle Store (@1..@N)      |
   |   - Keep-alive ADB connection      |
   +------------------------------------+
                    |  ADB Port Forward
                    v
   +------------------------------------+
   |  Android Device (UIAutomator2 RPC) |
   +------------------------------------+
```

---

## Contributing

Contributions are very welcome! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) to set up your local development environment and read [AGENTS.md](AGENTS.md) for architectural invariants.

---

## License

This project is licensed under the [MIT License](LICENSE).
