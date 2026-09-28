# AGENTS.md — Non-Negotiable Invariants & Architecture Rules

This document defines the core invariants and rules for `u2-agent`. Every contribution and refactor MUST adhere strictly to these principles.

Read skill `.agents/skills/u2-agent/SKILL.md` for instructions about how to use u2-agent.

## 1. Core Invariants

1. **Zero-Dependency Core**: Built purely on Bun and TypeScript native APIs. No external browser/device SDKs or heavy runtime dependencies inside `src/`.
2. **LLM Token-Efficiency First**: Outputs MUST default to ultra-compact plain text (`ok`, raw `snapshot` tree, or plain single-line lists). Never emit JSON envelope boilerplate (`schema_version`, `ok`, `command`, `device`) or full XML/DOM dumps in standard agent interaction loops.
3. **Handle-First & Daemon-Backed Architecture**: Elements in `ui.snapshot` are assigned ephemeral handles (`@1`, `@2`, ...). Actions specifying `--ref @N` MUST route through the background daemon (`src/daemon/`) for sub-15ms execution without cold re-dumps.
4. **Semantic Node Deduplication**: Raw Android hierarchy nodes MUST be cleaned before LLM consumption:
   - **Filter Structural Noise**: Strip empty container layouts (`FrameLayout`, `RecyclerView`, `StaggeredGridLayoutManager`).
   - **Collapse Ghost Wrappers**: Nodes with $\ge 85\%$ bounding box overlap MUST be merged into a single semantic handle.
   - **Normalize Roles**: Map Android class names to standard LLM roles (`Input`, `Button`, `Tab`, `Toggle`, `Item`).
5. **Clean Output Separation**: `stdout` outputs ONLY clean machine/LLM text (`ok` or snapshot string). All warnings, diagnostics, and audit logs MUST be directed strictly to `stderr`.
6. **Deterministic Error Handling**: All failures MUST map to standard error codes (`SELECTOR_NOT_FOUND`, `USAGE`, `DEVICE_OFFLINE`, `TIMEOUT`) with non-zero exit codes. Tracebacks must never leak to `stdout`.

## 2. Development & Testing Contract

- Run unit tests before committing: `bun test tests/unit`
- Any change to `ui.snapshot` or element parsing MUST maintain or reduce token footprint and pass deduplication tests.
- Afer any change we need to keep the skill `u2bun` updated.
