# Install an app from Google Play Store

## Context
- App package / Activity where this starts: `com.android.vending` (Play Store)
- Precondition: Play Store installed, account signed in, device online.

## Steps
inside u2bun (workdir: `u2bun/`)

1. `adb -s <SERIAL> shell monkey -p com.android.vending -c android.intent.category.LAUNCHER 1` → launch Play Store.
2. `ui snapshot` → confirm store home loaded (bottom nav: Inicio/Juegos/Aplicaciones/Libros/Tú).
3. `ui tap --ref @N` on the bottom-nav "Buscar" item (`Text "Buscar"`).
4. `ui snapshot` → find the search field (`Item "Buscar en Google Play"`, top of screen).
5. `ui tap --ref @N` on the search field, then `ui input --text "<app name>"`.
6. `ui press --key enter` → search results.
7. `ui snapshot` → find the app card (`Item "<App Name>&#10;<Developer>&#10;..."`) and its `Item "Instalar"` button.
8. `ui tap --ref @N` on `Instalar`.
9. Wait ~20-40s, then verify install completed: `adb -s <SERIAL> shell pm list packages | grep <package>` or `dumpsys package <pkg> | grep versionName`.

## Postcondition
- The app package appears in `pm list packages` with a resolved version.

## Known Pitfalls
- Play Store search field is `Item "Buscar en Google Play"` (top area), NOT the bottom "Buscar" nav item. Tap the search field first, then type.
- During install the button changes to `Item "Pendiente…"` → `Item "Instalando…"` → `Item "Abrir"`. Do not re-tap "Instalar" while pending.
- The Play Store is signed in as `Levi thatdream.on@gmail.com` on this device; account selection dialogs may appear on other devices.
- After `ui input` + Enter, results load after ~2-3s; re-snapshot before tapping the app card.
- Device serial: `192.168.1.19:5555` (WiFi) — the old `da0f5e72` (USB) no longer applies.