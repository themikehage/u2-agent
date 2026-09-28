# Like a post on LinkedIn

## Context
- App package / Activity where this starts: `com.linkedin.android` (home feed, `LaunchActivityDefault`)
- Precondition: LinkedIn feed is visible with at least one post rendered.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `bun run src/index.ts --serial da0f5e72 app start --package com.linkedin.android --json`  (or `ui tap --text "LinkedIn"` from launcher)
2. `bun run src/index.ts --serial da0f5e72 ui dump --json`  → find a post's reaction-state element with `contentDesc` containing `Estado del botón de reacción`.
3. `bun run src/index.ts --serial da0f5e72 ui tap --desc_contains "Estado del botón de reacción" --expect_desc_contains "ninguna reacción" --expect_element_absent --json`

## Postcondition
- `expect_satisfied: true` (the "ninguna reacción" state disappears) and the reaction state text flips to `Estado del botón de reacción: recomendar`, while the reactions counter increments by 1 (e.g. `28 reacciones` → `29 reacciones`).

## Known Pitfalls
- The like button itself has EMPTY `content-desc` and `text`. Do NOT select it by text/resource-id. Use the sibling reaction-state element (`Estado del botón de reacción: ...`), which shares the same center coordinate.
- Do NOT tap by `--bounds` alone: the resolver's rect-overlap matcher uses min-area, so a large container (e.g. the feed `ScrollView`) that fully contains the query rect also matches and wins in document order. Use `--desc_contains` instead.
- After liking, `28 reacciones` is a separate element (its text) whose `contentDesc` is `28 reacciones`; the accent differs (`reacción` vs `reacciones`), so `--desc_contains "reacción"` matches only the button state, not the counter.
