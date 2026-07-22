# Auditoría de seguridad — PreztiaOS

> Revisión exhaustiva del 2026-07-21 sobre `main` (commit `abbad9c`). Alcance: superficie HTTP
> completa (28 controllers), autenticación/autorización, aislamiento multi-tenant (RLS), webhooks
> públicos, criptografía, manejo de secretos, almacenamiento de documentos, despliegue y
> dependencias.
>
> **Este documento es la fuente única del estado de los hallazgos.** Al cerrar uno, cámbiale el
> estado aquí y enlaza el commit; al abrir uno nuevo, añádelo con el mismo formato.

## Estado general

| Severidad | Total | Corregidos | Pendientes |
|---|---|---|---|
| 🔴 Crítico | 3 | 2 | 1 |
| 🟠 Alto | 6 | 3 | 3 |
| 🟡 Medio | 6 | 0 | 6 |
| 🔵 Bajo / informativo | 6 | 0 | 6 |

Corregidos en la remediación de la semana 1 (2026-07-22): **#1, #2, #5, #7, #9**.

---

## 🔴 Críticos

### #1 · El webhook de WhatsApp fallaba abierto — ✅ CORREGIDO (2026-07-22)

**Dónde:** [whatsapp-webhook.controller.ts](../apps/api/src/conversations/whatsapp-webhook.controller.ts) · `assertAuthentic`

Cuando el canal no tenía App Secret configurado (columna nullable; la UI permite crear el canal
sin él), el controller **registraba un aviso y procesaba el evento igual**. Lo mismo si el
`phone_number_id` no se podía extraer del cuerpo o no correspondía a ningún canal.

**Impacto:** cualquiera en Internet podía `POST /webhooks/whatsapp` y suplantar el teléfono de
cualquier deudor: empujar el flujo de originación (subir documentos, aceptar ofertas de plan),
inyectar comprobantes de pago falsos en la cola de conciliación, hacer que el número verificado
del tenant **enviara mensajes a destinos arbitrarios** (phishing con la marca del tenant) y quemar
la clave Gemini del tenant.

**Corrección:** falla cerrado (403) en los tres casos. Es el criterio que ya aplicaban los webhooks
de PicPay y Mercado Pago. Cubierto por
[whatsapp-webhook.spec.ts](../apps/api/src/conversations/whatsapp-webhook.spec.ts).

> ⚠️ **Operativo:** un canal sin App Secret deja de recibir mensajes. Antes de desplegar, verifica
> que todos los canales activos lo tengan cargado en *Zonas → WhatsApp de la zona*.

### #2 · `POST /credits` sin control de rol — ✅ CORREGIDO (2026-07-22)

**Dónde:** [credit.controller.ts](../apps/api/src/credit/credit.controller.ts) · `grant`

Único endpoint del controller sin `requireRole` (ni `requireTenant`). Cualquier sesión válida del
tenant —incluido un `COLLECTOR`— podía originar deuda.

**Corrección:** `requireTenant` + `requireReviewer` (ADMIN/COORDINATOR), el mismo listón que aprobar
un expediente. Coincide con el permiso `credit:create` que el cliente ya restringía a esos dos
roles en [authorization.ts](../apps/mobile/src/core/auth/authorization.ts). De paso, `GET /credits`
recibió el `requireRole(DATA_PLANE_ROLES)` que tenían todos sus hermanos.

### #3 · Contraseñas triviales para el rol BYPASSRLS — ⏸️ APLAZADO (decisión del equipo)

