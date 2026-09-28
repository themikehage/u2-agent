# Search and Like a YouTube Video

## Context
- App package / Activity where this starts: `com.teslacoilsw.launcher` (home screen)
- Precondition: Device on home screen with YouTube icon visible

## Steps
Inside u2bun root:

1. `bun run src/index.ts ui tap --serial <SERIAL> --text "YouTube"` — open YouTube
2. `bun run src/index.ts ui snapshot --serial <SERIAL>` — verify YouTube loaded
3. `bun run src/index.ts ui tap --serial <SERIAL> --description "Buscar"` — open search
4. `bun run src/index.ts ui snapshot --serial <SERIAL>` — verify input focused
5. `bun run src/index.ts ui input --serial <SERIAL> --text "<QUERY>"` — type query
6. `bun run src/index.ts ui tap --serial <SERIAL> --text "<QUERY>"` — re-focus input
7. `bun run src/index.ts ui press --serial <SERIAL> --key enter` — submit search
8. `bun run src/index.ts ui snapshot --serial <SERIAL> --limit 50` — verify results
9. `bun run src/index.ts ui tap --serial <SERIAL> --desc-contains "<TITLE>"` — open video
10. `bun run src/index.ts ui snapshot --serial <SERIAL>` — verify player, find like button
11. `bun run src/index.ts ui tap --serial <SERIAL> --desc-contains "haz clic en Me gusta"` — like
12. `bun run src/index.ts ui snapshot --serial <SERIAL>` — verify: numeric like count shown

## Postcondition
Video player open. Like button shows numeric count e.g. "11.602 Me gusta".

## Known Pitfalls
- `--ref @N` on tap fails with USAGE type mismatch in some builds. Use `--text` / `--desc-contains`.
- Results RecyclerView may appear empty for 1-2s after Enter. Retry snapshot before failing.
- `ui type` fails if field already focused — use `ui input` instead.
- Tapping the query text re-opens suggestions panel; Enter is needed to execute search.
