# Comment on a LinkedIn post

## Context
- App package / Activity where this starts: `com.linkedin.android` (home feed, `LaunchActivityDefault`)
- Precondition: LinkedIn feed visible with at least one post rendered. For accented text, the AdbKeyboard IME (`com.github.uiautomator/.AdbKeyboard`) must be the active input method (see §Known Pitfalls).

## Steps
inside u2bun (workdir: `u2bun/`)

1. `bun run src/index.ts --serial <SERIAL> app start --package com.linkedin.android --json`
2. `bun run src/index.ts --serial <SERIAL> ui snapshot --limit 60 --json`  → pick a post and read its message. If truncated (`… más`), tap the text block to expand it, then re-snapshot to read the full message.
3. Tap the post's comment count button `--text "<N> comentarios"` (e.g. "80 comentarios"). This opens the comments bottom sheet, or sometimes the post detail view first.
   - If a post-detail view opens (shows "Comentar"/"Compartir" actions), tap `--text "Comentar"`.
4. In the comments view, tap the composer (Input with placeholder "Añadir un comentario") to focus it.
5. `bun run src/index.ts --serial <SERIAL> ui input --text "<comentario>" --json`  (handles accents via AdbKeyboard IME)
6. `bun run src/index.ts --serial <SERIAL> ui tap --text "Comentar" --json`  → posts the comment.
7. `bun run src/index.ts --serial <SERIAL> ui snapshot --json`  → verify your comment appears as `<tu nombre> • Tú` with timestamp "ahora".

## Postcondition
- Your comment shows as `<nombre> • Tú` with "ahora" and the composer is cleared (placeholder "Añadir un comentario" returns).

## Known Pitfalls
- The comment count button has empty `resourceId`; match by exact text `<N> comentarios` (the count changes over time, so re-snapshot to get the current value).
- Tapping the count may open the post detail first; in that case tap "Comentar" to reach the composer.
- The composer is an `EditText` with placeholder "Añadir un comentario"; tap it first so it is focused before typing (unfocused AdbKeyboard broadcasts fail silently).
- Accented text: `ui input` auto-detects non-ASCII and uses the AdbKeyboard IME broadcast (`ADB_KEYBOARD_INPUT_TEXT`). If that IME is not active, it falls back to clipboard+paste which corrupts accents (`í` → `��`). Verify with `ui dump --raw` that `'\ufffd'` is absent.
- The "Comentar" (post) button is at bottom-right and is a plain `Text`; tap by text after typing.
