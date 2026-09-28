# u2bun — Recomendaciones de Rendimiento y Mejoras

Documento de trabajo basado en el análisis del código actual (`src/`) y en la ejecución real sobre el dispositivo `Mi_9_SE`. Cada recomendación incluye evidencia (`archivo:línea`), impacto estimado y una propuesta concreta. Prioridades: **P0** (bloquea o engaña al operador), **P1** (rendimiento/robustez relevante), **P2** (mejora menor).

---

## 1. Detección y auto-arranque del daemon uiautomator2 (P0)

### Problema
`u2bun` **nunca arranca** el servidor uiautomator2 del dispositivo. `DeviceSession.connect()` solo hace `adb forward tcp:9008` + `ping` (`src/runtime/device.ts:24-44`). Si el servidor (puerto 9008) está caído, el `ping` falla y se lanza un `DeviceOfflineError` **engañoso**: el dispositivo SÍ está online, lo que está caído es el runtime.

Evidencia de la sesión real:
- `adb devices` → `da0f5e72` y `192.168.1.19:5555` en estado `device` (online).
- `netstat -tln | grep 9008` → sin listener.
- `ui snapshot` → `Error [DEVICE_OFFLINE]: ... socket connection was closed unexpectedly`, con hint `Run u2bun device reconnect` que **no resuelve nada**.
- Arreglo manual: `adb shell "nohup sh -c 'CLASSPATH=/data/local/tmp/u2.jar app_process / com.wetest.uia2.Main -p 9008' ..."` → puerto 9008 en `LISTEN` y `ui snapshot` funcionó.

El comando de arranque es el estándar de openatx/uiautomator2 (`uiautomator2/core.py:78`):
```
CLASSPATH=/data/local/tmp/u2.jar app_process / com.wetest.uia2.Main -p 9008
```

### Recomendación
1. **Distinguir causas**: antes de declarar `DEVICE_OFFLINE`, verificar que ADB responde (p. ej. `adb shell getprop ro.build.version.sdk`). Si ADB responde pero el `ping` JSON-RPC falla → el runtime está caído, no el dispositivo.
2. **Auto-arranque con reintento**: si el ping falla y ADB responde, lanzar el servidor en background (`nohup app_process`), y esperar con polling (hasta ~5 s) a que el puerto 9008 quede en `LISTEN`.
3. **Nuevo código de error** `UIAUTOMATOR_DOWN` (retryable) separado de `DEVICE_OFFLINE`, con hint accionable.

### Diseño propuesto — `src/runtime/runtime.ts` (nuevo)

```ts
export async function ensureU2Runtime(serial: string, adbPath?: string): Promise<void> {
  // 1. ADB sano? (distingue dispositivo caído vs runtime caído)
  await execAdb(["-s", serial, "shell", "getprop", "ro.build.version.sdk"], adbPath);

  // 2. ¿Puerto 9008 escuchando en el dispositivo?
  if (await isPortListening(serial, 9008, adbPath)) return;

  // 3. ¿u2.jar presente? Si no, pushearlo (ver §1.1)
  await ensureU2Jar(serial, adbPath);

  // 4. Arrancar servidor en background
  await execAdb([
    "-s", serial, "shell",
    "nohup sh -c 'CLASSPATH=/data/local/tmp/u2.jar app_process / com.wetest.uia2.Main -p 9008 > /data/local/tmp/u2.log 2>&1' > /dev/null 2>&1 &",
  ], adbPath);

  // 5. Esperar readiness (polling)
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await isPortListening(serial, 9008, adbPath)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new RuntimeDownError(serial, "uiautomator2 server did not become ready");
}
```

`isPortListening` puede usar `netstat -tln | grep 9008` (Android 7+) o, si no está disponible, `ss -tln`; en última instancia, el propio `ping` JSON-RPC sirve de sonda de readiness.

`DeviceSession.connect()` (`src/runtime/device.ts:20-45`) pasaría de "forward + ping" a "forward + `ensureU2Runtime` + ping", eliminando el doble `try/catch` actual que no distingue causas.

