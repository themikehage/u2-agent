# u2bun — Recomendaciones de Rendimiento y Robustez (v2)

Documento de trabajo basado en el análisis del código **actual** (`src/`) y en ejecuciones reales sobre el dispositivo `Mi_9_SE`. Cada recomendación cita evidencia (`archivo:línea`) e impacto. Prioridades: **P0** (bloquea o engaña al operador), **P1** (rendimiento/robustez relevante), **P2** (mejora menor).

> Esta v2 **complementa** la v1 (`docs/recomendaciones-rendimiento.md`). Gran parte de las recomendaciones originales **ya están implementadas**; esta versión refleja lo que **falta** y los hallazgos nuevos de esta sesión.

### Ya resuelto desde v1 (referencia, no volver a reportar)

- Auto-arranque del runtime uiautomator2 on-device: `ensureU2Runtime` / `ensureU2Jar` con descarga fallback de `u2.jar` (`src/runtime/runtime.ts`).
- Error `UIAUTOMATOR_DOWN` separado de `DEVICE_OFFLINE` (`src/errors.ts:97-108`).
- Endpoint `/health` en el daemon (`src/daemon/server.ts:57-84`).
- Daemon extendido a todas las acciones `ui.*` (`src/daemon/server.ts:154-511`).
- Cache de regex en `parseXmlDump` (`ATTR_REGEX_CACHE`, `src/domains/ui.ts:224-232`) y grid-bucketing en el dedup (`CELL_SIZE`, `ui.ts:92-172`).
- `--json` real (`src/cli.ts:53-54`, `src/output.ts:74-77`).
- `app.start` con `resolve-activity` rápido, fallback a `monkey` (`src/domains/app.ts:74-91`).
- `import.meta.dir` en vez de `__dirname` (`src/daemon/client.ts:59`).

---

## 1. Detección y auto-recuperación del daemon local (P0)

### Contexto
Hay **dos** procesos llamados "daemon" y conviene no confundirlos:

1. **Runtime uiautomator2** (on-device, puerto 9008): el servidor Java que hace el trabajo de UI. Ya se auto-arranca.
2. **Daemon local Bun** (`src/daemon/server.ts`): proceso HTTP local que cachea `elements`/`handles` y mantiene la sesión caliente para acciones sub-15 ms.

El segundo es **invisible**: no hay dominio `daemon`, no hay `status/restart/stop/logs`, y cuando muere o queda obsoleto, el CLI hace *fallback silencioso* a RPC directo (costoso), sin que el agente se entere.

### 1.1 Evidencia real: daemon obsoleto (version skew)
En esta sesión, `ui scroll` devolvió:

```
Warning: Daemon scroll action failed, falling back to direct RPC:
Daemon action failed: Unknown daemon command: scroll
```

El daemon corriendo era una **build anterior** de `server.ts` (sin el comando `scroll`, que ya existe en `server.ts:301-334`). El cliente no distingue "daemon caído" de "daemon obsoleto": el `/ping` responde OK, pero los comandos nuevos fallan. Este es exactamente el caso que el usuario pide resolver.

### 1.2 Recomendaciones

1. **Dominio `daemon`** con `status` (ping + `/health` + PID + versión), `restart`, `stop`, `logs`. Expone el daemon al agente en vez de esconderlo.
2. **Handshake de versión/generación**: incluir `build_id` / `protocol_version` en la respuesta de `/ping` (`server.ts:54`). El cliente (`client.ts:14-50`) lo compara con su propio build y, si difiere, reinicia el daemon automáticamente. Elimina el skew de versión de raíz.
3. **PID liveness check**: además del ping, verificar `process.kill(pid, 0)` para detectar procesos muertos con config huérfana (`u2bun-daemon-<serial>.json` en `tmpdir`). Limpiar los `.json` huérfanos al arrancar el CLI.
4. **Timeout en todas las llamadas del daemon**: `DaemonClient.snapshot` / `action` (`client.ts:91`, `105`) hacen `fetch` **sin** `AbortSignal.timeout`; solo `/ping` lo tiene. Un daemon colgado (runtime atascado) bloquea al agente hasta el timeout global (30 s).
5. **Bug: `readFileSync` no importado** (`server.ts:563`). El import (`server.ts:3`) solo trae `writeFileSync, unlinkSync, existsSync`, pero el path `--stop` (`import.meta.main`) usa `readFileSync`. Crasha con `ReferenceError`. Corregir el import.
6. **Fallback selectivo**: cuando el daemon está caído, arrancarlo **una vez** (con reintento/backoff) y reintentar la acción, en vez de caer a RPC directo en cada acción siguiente y pagar el cold-connect (deviceInfo + forward + ensureU2Runtime + dump) repetidamente.

---

## 2. Contrato de postcondiciones no se cumple (P1)

Cada tool de mutación declara `expect: { schema: z.object({...}) }` (p. ej. `ui.tap` → `{ tapped: z.literal(true) }`, `ui.ts:497-499`), pero **nadie valida ese schema**:

