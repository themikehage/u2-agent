# Search for a person on Facebook

## Context
- App package / Activity where this starts: `com.facebook.katana` (home feed)
- Precondition: Facebook feed is open; optional ad-personalization dialog may appear on top.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `bun run src/index.ts --serial da0f5e72 app start --package com.facebook.katana --json`
2. If an ad dialog shows (`Puedes administrar tu experiencia publicitaria`), dismiss it: `ui tap --description "Recordármelo más tarde"`.
3. `ui tap --description "Buscar" --json`  (top search button, content-desc "Buscar")
4. `ui input --text "<query>" --json`  (works now — `setInputText` uses `setClipboard`+`pasteClipboard` internally)
5. `ui press --key enter --json`
6. `ui dump --json` → results appear under "Personas" / "Páginas" tabs.

## Postcondition
- Search results screen shows a "Resultados de la búsqueda de Todo, 1 de 7" tab bar, with matching profiles listed (e.g. "Therry Miranda — Universidad Politecnica Territorial de Aragua").

## Known Pitfalls
- The search button has content-desc "Buscar" but is NOT in the actionable dump (Facebook obfuscates resource ids to `(name removed)`). Find it in a `--raw --filter all` dump — OR tap `--description "Buscar"` directly; it resolves to the top-right search Button.
- `ui input` used to fail with `JSON-RPC Error [-32602]` (the uiautomator2 daemon's `setText` expects `[selector, text]`). FIXED: `setInputText` now does `setClipboard([null, text])` + `pasteClipboard()`. Just use `ui input --text "<query>"`.
- After input, the query sits in the focused `EditText` (content-desc still "Buscar"); press Enter to submit. First profile result is the clickable `Button` whose `contentDesc` matches "<Name>,<School> · Vive en <City>" — tap it to open the profile.