### 1.1 Vendorizar `u2.jar` (necesario para auto-provisionar)
Hoy `u2.jar` vive solo en el dispositivo. Si se borra o es un dispositivo nuevo, `setup.install` no lo pushea (solo intenta conectar, `src/runtime/provisioning.ts:64-83`). Para un provisionamiento real, `u2bun` debe incluir una copia de `u2.jar` (p. ej. `assets/u2.jar`) y pushearla cuando falte o el hash difiera (mismo patrón que `uiautomator2/core.py:257-264`). Esto respeta el invariante *zero-dependency* (es un binario vendoreado, no una dependencia runtime).

---

## 2. Clasificación de errores y salida de diagnóstico (P0)

### Problema
- `DeviceOfflineError` se usa para **cualquier** fallo de conexión (`src/runtime/device.ts:42`), mezclando "dispositivo caído" con "runtime caído". El hint (`device reconnect`) es incorrecto para el caso runtime.
- El daemon devuelve `500` con `err.message` crudo (`src/daemon/server.ts:119-121`); el CLI hace fallback a RPC directo y enmascara la causa real (`src/domains/ui.ts:338-340`).

### Recomendación
1. Nueva clase `RuntimeDownError` → code `UIAUTOMATOR_DOWN`, `retryable: true`, `exitCode` propio (o `ExitCode.PROVISION`), hint `Run u2bun setup install` o auto-start automático.
2. Añadir endpoint `/health` al daemon (`src/daemon/server.ts`) que reporte de forma diferenciada: `{ device: "online", adb: true, u2_runtime: "up|down", port_forward: true }`. El CLI puede consultarlo antes del fallback para dar un diagnóstico preciso.
3. Registrar el warning de fallback en `stderr` (ya se hace vía `ctx.warn`), pero **no** hacer fallback silencioso cuando el runtime está caído y el arranque automático falló: reportar `UIAUTOMATOR_DOWN` en vez de un `DEVICE_OFFLINE` genérico.

---

## 3. Extender el daemon a todas las acciones (P1)

### Problema
Solo `ui.snapshot` y `ui.tap` usan el daemon (`src/domains/ui.ts:328-341`, `452-462`). El resto — `ui.long_press`, `ui.input`, `ui.swipe`, `ui.scroll`, `ui.press`, `ui.wait`, `ui.find`, `ui.type` — abre una **nueva conexión** y hace `dumpHierarchy()` completo antes de actuar en cada invocación.

Evidencia:
- `ui.tap` directo hace dump antes de resolver (`ui.ts:468-470`) y dump de nuevo si hay `expect` (`ui.ts:484`).
- `ui.wait` hace dump cada 500 ms (`ui.ts:844`).
- `ui.find` hace dump en cada scroll (`ui.ts:913`).
- `ui.type` dump para resolver + dump post (`ui.ts:749`, `763`).

Cada `dumpHierarchy()` es un XML completo + parse + dedup. En un bucle de agente (snapshot → tap → snapshot → …) esto domina la latencia.

### Recomendación
1. Mover **todas** las acciones interactivas al daemon, que ya cachea `elements`/`handles` y evita re-dumps en frío (`src/daemon/server.ts:76-143`). `ui.swipe`, `ui.scroll`, `ui.press`, `ui.input` no necesitan dump previo: son gestos/teclas puras → se pueden ejecutar directamente contra el client JSON-RPC del daemon (sub-15 ms), sin XML.
2. Cuando `ui.tap --ref @N` llega **sin** `expect`, saltarse el dump: el daemon ya tiene las coordenadas cacheadas del handle. Solo con `--expect-*` se hace dump post.
3. Añadir un `--no-wait-idle` / espera breve entre gesto y post-dump para evitar leer la jerarquía antes de que la UI se estabilice (reduce falsos negativos de `expect` y reintentos).

---

## 4. Micro-optimizaciones de parsing y deduplicación (P1)

