# Changelog

All notable changes to **u2-agent** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.2.0] - 2026-09-28

### Changed
- Project officially renamed from `u2bun` to `u2-agent`.
- Refactored binary name and CLI brandings to `u2-agent`.
- Updated daemon configuration filenames to `u2agent-daemon-*.json` and runtime jar caching to `u2agent-u2.jar`.
- Standardized open-source repository files: MIT License, Contributing Guide, Security Policy, Issue & PR templates.

### Fixed
- Fixed flag parser normalization (`kebab-case` flags like `--from-pos` correctly mapped).
- Routed runtime selector ambiguity and warning diagnostic messages directly to `stderr` instead of dropping them.
- Standardized clean exit codes and error hints for AI agent self-recovery.

### Added
- Multi-platform compile target support in Bun build pipeline.
- GitHub Actions CI workflow for test matrix across Bun versions.
- GitHub Actions Release workflow with precompiled binaries for Linux, macOS, and Windows.

---

## [0.1.0] - 2026-09-20

### Added
- Initial core implementation of zero-dependency Android UI Automator JSON-RPC client on Bun.
- Handle-first (`@1`, `@2`, ...) compact UI snapshot rendering for LLM token savings.
- Background persistent daemon supporting sub-15ms cached handle lookups.
- Semantic deduplication engine collapsing ghost wrappers and structural layout noise.
- CLI domains: `ui`, `app`, `device`, `setup`, `tools`, `daemon`, `run`.
