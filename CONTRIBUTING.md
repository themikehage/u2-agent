# Contributing to u2-agent

Thank you for your interest in improving `u2-agent`! We welcome contributions, bug reports, and optimizations that make mobile automation faster and more token-efficient for AI agents.

---

## 1. Prerequisites

Before developing on `u2-agent`, ensure you have:
- [Bun](https://bun.sh) (version 1.1 or higher)
- Android SDK Platform-Tools (`adb` must be on your system `PATH`)
- An Android device (USB or Wi-Fi debugging enabled) or an Android Emulator

---

## 2. Getting Started

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/themikehage/u2-agent.git
   cd u2-agent
   ```
2. Install dependencies:
   ```bash
   bun install
   ```
3. Verify your attached device:
   ```bash
   bun run src/index.ts device list
   ```
4. Install and start the runtime service on your test device:
   ```bash
   bun run src/index.ts setup install
   ```

---

## 3. Architecture & Non-Negotiable Invariants

Before proposing any changes, please review [AGENTS.md](AGENTS.md):
- **Token Efficiency First**: Never emit unnecessary boilerplate or raw XML dumps in default outputs.
- **Clean Stream Separation**: Machine/agent data goes to `stdout`. All logs, diagnostics, and warnings must go to `stderr`.
- **Handle-First Actions**: Element interactions prefer `--ref @N` handles resolved via memory cache rather than expensive full re-dumps.
- **Zero Heavy Runtime Dependencies**: Keep core functionality lean and fast on Bun native APIs.

---

## 4. Development Workflow & Testing

Run unit tests locally:
```bash
bun test tests/unit
```

Compile a single-binary distribution:
```bash
bun run build
```

Verify TypeScript types:
```bash
bun run tsc --noEmit
```

---

## 5. Commit Guidelines

We enforce [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` New capability or command
- `fix:` Bug fix
- `perf:` Performance or token footprint reduction
- `docs:` Documentation improvements
- `refactor:` Code refactoring without behavior change
- `test:` Adding or updating tests

*Please do not add AI attribution tags or "Co-Authored-By" lines in commits.*

---

## 6. Submitting a Pull Request

1. Create a feature branch: `git checkout -b feat/my-improvement`
2. Ensure `bun test tests/unit` passes with 0 failures
3. Update `CHANGELOG.md` with your changes
4. Open a pull request against `main` using our PR template