### Problema A — regex recompilado por atributo por nodo
`parseXmlDump` compila un `RegExp` **por cada atributo de cada nodo** dentro del closure `getAttr` (`src/domains/ui.ts:196-208`):
```ts
const m = attrStr.match(new RegExp(`${key}="([^"]*)"`));
```
Son ~8 compilaciones regex por nodo. En jerarquías grandes (LinkedIn, YouTube) son miles de nodos → miles de compilaciones innecesarias.

**Recomendación**: precompilar una sola vez:
```ts
const attrCache = new Map<string, RegExp>();
const getAttr = (key: string) => {
  let re = attrCache.get(key);
  if (!re) { re = new RegExp(`${key}="([^"]*)"`); attrCache.set(key, re); }
  const m = attrStr.match(re);
  return m ? decodeXmlEntities(m[1]) : "";
};
```

### Problema B — dedup O(n²) con `parseBoundsRect` recalculado
`deduplicateAndFilterElements` (`ui.ts:88-137`) itera cada elemento contra todos los ya aceptados, y `parseBoundsRect` se recalcula dentro del bucle interno. O(n²) en peor caso.

**Recomendación**:
1. Pre-calcular el rectángulo de cada elemento **una vez** (mapa `index → rect`).
2. Reemplazar el barrido lineal por *grid bucketing* (bucket por celda de pantalla ~100 px): para cada elemento solo se comparan vecinos en celdas adyacentes → ~O(n).

### Problema C — orden de elementos por "relevancia"
`ui.snapshot` trunca por defecto a `limit=30` en **orden de documento** (`ui.ts:355-357`). El elemento objetivo puede quedar fuera del corte, obligando al agente a más scrolls/`ui.find`.

**Recomendación**:
1. Ordenar antes del corte por relevancia: enfocado primero, luego clickable con texto, luego por posición en pantalla (centro → arriba → abajo).
2. Añadir una línea de pie de corte explícita al snapshot: `... (truncated, N more elements)` para que el agente sepa que hay más y no asuma ausencia.

---

## 5. Inconsistencia `--json` vs contrato de salida (P1)

### Problema
El skill (`SKILL.md`) y los propios comandos documentados usan `--json`, pero **no existe manejo de `--json`** en el CLI: `parseArgs` (`src/cli.ts:12-88`) lo parsea como arg de tool (`json: true`) y `renderOutput` (`src/output.ts:58-133`) siempre imprime la forma compacta (snapshot, `ok`, listas tabuladas). Es un flag muerto.

Además hay tensión con los invariantes:
- `AGENTS.md` (u2bun) §1.2: salida **solo** texto plano ultra-compacto, nunca envelope JSON.
- `AGENTS.md` (u2ctl) §1.4: salida JSON envelope **cuando** `--json`.
- `SKILL.md` §0/§1: "stdout is JSON by default when --json is set".

### Recomendación
Elegir un contrato y cumplirlo de forma consistente:
- **Opción A (alineada a u2bun)**: quitar `--json` del skill y de la doc; la salida es siempre texto plano LLM-first. Simple y coherente con el objetivo de token-efficiency.
- **Opción B**: implementar `--json` de verdad (emitir envelope JSON en `stdout`), útil para consumidores de máquina no-LLM, y documentar que el default sin `--json` es texto plano.

Recomiendo **B** (un flag real, default texto plano) porque mantiene el contrato LLM-first por defecto y habilita integraciones estructuradas. Cualquiera de las dos resuelve el flag muerto; lo importante es no dejar `--json` como no-op.

---

## 6. `app.start` con `monkey` (P2)

### Problema
`app.start` sin `activity` lanza `monkey -p <pkg> -c LAUNCHER 1` (`src/domains/app.ts:70`). `monkey` es lento (varios segundos) y a veces flaky. Con `activity` usa `am start -n`, más rápido.

### Recomendación
Resolver la activity de lanzamiento y usar siempre `am start`:
```
adb shell cmd package resolve-activity --brief <pkg> | tail -n 1
adb shell am start -n <pkg>/<resolvedActivity>
```
Esto unifica la vía rápida y elimina la dependencia de `monkey`.

---

## 7. Reutilización de sesión en `run.steps` (P2)

### Problema
Cada paso de `run.steps` (`src/domains/run.ts:19-81`) invoca `tool.handler` con el mismo `ctx`, pero los handlers abren **una nueva `DeviceSession`** por paso (nueva conexión + forward + ping). Un batch de N pasos paga N veces el costo de conexión.

### Recomendación
Inyectar/reciclar una única sesión (o el daemon) en `ctx.deviceSession` para todo el batch, de modo que `run.steps` comparta conexión. Es el mayor win de latencia para ejecuciones batch.

---

## 8. Robustez del daemon (P2)

### Problemas detectados
- `DaemonClient.ensureDaemon` usa `__dirname` (`src/daemon/client.ts:55`) para ubicar `server.ts`. En Bun ESM `__dirname` es frágil si el proceso se lanza desde otro cwd o empaquetado. Preferir `import.meta.dir` / ruta resuelta respecto del binario.
- El archivo de estado del daemon se escribe en `tmpdir()` (`src/daemon/server.ts:10-13`). Si el daemon muere sin `/shutdown`, queda un archivo huérfano. `getActivePort` ya tolera puerto muerto, pero conviene **limpiar** los `.json` de daemons inactivos al arrancar el CLI (o usar un lock/PID check).
- El polling de arranque del daemon (`src/daemon/client.ts:64-71`) espera hasta 750 ms; el primer `snapshot` tras arrancar el daemon siempre es lento. Considerar un arranque "eager" al primer `device.status`/`app.start`, o persistir el daemon entre invocaciones (ya lo hace vía config file).

### Recomendación
1. Reemplazar `__dirname` por `import.meta.dir` (o resolver relativo a `import.meta.url`).
2. Al detectar un daemon muerto, borrar su config huérfana.
3. Documentar el daemon como proceso persistente y opcionalmente exponer `daemon stop` para limpieza explícita.

---

## 9. Benchmarking y pruebas de regresión sugeridas

Para validar las mejoras de forma objetiva:

1. **Latencia de acción** (debe ser sub-15 ms vía daemon):
   - Medir `ui tap --ref @1` con daemon caliente vs cold path.
   - Target: `<15 ms` warm, `<150 ms` cold (primer dump), sin re-dumps innecesarios.
2. **Detección/recuperación del runtime**:
   - Matar el servidor (`adb shell kill <pid app_process>` o `pkill -f com.wetest.uia2`) y verificar que `ui snapshot` arranca automáticamente en <5 s y devuelve datos.
   - Verificar que el error reportado sea `UIAUTOMATOR_DOWN` (no `DEVICE_OFFLINE`) cuando el dispositivo está online.
3. **Token footprint**:
   - `ui snapshot` sobre una app densa (LinkedIn feed): medir bytes/`tokens` del snapshot y verificar que el dedup mantiene ≥85 % de ahorro frente a `ui dump`.
   - Test de no-regresión: la prueba de deduplicación existente debe seguir pasando (`bun test tests/unit`).
4. **Parsing**:
   - Bench del parser sobre un dump grande antes/después de precompilar regex y de aplicar grid-bucketing (esperar mejora 2–5× en jerarquías de >1000 nodos).

---

## Resumen de prioridades

| # | Recomendación | Prioridad | Impacto |
|---|---|---|---|
| 1 | Detectar + auto-arrancar runtime uiautomator2; vendorizar `u2.jar` | P0 | Elimina el fallo "DEVICE_OFFLINE" engañoso y la intervención manual |
| 2 | Error `UIAUTOMATOR_DOWN` + `/health` en daemon | P0 | Diagnóstico claro, hint accionable |
| 3 | Daemon para todas las acciones; tap por handle sin dump | P1 | Sub-15 ms consistente, menos re-dumps |
| 4 | Precompilar regex + grid-bucketing + orden por relevancia | P1 | Parsing/dedup 2–5× más rápido, snapshots más útiles |
| 5 | Resolver inconsistencia `--json` | P1 | Contrato de salida coherente, flag muerto eliminado |
| 6 | `app.start` vía `am start` en vez de `monkey` | P2 | Arranque de app más rápido y fiable |
| 7 | Reutilizar sesión en `run.steps` | P2 | Menor latencia en batches |
| 8 | Robustez daemon (`import.meta.dir`, cleanup, stop) | P2 | Menos estados huérfanos, arranque más fiable |
