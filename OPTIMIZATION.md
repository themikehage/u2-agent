# u2-agent — Optimization Analysis (noise to remove / simplifications to add)

Goal: every token and every second counts. Findings ranked by impact. Each entry cites the exact file:line and explains the concrete cost to an agent loop.

---

## 1. CRITICAL — Correctness bugs that burn agent time

### 1.1 kebab-case flags are parsed to camelCase, but every schema field is snake_case
- `src/cli.ts:92-94` — `camelCase()` turns `--from-pos` → `fromPos`, but the tool schemas declare `from_pos` (snake_case).
- Broken today (verified live): `--from-pos`, `--to-pos`, `--from-x`, `--from-y`, `--to-x`, `--to-y`, `--duration-steps`, `--resource-id`, `--text-contains`, `--class-name`, `--desc-contains`.
- Only underscore flags (`--desc_contains`) work, and only because `camelCase` leaves `_` alone.
- **Cost**: agent passes a documented kebab flag → gets `UsageError` → re-reads help → retries with underscore → wasted round-trips.
- **Fix**: normalize kebab→snake (`str.replace(/-/g, "_")`), or accept both and canonicalize to snake_case.

### 1.2 Warnings are computed then silently dropped in compact mode
- `src/output.ts:118-122` — the warnings loop sits AFTER every early `return`, so it is unreachable for `ok`/snapshot/single-line paths. `resolveSelector` emits `Ambiguous selector matched N elements...` (resolver.ts:122) and it never reaches the agent.
- **Cost**: agent taps the "first in document order" match with zero warning → taps the wrong element → has to re-dump and recover. This is the single most dangerous silent failure.
- **Fix**: print warnings to `stderr` (never stdout) immediately, before returning.

### 1.3 Error output drops the recovery hint and retryable flag
- `src/output.ts:67-69` — `console.error(\`Error [${code}]: ${message}\`)` discards `error.hint` and `error.retryable`.
- The hint ("Run `device reconnect --serial X`") is exactly the self-healing signal an agent needs. `retryable` tells it whether retrying is safe.
- **Fix**: emit `Error [CODE]: message` then `hint: <hint>` on stderr. Optionally a compact `retryable` marker.

---

## 2. Token noise — REMOVE

### 2.1 `--json` is a dead, misleading flag
- Parsed (`src/cli.ts:49-50`, `config.ts:8`) and advertised in `--help` ("Emit output in machine-readable JSON envelope"), but `renderOutput` ignores `asJson` entirely (`src/output.ts:58-59`). The SKILL.md also claims "JSON by default when --json is set" — false.
- AGENTS.md §2 already mandates *no* JSON envelope boilerplate. So the flag is pure confusion.
- **Fix**: delete `--json` + `config.json` + the help/SKILL text, OR repurpose it as an explicit `--verbose`/raw switch. One source of truth.

### 2.2 `screen_fingerprint` in every snapshot header is noise to the LLM
- `src/domains/ui.ts:150` — `[App: active | fingerprint: 11c28cb1095f5f22]`. The 16-char hash is not comparable by an LLM across turns; it exists for programmatic diffing, which the agent does not do.
- **Fix**: drop it from the default header. The daemon already caches the previous fingerprint — replace it with a cheap human signal: `changed: yes/no` (see §4.1), or emit the hash only under `--fingerprint`.

### 2.3 `tools.schema --format openai` exports empty `properties: {}`
- `src/domains/tools.ts:89-92` — the OpenAI function schema has `parameters: { type: "object", properties: {} }`. Completely useless for capability discovery.
- **Fix**: either implement a real zod→JSON-Schema converter, or remove the `openai` format. Half a feature is worse than none.

### 2.4 Snapshot label falls back to raw `resourceId`
- `src/domains/ui.ts:154` — `e.text || e.contentDesc || e.resourceId`. Resource IDs (`com.linkedin.android:id/feed_item_xyz`) are ugly, high-token noise the LLM cannot act on.
- **Fix**: label = `text || contentDesc`; omit label when both empty (already filtered). Drop the resourceId fallback.

### 2.5 `getSemanticRole` has a language-specific, wrong heuristic
- `src/domains/ui.ts:66` — `text.includes(" de ")` → `"Tab"`. Observed live: `"Ver perfil de Julio Chirinos"` and `"Estado del botón de reacción"` were both mislabeled `Tab`. These are a profile link and a reaction toggle, not tabs.
- **Cost**: wrong roles mislead the LLM's next action choice.
- **Fix**: remove the Spanish substring heuristic entirely. Use class + `clickable`/`checkable` + `resourceId` (e.g. `*tab*`) only.

### 2.6 Generic role fallbacks `Element` / `Item` add lines without information
- `src/domains/ui.ts:72` — returns `"Item"` for text nodes and `"Element"` for empty ones. These are near-zero-information lines.
- **Fix**: consider dropping `Element` entirely and tightening which `Item`s survive filtering.

### 2.7 `ui.tap` returns the full matched `element` object
- `src/domains/ui.ts:479` and daemon `/action` (`src/daemon/server.ts:125-130`) return `element` with `bounds`/`resourceId`/`className`/`flags`. Under compact mode it collapses to `ok`, but any `--expect` path or daemon path carries this blob.
- **Fix**: return only `tapped`, `x`, `y` (and `expect_satisfied` when relevant). Never the raw element.

