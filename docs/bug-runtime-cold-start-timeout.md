# u2bun — Bug: `setup install` falla en un dispositivo nuevo por timeout de cold start

> **Sesión de referencia**: `setup install` en emulador recién creado, luego búsqueda Google end-to-end
> **Dispositivo**: emulador `emulator-5554` (Pixel_8, Android SDK 36, `google_apis_playstore`, x86_64)
> **Stack**: Bun/TypeScript, runtime `uiautomator2` vía `app_process` + `u2.jar` sobre ADB
> **Estado**: ✅ **Resuelto** en [`src/runtime/runtime.ts`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/runtime/runtime.ts) (fix + tests, ver "Fix implementado")

---

## Resumen Ejecutivo

En un dispositivo **totalmente virgen**, `u2bun setup install` falla con `PROVISION_FAILED` en el primer intento. La causa no es el provisioning en sí — el `u2.jar` se empuja y el server se levanta correctamente — sino que `ensureU2Runtime` espera solo **5 segundos** a que el server responda. Un cold start de `app_process` en emulador tarda más que eso. El reintento inmediato funciona porque el server ya terminó de arrancar.

Es un bug de **timing silencioso**: el runtime nunca está caído, solo lento al arrancar en frío.

---

## Reproducción determinista

Probado sobre un emulador reseteado con `-wipe-data` (sin `u2.jar`, sin runtime, sin forward, puerto 9008 rechazando conexión).

```bash
# 1. Verificar device 100% limpio
adb -s emulator-5554 shell ls /data/local/tmp/u2.jar      # → No such file or directory
curl -s -m 3 -X POST http://127.0.0.1:9008/jsonrpc/0 ...  # → connection refused

# 2. Setup desde cero → FALLA
bun run src/index.ts --serial emulator-5554 setup install
# Error [PROVISION_FAILED]: ... uiautomator2 server did not become ready after auto-start
# exit=4 elapsed=7s

# 3. El runtime SÍ quedó vivo (arrancó tarde)
adb -s emulator-5554 shell "ps -A -o PID,ARGS | grep uia2"
#   2382 sh -c CLASSPATH=/data/local/tmp/u2.jar app_process / com.wetest.uia2.Main -p 9008 ...
#   2383 app_process / com.wetest.uia2.Main -p 9008
curl ... "ping"                                            # → {"result":"pong"}

# 4. Retry inmediato → OK
bun run src/index.ts --serial emulator-5554 setup install
# status: ready, exit=0 elapsed=2s
```

Otra reproducibilidad (sin wipe), matando el server a mano:

```bash
adb -s emulator-5554 shell pkill -f com.wetest.uia2
bun run src/index.ts --serial emulator-5554 device info     # falla ~6s
bun run src/index.ts --serial emulator-5554 device info     # OK 2s
```

---

## Causa raíz

En [`src/runtime/runtime.ts:93-106`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/runtime/runtime.ts#L93), tras lanzar el server el poll tiene un deadline fijo de 5 segundos:

```typescript
// 4. Start uiautomator2 server in background via app_process
const launchCmd = `nohup sh -c 'CLASSPATH=${U2_JAR_REMOTE_PATH} app_process / com.wetest.uia2.Main -p ${localPort} > /data/local/tmp/u2.log 2>&1' > /dev/null 2>&1 &`;
await execAdb(["-s", serial, "shell", launchCmd], adbPath);

// 5. Poll for readiness (up to 5 seconds)
const deadline = Date.now() + 5000;   // ← BUG: margen insuficiente para cold start
while (Date.now() < deadline) {
  if (await checkU2Readiness(localPort, 500)) {
    return;
  }
  await new Promise((r) => setTimeout(r, 250));
}

throw new RuntimeDownError(serial, "uiautomator2 server did not become ready after auto-start");
```

En un dispositivo físico con el server ya cacheado/caliente, 5s alcanzan. En un dispositivo nuevo (o emulador), el primer arranque de la JVM con `app_process` más la carga de `u2.jar` supera ese margen de forma consistente.

---

## Impacto

- **Onboarding roto en primera ejecución**: el caso más importante (device nuevo) es justo el que falla.
- Un agente automatizado que ejecuta `setup install` una sola vez y no reintenta queda bloqueado con un falso `UIAUTOMATOR_DOWN`.
- El error es engañoso: reporta "server is down" cuando en realidad está "server arrancando lentamente".
- Afecta a cualquier target más lento que el device de desarrollo: emuladores, devices físicos antiguos, ADB por Wi-Fi con latencia.

---

## Fix implementado

Reescritura de `ensureU2Runtime` en [`src/runtime/runtime.ts`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/runtime/runtime.ts):

1. **Budget realista de cold start**: `COLD_START_TIMEOUT_MS = 30_000`. El caso caliente no se penaliza porque el poll corta en el primer probe exitoso.
2. **Backoff exponencial acotado**: nuevo helper `pollUntil()` con intervalos `200ms → 400ms → … → max 1s`, sin dormir más allá del deadline. Clock y sleep inyectables para tests deterministas.
3. **Re-check tras empujar el jar**: si otro proceso arrancó el server mientras se copiaba `u2.jar`, se detecta y no se relanza.
4. **Chequeo del lanzamiento**: ahora se valida el `exitCode` de `execAdb` del `app_process` (antes se ignoraba).
5. **Diagnóstico en el error**: `RuntimeDownError` diferencia "cold start agotado" y adjunta el tail de `/data/local/tmp/u2.log` (últimos 1500 chars), eliminando pasos de diagnóstico extra.
6. **Dedup in-process**: un `Map` de promesas in-flight evita lanzar dos `app_process` en carrera por el mismo `serial:port`.

Tests nuevos en [`tests/unit/runtime.test.ts`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/tests/unit/runtime.test.ts): hot path sin sleeps, backoff acotado, no over-sleep del deadline, y regresión explícita (server que tarda ~10s: falla con 5s, pasa con 30s).

### Verificación

- `bun test tests/unit` → **97 pass / 0 fail**.
- Emulador `emulator-5554` con runtime y `u2.jar` borrados (`curl` a 9008 → connection refused), `setup install` en **un solo intento** → `status: ready` en **8s** (antes fallaba a los 7s).
- `device info` en frío con budget default → OK en 2s.
- Con budget forzado de 2s y runtime caído, el error incluye `(cold start budget)` y el tail del `u2.log` (`[server] INFO: [UiAutomator2Server] Starting Server`).

---

## Notas menores confirmadas en la misma sesión

- **`transport` mal etiquetado**: el serial del emulador (`emulator-5554`) no contiene `:`, así que [`listAdbDevices`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/runtime/adb.ts#L64) lo marca `usb` en vez de emulador/local. Cosmético, no rompe nada.
- **Input no-ASCII en emulador**: [`inputTextViaAdbKeyboard`](file:///c:/Users/themi/AgentWorkspace/u2ctl/u2bun/src/runtime/adb.ts#L153) depende del IME `ADBKeyboard`, ausente en un emulador stock; cae al camino de clipboard, que corrompe UTF-8.
- **Funciona en emulador**: el runtime basado en `app_process` + `u2.jar` (sin APK) corre sin problema en emuladores. Verificado con búsqueda Google end-to-end (snapshot → tap → type → enter).
