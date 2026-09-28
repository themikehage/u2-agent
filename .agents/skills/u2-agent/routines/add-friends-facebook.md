# Add friends from Facebook suggestions

## Context
- App package / Activity where this starts: `com.facebook.katana` (home feed)
- Precondition: Facebook feed is open and logged in.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `adb -s <SERIAL> shell monkey -p com.facebook.katana -c android.intent.category.LAUNCHER 1` → launch Facebook (or `app start --package com.facebook.katana`).
2. `ui snapshot` → confirm feed loaded (stories + "¿Qué estás pensando?" + bottom nav).
3. `ui tap --ref @N` where `@N` is the "Buscar" button (top-right, content-desc "Buscar").
4. `ui snapshot` → suggestion cards appear: "Personas que quizá conozcas" with `Button "Enviar una solicitud de amistad a <Name>"` per person.
5. For each suggestion to add: `ui tap --ref @N` on `Enviar una solicitud de amistad a <Name>`.
6. `ui snapshot` → verify "Solicitud enviada" text now appears next to that person's name.

## Postcondition
- Each tapped suggestion shows "Solicitud enviada" under the person's name.

## Known Pitfalls
- Facebook Lite (`com.facebook.lite`) does NOT expose an accessibility tree — `ui snapshot`/`ui dump` return 0 elements (React Native/custom views). Use the full Facebook app (`com.facebook.katana`) instead.
- The "Añadir como amigo(a)" item is NOT tappable directly; the actionable control is the sibling `Button "Enviar una solicitud de amistad a <Name>"`. Tap that by ref.
- `ui tap --text "Añadir como amigo"` fails with `SELECTOR_NOT_FOUND`; always use the full `Enviar una solicitud de amistad a <Name>` button via `--ref`.
- Handles shift after each tap (screen re-dumps); re-snapshot before tapping the next suggestion.
- Device serial: `192.168.1.19:5555` (WiFi) — the old `da0f5e72` (USB) no longer applies.