**Dónde:** [docker/initdb/01-init.sql](../docker/initdb/01-init.sql) ·
[0019_iam_rls.sql](../packages/db/migrations/0019_iam_rls.sql#L29) ·
[env.prod.example](../env.prod.example#L27-L29)

```sql
CREATE ROLE platform LOGIN PASSWORD 'platform' NOSUPERUSER BYPASSRLS;
CREATE ROLE app      LOGIN PASSWORD 'app'      NOSUPERUSER NOBYPASSRLS;
```

`platform` **anula todo el aislamiento multi-tenant**. La plantilla de producción las conserva
literalmente mientras marca `CAMBIA_ESTE_SECRETO_FUERTE` en las demás.

**Atenuante:** `docker-compose.prod.yml` no publica el puerto de Postgres al host; solo se alcanza
desde la red interna de compose. La explotación exige un foothold previo en esa red (o un SSRF
desde el contenedor de la API).

**Remediación pendiente:** parametrizar el initdb (`POSTGRES_APP_PASSWORD` /
`POSTGRES_PLATFORM_PASSWORD`), rotar con `ALTER ROLE … PASSWORD` en el servidor y actualizar
`APP_DATABASE_URL` / `PLATFORM_DATABASE_URL` en `.env.prod`. Requiere ventana de reinicio de la API.

---

## 🟠 Altos

### #4 · `credit_document_requirement` sin RLS — ⏳ PENDIENTE

**Dónde:** [0006_spicy_morlocks.sql](../packages/db/migrations/0006_spicy_morlocks.sql) ·
[required-document-catalog.ts](../packages/db/src/schema/required-document-catalog.ts)

De las 45 tablas creadas por migraciones, **44 tienen `ENABLE` + `FORCE ROW LEVEL SECURITY`; esta
no**, pese a llevar `tenant_id` y seguir mapeada en el esquema Drizzle. El rol `app` lee y escribe
la configuración documental de cualquier tenant.

**Remediación:** añadir el bloque `ENABLE/FORCE/POLICY tenant_isolation` estándar en una migración
nueva (`pnpm db:generate` + edición del SQL, como el resto de migraciones de RLS). Antes de
aplicarla conviene confirmar si la tabla sigue en uso o si `required_document_catalog` la
reemplazó: si está muerta, `DROP TABLE` es mejor remediación que la política.

### #5 · Secretos en claro en el audit log append-only — ✅ CORREGIDO (2026-07-22)

**Dónde:** [sanitize.ts](../apps/api/src/observability/sanitize.ts)

`SENSITIVE` comparaba el nombre del campo por **igualdad exacta** y no incluía `appSecret`,
`verifyToken` ni `clientSecret` — campos reales de los contratos de canal de WhatsApp y de cuenta
bancaria. El `AuditInterceptor` es global, así que esos secretos quedaban en texto plano y **para
siempre** en `audit_log`, que por diseño no se edita ni se borra. Anulaba el cifrado AES-256-GCM
de `secret-cipher.ts`.

**Corrección:** coincidencia por **subcadena** (`password`, `secret`, `token`, `apikey`,
`credential`, `authorization`), que cubre las variantes futuras que nadie se acuerde de registrar.
Con pruebas de regresión para los tres campos que se filtraban.

> ⏳ **Acción pendiente en cada entorno:** ejecutar `pnpm --filter api redact:audit` una vez tras
> desplegar, para sanear los payloads **ya escritos**. Si el script reporta filas saneadas, **rota
> esas credenciales**: estuvieron expuestas en la bitácora.

### #6 · Los refresh tokens no se revocan ni se revalidan — ⏳ PENDIENTE

**Dónde:** [auth.controller.ts](../apps/api/src/auth/auth.controller.ts) · `refresh`

`refresh` solo verifica la firma y reemite el par copiando `role`, `tenantId` y `zonePaths` del
token viejo. Nunca vuelve a consultar `app_user`. Consecuencias:

- `DELETE /users/:id` (desactivar) **no tiene efecto real**: el usuario despedido renueva su sesión
  durante 30 días.
- Degradar un rol o recortar zonas no se propaga.
- Sin `jti` ni lista de revocación, un token robado solo se invalida rotando `JWT_SECRET`, lo que
  cierra la sesión de todos.

**Remediación:** releer el usuario en `refresh` (activo + rol + zonas actuales, vía la misma función
`SECURITY DEFINER` del login) y emitir con los valores frescos. La revocación por `jti` puede ir
después; releer al refrescar ya cierra el agujero operativo.

### #7 · Abono en efectivo sin rol ni alcance de cartera — ✅ CORREGIDO (2026-07-22)

**Dónde:** [payments.controller.ts](../apps/api/src/payments/payments.controller.ts)

`POST /credits/:creditId/payments` registraba un abono con solo `requireTenant`: sin rol y —más
grave— **sin verificar que el crédito estuviera en la cartera del cobrador**. Un cobrador podía
saldar el préstamo de cualquier deudor del tenant. Vector de fraude interno directo.

**Corrección:** `requireRole(DATA_PLANE_ROLES)` + `assertWithinScope`, que para el rol `COLLECTOR`
exige pertenencia a `collector_client` vía
[collector-credit-scope.reader.ts](../apps/api/src/payments/collector-credit-scope.reader.ts).
Responde 404 (no 403) para no confirmar la existencia del crédito, igual que `collectionLogFor`.
Aplicado también a `GET /credits/:id/payments` y `GET /credits/:id/portfolio`, que tenían el mismo
hueco. La cartera del cobrador en el cliente sale de esa misma tabla, así que el flujo legítimo no
cambia.

### #8 · Sin rate limiting en ningún endpoint — ⏳ PENDIENTE

**Dónde:** [main.ts](../apps/api/src/main.ts) · [apps/api/package.json](../apps/api/package.json)

No hay `@nestjs/throttler` ni límite en Caddy. `POST /auth/login` admite fuerza bruta y credential
stuffing ilimitados. Agrava: `scrypt` con parámetros por defecto (N=16384) hace cada intento barato
de forzar y **costoso de servir** (DoS por CPU).

**Remediación:** `@nestjs/throttler` (requiere autorizar la dependencia, cf. CLAUDE.md) o
`rate_limit` en el Caddyfile si se prefiere cero dependencias nuevas. Prioridad: `/auth/*`.

### #9 · Endpoints de conciliación sin control de rol — ✅ CORREGIDO (2026-07-22)

**Dónde:** [payments.controller.ts](../apps/api/src/payments/payments.controller.ts)

`POST /payments/reconcile` y `/payments/reconcile-settlement` disparaban el ciclo que **confirma
pagos y descarga reportes bancarios** con solo `requireTenant`, mientras sus vecinos exigían
`requireReviewer`.

**Corrección:** `requireRole(MANAGER_ROLES)` (ADMIN/COORDINATOR), coincidiendo con el permiso
`payment:reconcile` que el cliente ya aplicaba.

---

## 🟡 Medios (todos ⏳ pendientes)

### #10 · XSS almacenado vía SVG servido inline

[antifraud.service.ts](../apps/api/src/credit-application/antifraud.service.ts) acepta cualquier
`image/*` — incluido `image/svg+xml`, que ejecuta JavaScript al navegarse. El `mimeType` viene de
Meta y se devuelve tal cual con `Content-Disposition: inline`, **sin `X-Content-Type-Options:
nosniff` ni CSP** (el bloque `api.{$DOMAIN}` del [Caddyfile](../deploy/Caddyfile) es el único sin
cabeceras de seguridad). Afecta a `GET /applications/:id/documents/:tipo/original` y
`GET /payments/:id/receipt`; la víctima es un ADMIN/COORDINATOR abriendo el expediente.
**Remediación:** excluir SVG del formato aceptado, y servir con `nosniff` +
`Content-Disposition: attachment` o `Content-Security-Policy: sandbox`.

### #11 · `Idempotency-Key` sin alcance de ruta ni huella del payload

[idempotency.repository.ts](../apps/api/src/observability/idempotency.repository.ts) · `find`
ignora `method` y `path` aunque `save` sí los persiste. Reusar una clave entre dos endpoints
`@Idempotent()` distintos devuelve la respuesta cacheada del primero y **omite silenciosamente la
ejecución del segundo** — plausible por accidente con la cola offline del móvil. Tampoco hay huella
del cuerpo: un replay con otro monto devuelve el resultado viejo en vez de 409.

### #12 · Refresh token de 30 días en `localStorage` (web)

[token-storage.web.ts](../apps/mobile/src/core/auth/token-storage.web.ts). Con #6 (irrevocable) y
sin CSP en `app.{$DOMAIN}`, cualquier XSS se vuelve toma de cuenta de 30 días. El cliente nativo usa
`expo-secure-store` correctamente.

### #13 · Dependencias vulnerables (1 crítica, 12 altas)

`pnpm audit`. Las que afectan runtime de producción:

| Paquete | Instalado | Parche | Problema |
|---|---|---|---|
| `drizzle-orm` | 0.36.4 | ≥0.45.2 | **SQLi por identificadores mal escapados** |
| `multer` | 2.1.1 | ≥2.2.0 | DoS por campos anidados |
| `form-data` | <4.0.6 | ≥4.0.6 | Inyección CRLF |
| `body-parser` | <2.3.0 | ≥2.3.0 | El límite de tamaño se desactiva en silencio |

La SQLi de Drizzle explota identificadores dinámicos; los 4 `sql.raw()` del repo
([dashboard-query.repository.ts](../apps/api/src/dashboard/dashboard-query.repository.ts)) usan
literales fijos, así que hoy no es explotable — pero la versión debe subir igual.

### #14 · CORS refleja cualquier origen si falta `CORS_ORIGIN`

[main.ts](../apps/api/src/main.ts) — `origin: corsOrigin ? … : true`. Falla abierto ante una
variable mal desplegada. **Remediación:** exigirla cuando `NODE_ENV=production`.

### #15 · Sin `helmet` y sin cabeceras de seguridad en la API

La landing y la app web sí llevan HSTS/nosniff/frame-deny en el [Caddyfile](../deploy/Caddyfile); el
bloque `api.{$DOMAIN}` es solo `reverse_proxy`.

---

## 🔵 Bajos / informativos (todos ⏳ pendientes)

| # | Hallazgo | Dónde |
|---|---|---|
| 16 | **Replay del webhook de Mercado Pago**: el `ts` del manifiesto sale del header del atacante sin ventana de frescura. Mitigado por la deduplicación en ingesta | [mp-webhook.verifier.ts](../apps/api/src/payments/banking/mercadopago/mp-webhook.verifier.ts) |
| 17 | `POST /payments/:id/manual-verification` mueve dinero y no es `@Idempotent()` | [payments.controller.ts](../apps/api/src/payments/payments.controller.ts) |
| 18 | `scrypt` con parámetros por defecto; OWASP recomienda N=2¹⁷ mínimo | [password.ts](../apps/api/src/auth/password.ts) |
| 19 | Credenciales MinIO por defecto embebidas (`minio`/`minio12345`) | [minio-encrypted-storage.ts](../apps/api/src/shared/minio-encrypted-storage.ts) |
| 20 | `env.prod.example` omite `PLATFORM_PURGE_PASSWORD` y `SECRETS_ENCRYPTION_KEY`; declara `PORT=3000` mientras Caddy proxya a `api:3010` | [env.prod.example](../env.prod.example) |
| 21 | `tenantMiddleware` no valida que `x-tenant-id` sea UUID; su ausencia produce 500 en vez de 401 | [tenant-context.ts](../apps/api/src/tenancy/tenant-context.ts) |

---

## Lo que la auditoría confirmó como sólido

Vale la pena registrarlo: acota el riesgo real de lo anterior y evita "arreglar" lo que ya está bien.

- **JWT sin *alg confusion***: `verifyToken` recalcula HMAC-SHA256 ignorando el header del token y
  compara con `timingSafeEqual` ([jwt.ts](../apps/api/src/auth/jwt.ts)).
- **RLS con `FORCE` en 44/45 tablas**, rol de datos `NOBYPASSRLS`, y funciones `SECURITY DEFINER`
  acotadas para las consultas previas al contexto de tenant (login, resolución de canal).
- **Comparaciones en tiempo constante** consistentes en JWT, contraseñas, firmas de webhook y
  contraseña de purga.
- **Jerarquía de roles en el dominio**: `canCreateRole` + `assertZonesWithinActorScope` impiden que
  un COORDINATOR escale a ADMIN ([users.ts](../packages/application/src/iam/users.ts)).
- **Alcance por zona/cartera** correctamente aplicado en cobranza y bitácoras
  ([zone-scope.ts](../apps/api/src/iam/zone-scope.ts),
  [collections.controller.ts](../apps/api/src/collections/collections.controller.ts)).
- **Secretos nunca devueltos** por el API (`hasApiKey`/`hasAppSecret` booleanos) y cifrado
  AES-256-GCM en reposo para credenciales y documentos KYC.
- **Webhooks de PicPay y Mercado Pago fallan cerrado** (401 sin secreto configurado).
- **Doble portón en la purga** de tenant: `SuperAdminGuard` + contraseña de entorno que falla
  cerrado.

---

## Orden de remediación sugerido para lo pendiente

1. **#4** RLS de la tabla huérfana (o `DROP` si está muerta) — migración pequeña, riesgo alto.
2. **#3** rotar las contraseñas de Postgres — requiere ventana de reinicio.
3. **#6** revalidar el usuario en `refresh` — cierra la desactivación de usuarios.
4. **#8** rate limiting en `/auth/*`.
5. **#13** subir dependencias.
6. **#10–#12, #14–#15** endurecimiento de cabeceras, SVG e idempotencia.
7. **#16–#21** cuando toque el área correspondiente.