- `cli.ts:185` solo hace `outputSchema.parse(result)`.
- `verifyPostcondition` (`registry.ts:98-108`) únicamente mira `tool.expect.element` / `tool.expect.state`, que **ningún tool define** (dead code — verificado con grep).

Consecuencia: el invariante "Enforced Postconditions" (u2ctl `AGENTS.md` §6) **no se aplica**. Un `ui.tap` que no logra su efecto retorna `ok` igual.

**Recomendación**: en `verifyPostcondition`, validar `tool.expect.schema` contra el resultado y lanzar `PostconditionFailedError` (exit 5) si no cumple.

---

## 3. Dumps y RPC redundantes (P1)

1. **`dumpHierarchy(compressed=true)`**: `u2client.ts:82` expone el parámetro pero **nadie** lo usa (`server.ts` y `ui.ts` llaman sin argumentos; verificado). uiautomator2 soporta gzip. En loops (`ui.wait` dump cada 500 ms, `ui.find` dump por scroll) el ahorro de payload es grande.
2. **Cachear `deviceInfo()`**: `scroll`/`find` llaman `deviceInfo()` en cada iteración solo para `displayWidth/Height` (`server.ts:302-303`, `444-445`). Son estáticas por dispositivo: cachear en el daemon.
3. **`computeScreenFingerprint` ordena** todos los tuples en cada llamada (`ui.ts:39`, `tuples.sort()`) — O(n log n) de strings. Solo se necesita cuando se reporta fingerprint/cambio, no en cada post-dump de tap.
4. **Orden por relevancia antes del truncado**: `ui.snapshot` corta a `limit=30` en orden de documento (`server.ts:102-104`, `ui.ts:405-406`). El elemento objetivo puede quedar fuera del corte. Ordenar antes: enfocado → clickable con texto → posición (centro primero).

---

## 4. Reducción de tokens (P2)

1. **Fingerprint en el header** del snapshot (`[App: ... | fingerprint: 16hex]`) es ruido para el LLM (ya flaggeado en `OPTIMIZATION.md` §2.2, sigue vigente). Reemplazar por `changed: yes/no` (ya soportado) o exponerlo solo con `--fingerprint`.
2. **`--json` con pretty-print**: `output.ts:75` usa `JSON.stringify(envelope, null, 2)`. Para consumidores máquina, JSON compacto (sin indent) ahorra tokens. Emitir compacto (o añadir `--json-compact`).
3. **`tools.schema --format openai`** exporta `properties: {}` vacío (`tools.ts:136-158` con `extractZodParameters` limitado). O implementar conversión zod→JSON-Schema real, o quitar el formato.
4. **`tools.show` sin parámetros/flags**: no expone `parameters` (`tools.ts:98-108`), así el agente no puede aprender flags. Emitir la lista de parámetros por tool.

---

## 5. Robustez y ergonomía (P2)

1. **Reuso de conexión HTTP**: cada `snapshot`/`action` crea un `fetch` nuevo (`client.ts:91`, `105`). Bun no reutiliza conexiones entre `fetch` separados por defecto. Usar keep-alive explícito (o `Bun.connect` persistente) para sostener el sub-15 ms.
2. **Flag `--safety` ausente**: `cli.ts` parsea `--quiet`, `--debug`, etc. pero no `--safety`. El ceiling de seguridad (G7) no se puede bajar a `read` por CLI; solo por config/env (`config.ts:63`). Exponerlo.
3. **`ui.wait` poll fijo 500 ms** (`server.ts:428`, `ui.ts:997`): poll adaptativo (corto al inicio, creciente) reduce dumps cuando la UI tarda en estabilizarse.

---

## 6. Benchmarking y pruebas de regresión

1. **Latencia warm**: `ui tap --ref @1` vía daemon < 15 ms.
2. **Recuperación de daemon**: matar el daemon local y verificar que `ui snapshot` lo relanza (o `daemon status` lo reporta) sin fallback a cold-connect.
3. **Skew de versión**: correr un daemon viejo + CLI nuevo y verificar que se detecta y auto-reinicia (reproducir el `Unknown daemon command`).
4. **Token footprint**: snapshot del feed de LinkedIn ≤ ~300 tokens; `changed: yes/no` colapsa el loop de verificación a un boolean.
5. **Postcondición**: `ui.tap` con `expect` no cumplido debe devolver `POSTCONDITION_FAILED` (exit 5), no `ok`.

---

## Resumen de prioridades

| # | Recomendación | Prioridad |
|---|---|---|
| 1 | Dominio `daemon` + version handshake + restart auto | P0 |
| 2 | Fix `readFileSync` + PID liveness + timeouts en cliente daemon | P0 |
| 3 | Validar `expect.schema` (postcondiciones reales) | P1 |
| 4 | Dump comprimido + cache `deviceInfo` + fingerprint on-demand | P1 |
| 5 | Orden por relevancia en snapshot antes del truncado | P1 |
| 6 | Token noise: fingerprint header / `--json` / openai schema / `tools.show` | P2 |
| 7 | Keep-alive HTTP + flag `--safety` + poll adaptativo | P2 |