---

## 3. Wasted seconds — REMOVE

### 3.1 `ui.scroll` / `ui.swipe` re-dump the hierarchy just to compute a fingerprint that is discarded
- `src/domains/ui.ts:641-643` (swipe) and `701-703` (scroll) — after the gesture, `dumpHierarchy()` (200–500 ms over ADB) runs solely to compute a fingerprint that ends in `ok`. The agent re-snapshots anyway.
- **Fix**: delete the post-gesture dump. Return `ok` (or `swiped`) immediately.

### 3.2 Every command re-runs `adb devices -l` + `forward` + `ping`
- `src/runtime/device.ts:20-47` + `adb.ts:77-120` — each `ui.*` cold-starts `selectTargetDevice` (full `adb devices -l`), re-forwards the port, and pings uiautomator2. For a 15-step routine that's ~15 ADB round-trips that don't need to happen.
- **Fix**: (a) cache the device list/selection in the process; (b) reuse the existing port forward (check before re-forwarding); (c) route more actions through the daemon which holds a warm `DeviceSession` (see §3.4).

### 3.3 Daemon bootstrap polling is slow and wasteful
- `src/daemon/client.ts:48-55` — spawn + poll `/ping` 20×100ms = up to ~2 s, plus `AbortSignal.timeout(1000)` per `getActivePort`.
- **Fix**: reduce poll interval/attempts, and reuse the already-open HTTP connection (keep-alive) for subsequent `/snapshot` + `/action` calls instead of a fresh `fetch` each time.

### 3.4 The daemon fast-path is bypassed exactly when it matters most
- `src/domains/ui.ts:432` — the daemon is used only when `args.ref && !hasExpect && use_daemon`. Add `--expect_*` (the recommended verification) and you drop back to a cold connect + double dump.
- **Fix**: make the daemon the default transport for ALL taps, and let the daemon satisfy `expect` by diffing against its cached `self.elements` + one post-dump, reusing the warm session.

---

## 4. Simplifications — ADD

### 4.1 `changed: yes/no` in snapshot (delta mode)
- The daemon already holds `self.fingerprint` and `self.elements`. Add `ui.snapshot --diff` that returns only *changed* lines plus a leading `changed: yes|no`. Collapses the entire "did my tap work?" verification loop from "dump full tree + eyeball" to one boolean + a few lines.

### 4.2 Surface ambiguity warnings (depends on §1.2)
- Once warnings flow to stderr, the agent gets the `Ambiguous selector matched N elements` signal and can disambiguate instead of silently acting on the wrong element.

### 4.3 Emit recovery hints (depends on §1.3)
- `hint:` on stderr turns every error into an executable next step, cutting the "read error table in SKILL.md" hop.

### 4.4 `device auto` / online-only filter
- `device list` returns both `<SERIAL_A> offline` and `<SERIAL_B> device`. Add `device list --online` or a `device auto` that resolves the single online serial, so routines stop hardcoding a serial that goes stale.

### 4.5 First-class routine runner
- Routines currently live as markdown the agent must read + translate (SKILL.md §0). The `run.steps` batch domain already exists (`src/domains/run.ts`) and the registry reserves `macro`. Add `u2bun routine <slug>` that loads `.agents/skills/u2bun/routines/<slug>.md` (or a JSON form) and executes it — one command instead of N translated steps.

### 4.6 Real package name in the snapshot header
- `ui.snapshot` passes `undefined` as the package (`ui.ts:343`), so the header always says `App: active`. `device.info` already reports `current_package`. Emit the actual package: better context at zero extra cost.

### 4.7 Expose `--limit` / `include_handles` on `ui.snapshot`
- The daemon already supports `limit` and `include_handles`; they're declared in the schema (`ui.ts:304-306`) but undocumented in the SKILL. Document them — `--limit` is a direct token-budget knob.

### 4.8 `tools.show` must include parameters
- Currently returns name/domain/description/safety only (`tools.ts:50-57`). Agents have no way to learn flags (`--from-pos`, `--expect_desc_contains`). Emit `inputSchema`/`outputSchema` (or a compact flag list) so capability discovery is actually useful.

---

## Priority order (highest value first)

1. Fix kebab→snake flag parsing (§1.1) — blocks real usage.
2. Warnings → stderr (§1.2) + hints → stderr (§1.3) — kills silent wrong-taps and self-heals errors.
3. Delete `--json` (§2.1) — one source of truth.
4. Remove scroll/swipe post-dump (§3.1) — immediate seconds saved per gesture.
5. Daemon as default transport (§3.4 + §3.2) — sub-15 ms actions, warm session.
6. `changed`/diff snapshot (§4.1) + drop fingerprint from header (§2.2) — biggest token cut.
7. Fix `getSemanticRole` (§2.5) + drop `resourceId` label fallback (§2.4) — cleaner tree.
8. Implement schema export (§2.3) + `tools.show` params (§4.8) — proper capability discovery.
9. `device auto` (§4.4) + routine runner (§4.5) — remove serial guesswork and markdown translation.
