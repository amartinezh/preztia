# Plan — Canal Telegram (driver adicional a WhatsApp, por zona)

> **Estado:** Fases 0–5 ✅ código listo; migraciones 0055 (generada) y 0056 (RLS + funciones, a mano) escritas y validadas, SIN aplicar · Fase 6 pendiente. **ADR propuesto:** #40.
> **Alcance:** que un tenant pueda operar con **WhatsApp, Telegram o ambos**, configurados desde
> Ajustes (habilitación por tenant) y en el panel de Zonas (un bot por zona, igual que un número de
> WhatsApp por zona), con **paridad funcional completa**: originación (monto → documentos KYC →
> ubicación), asistente IA, negociación de plan, cobro conversacional PIX, consulta de saldo,
> comprobantes de pago, recordatorios de cobranza (cron y manual), notificaciones proactivas,
> bandeja/consola de comunicaciones, bitácora de fallos y depuración.
>
> Fuentes: [ARCHITECTURE.md](ARCHITECTURE.md) (cómo), [DESIGN.md](DESIGN.md) (qué),
> [SECURITY_AUDIT.md](SECURITY_AUDIT.md) (hallazgo #1: webhook de WhatsApp fallaba abierto).

---

## 1. Resumen ejecutivo

El sistema ya es **casi agnóstico del proveedor** en dominio y aplicación: el mensaje entrante es
la unión discriminada `InboundMessage` y todos los casos de uso hablan con puertos
(`OutboundTextSender`, `MediaDownloader`, `TenantResolver`…). El acoplamiento a WhatsApp vive en
**infraestructura** y en **dos supuestos implícitos** que Telegram rompe:

1. **`channelId` = `phone_number_id` de Meta.** Viaja por todos los agregados
   (`credit_application`, `payment`, `payment_charge`, `borrower_contact`, `conversation_message`,
   `conversation_failure`) y ~12 adaptadores lo resuelven con `resolveTenantByWhatsappPhone`.
2. **El remitente se identifica por su teléfono.** `from` es E.164 y es la llave de negocio de
   todo: una solicitud activa por `(tenant, applicant_phone)`, `borrower.phone`,
   `borrower_contact`, antifraude por DDD, bandeja agrupada por teléfono, cobranza a `b.phone`.
   **Telegram no entrega el teléfono**: entrega un `user.id`/`chat.id` numérico.

**Decisión central:** Telegram se integra como **otro driver detrás de los mismos puertos**, sin
tocar dominio ni casos de uso, gracias a dos piezas:

- **Identidad = teléfono verificado.** Un chat de Telegram no entra al flujo hasta que el usuario
  comparte **su propio** contacto con el botón nativo `request_contact` (se verifica
  `contact.user_id === from.id`). A partir de ahí el adaptador traduce `chat_id ⇄ teléfono` y el
  resto del sistema sigue viendo teléfonos. Resultado: una persona que escribe por WhatsApp y por
  Telegram **es la misma persona** (misma solicitud, mismo deudor, mismo crédito).
- **`channelId` con espacio de nombres.** WhatsApp conserva el `phone_number_id` sin prefijo
  (compatibilidad total con los datos existentes); Telegram usa `tg:<bot_id>`. Un **router por
  prefijo** elige el driver en envío, descarga de media y resolución de tenant/zona.

Esfuerzo estimado: **6 fases**, ~3–4 semanas de una persona, con WhatsApp funcionando sin cambios
de comportamiento en cada fase.

---

## 2. Inventario del acoplamiento actual (lo que hay que tocar)

| Área | Punto de acoplamiento | Archivo(s) |
|---|---|---|
| Entrada | Webhook Meta (handshake GET, firma HMAC, normalización) | [whatsapp-webhook.controller.ts](../apps/api/src/conversations/whatsapp-webhook.controller.ts), [whatsapp-message.mapper.ts](../apps/api/src/conversations/whatsapp-message.mapper.ts), [whatsapp-webhook.ts](../packages/contracts/src/whatsapp-webhook.ts) |
| Salida | `WhatsappTextSender` inyectado **por clase concreta** (no por token) en 3 módulos y **instanciado con `new`** en 2 notificadores | [conversations.module.ts](../apps/api/src/conversations/conversations.module.ts), [payments.module.ts](../apps/api/src/payments/payments.module.ts), [collections.module.ts](../apps/api/src/collections/collections.module.ts), [plan-offer.notifier.ts](../apps/api/src/credit-application/review/plan-offer.notifier.ts), [credit-registered.notifier.ts](../apps/api/src/credit-application/review/credit-registered.notifier.ts) |
| Media | `WhatsappMediaDownloader` (Graph API en 2 pasos) | [whatsapp-media.downloader.ts](../apps/api/src/credit-application/whatsapp-media.downloader.ts) |
| Tenant/zona | `resolveTenantByWhatsappPhone` / `resolveZonePathByWhatsappPhone` llamados **directamente** en 10 adaptadores | tenant-resolver, conversation-message.log, conversation-failure.log, tenant-config.repository, borrower-account.reader, amount-capture.repository, plan-reply.repository, payment-charge.repository, chargeable-credit.reader |
| Zona por JOIN | `JOIN whatsapp_channel` para zona/teléfono de soporte | [credit-application.repository.ts:106](../apps/api/src/credit-application/credit-application.repository.ts#L106), [applicant-journey.repository.ts:43](../apps/api/src/conversations/applicant-journey.repository.ts#L43), [due-credits.repository.ts:151](../apps/api/src/collections/due-credits.repository.ts#L151) |
| SQL | Funciones `SECURITY DEFINER` sobre `whatsapp_channel` | migraciones `0027`, `0049` |
| Formato | Marcado WhatsApp (`*negrita*`) y textos "por WhatsApp" / "clip 📎 → Ubicación" | [submit-application-document.ts:47](../packages/application/src/credit/application/submit-application-document.ts#L47), [assistant-instructions.ts:11](../apps/api/src/conversations/ai/assistant-instructions.ts#L11), [approve-application-review.ts:163](../packages/application/src/credit/review/approve-application-review.ts#L163) |
| Config | Canales por zona (solo WhatsApp), pestaña "WhatsApp / IA" | [whatsapp-channels.ts](../packages/contracts/src/whatsapp-channels.ts), [zone-whatsapp-editor.tsx](../apps/mobile/src/features/zones/screens/zone-whatsapp-editor.tsx), [settings.config.ts](../apps/mobile/src/features/settings/settings.config.ts) |
| Operación | Purga de tenant, script de redacción, `deploy/scripts/logs.sh` | [tenant-data-purge.repository.ts](../apps/api/src/platform/tenant-data-purge.repository.ts), `deploy/` |

**Lo que NO hay que tocar** (ya es agnóstico): `InboundMessage` y todos los handlers de
`packages/application` (originación, KYC multi-archivo, plan, cobro PIX, saldo, comprobantes,
ubicación, recordatorios), el pipeline antifraude, el read model de la bandeja (agrupa por
teléfono) y la idempotencia por `processed_inbound_message`.

---

## 3. WhatsApp vs. Telegram: diferencias que condicionan el diseño

| Aspecto | WhatsApp Cloud API | Telegram Bot API | Consecuencia en el diseño |
|---|---|---|---|
| Identidad del remitente | Teléfono E.164 | `user.id` / `chat.id` (int64) | **Gate de contacto verificado** (§4 D1) |
| Identificador del canal en el evento | `metadata.phone_number_id` en el cuerpo | **Ninguno**: el update no dice a qué bot llegó | **Un URL de webhook por bot** con id opaco (§4 D5) |
| Autenticidad | Firma HMAC `x-hub-signature-256` con App Secret | Header `X-Telegram-Bot-Api-Secret-Token` (fijado en `setWebhook`) | Comparación en tiempo constante contra hash; **falla cerrado** |
| Alta del webhook | Manual en Meta (URL + verify token) | Programática: `setWebhook` | El backend registra el webhook al guardar el token (sin pasos manuales) |
| Credencial | Access token + App Secret + verify token | **Un** bot token | Formulario de zona más simple |
| Id de mensaje | `wamid` global único | `message_id` único **por chat**; `update_id` único por bot | Clave de idempotencia `tg:<bot>:<chat>:<message_id>` |
| Media | 2 pasos Graph API con Bearer | `getFile` → `/file/bot<token>/<path>`; **máx. 20 MB** | El token va en la URL: **nunca** registrar URLs ni errores crudos de `fetch` |
| Fotos | Imagen con `mime_type` | Arreglo `photo[]` de tamaños, JPEG comprimido, sin mime | Tomar el tamaño mayor; recomendar "enviar como archivo" para KYC nítido |
| Iniciativa | Negocio puede escribir solo dentro de 24 h o con plantilla | Bot solo escribe a quien **ya lo inició** (`/start`); sin ventana de 24 h | Cobranza por Telegram solo a deudores vinculados; **ventaja**: sin plantillas |
| Bloqueo | — | 403 "bot was blocked by the user" | Marcar el vínculo como bloqueado y dejar de intentar |
| Límites | Tier por número | ~30 msg/s por bot, ~1 msg/s por chat, 429 con `retry_after` | Throttle + reintento con `retry_after` en envíos masivos |
| Formato | `*negrita*` `_cursiva_` `~tachado~` | Texto plano o `parse_mode` HTML/MarkdownV2 (escapado estricto) | Traductor WhatsApp-markup → HTML escapado (§4 D7) |
| Ubicación | Clip → Ubicación | Clip → Ubicación, o botón `request_location` | Paridad; mejora opcional con botón |
| Chats | 1:1 | Privados, grupos, canales | **Solo `chat.type === "private"`**; lo demás se ignora |
| Álbumes | Mensajes separados | Varios updates con `media_group_id` | Cada foto es un mensaje; encaja con KYC multi-archivo (ADR #38) |

---

## 4. Decisiones de arquitectura (ADR #40)

### D1 · La identidad es el teléfono verificado (gate de contacto)

- Un chat privado nuevo recibe `/start` (o cualquier mensaje) → el bot responde con un teclado de
  respuesta de **un solo botón** `📱 Compartir mi número` (`request_contact: true`,
  `one_time_keyboard: true`) y **no** enruta nada al flujo de negocio.
- Al llegar `message.contact`: se exige `contact.user_id === from.id` (evita que alguien reenvíe
  el contacto de un tercero y **suplante su crédito**). Si no coincide → se rechaza con un mensaje
  y se registra en la bitácora de fallos.
- Se normaliza `phone_number` a E.164 sin `+` (mismo formato que `applicant_phone`) y se hace
  **upsert** en `telegram_chat_link (tenant, bot, chat_id) → phone` con `verified_at`.
- Desde ese momento, el adaptador de entrada emite `InboundMessage` con `from = phone` y el
  sistema completo funciona igual que con WhatsApp.
- **Cambio de número / re-vínculo:** compartir de nuevo el contacto actualiza el teléfono del chat
  (queda en `audit_log`). Si otro chat ya tenía ese teléfono en el mismo bot, gana el último
  contacto **verificado** (el anterior queda desvinculado, auditado).
- **Por qué no usar `tg:<user_id>` como identidad:** rompería la unicidad de la solicitud activa
  por persona, el cruce con `borrower.phone`, la cobranza, el antifraude por DDD
  (`BrasilApiDddLookup`) y la bandeja. Pedir el contacto es un paso de 1 toque y da un teléfono
  **verificado por Telegram** (tan confiable como el de WhatsApp).

### D2 · `channelId` con espacio de nombres por proveedor

- WhatsApp: `phone_number_id` **sin prefijo** (cero migración de datos).
- Telegram: `tg:<bot_id>` (el `bot_id` es la parte numérica del token, estable y único global).
- Evita colisiones (ambos son numéricos) y cabe en los contratos actuales (`channelId` max 40).
- Función pura en dominio: `channelProviderOf(channelId): "WHATSAPP" | "TELEGRAM"` +
  `telegramChannelId(botId)`; con pruebas de borde (vacío, `tg:` sin id, id no numérico).

### D3 · Tablas propias `telegram_channel` + `telegram_chat_link` (no generalizar `whatsapp_channel`)

Se evaluó unificar en `messaging_channel(provider, …)`. Se descarta **por ahora**:
credenciales heterogéneas (1 token vs. 3 secretos + versión Graph), funciones `SECURITY DEFINER`,
contrato, pantalla y datos productivos ya asentados sobre `whatsapp_channel`, y la regla de
**modificaciones quirúrgicas**. La vista unificada se obtiene sin migrar datos con una **VIEW
`messaging_channel`** (`security_invoker = true`, PG16 ⇒ respeta RLS) que expone
`(tenant_id, channel_id, provider, zone_id, zone_path)` para los JOIN de zona/cobranza.

### D4 · Enrutamiento por prefijo detrás de los puertos existentes

| Puerto | Hoy | Nuevo |
|---|---|---|
| `OutboundTextSender` | `WhatsappTextSender` | `ChannelRoutingTextSender` → `WhatsappTextSender` \| `TelegramTextSender` |
| `MediaDownloader` | `WhatsappMediaDownloader` | `ChannelRoutingMediaDownloader` → WhatsApp \| `TelegramMediaDownloader` |
| `TenantResolver` | `WhatsappTenantResolver` | `ChannelTenantResolver` (SQL agnóstico, D6) |

- El router es un **token de DI** (`OUTBOUND_TEXT_SENDER` ya existe). Se corrige la deuda de
  inyectar `WhatsappTextSender` por clase en Payments/Collections y de instanciarlo con `new` en
  los notificadores: todos pasan a inyectar el puerto. (Es el cambio mínimo imprescindible, no un
  refactor cosmético: sin él esos flujos **nunca** saldrían por Telegram.)
- `LoggingTextSender` sigue decorando el router ⇒ el transcript registra ambos canales igual.
- `TelegramTextSender` resuelve `(tenant, bot, phone) → chat_id` en `telegram_chat_link`; si no hay
  vínculo o está bloqueado lanza `RecipientUnreachableError` (error explícito, no silencio).

### D5 · Webhook por bot, URL opaca, registro automático

- Ruta: `POST /webhooks/telegram/:hookId`, con `hookId` = 32 bytes aleatorios base64url generados
  al crear el canal (no es el token ni el `bot_id`; no filtra nada en logs de Caddy).
- Autenticidad: header `X-Telegram-Bot-Api-Secret-Token`, generado por el servidor
  (`randomBytes`), guardado **cifrado** (se necesita en claro para `setWebhook` al rotar) y
  comparado con `timingSafeEqual`. **Falla cerrado (403)** si: `hookId` desconocido, canal sin
  token/secreto, header ausente o distinto, o proveedor Telegram deshabilitado en el tenant.
- Al guardar/rotar el token, el backend: `getMe` (valida token → `bot_id`, `username`) →
  `setWebhook(url, secret_token, allowed_updates=["message"], drop_pending_updates=true,
  max_connections=10)` → persiste. Al borrar el canal: `deleteWebhook`. Botón "Verificar" que
  llama `getWebhookInfo` y muestra `pending_update_count` / `last_error_message`.
- URL pública base: nueva variable **`PUBLIC_API_URL`** (p. ej. `https://api.preztia.co`); sin
  ella el alta del canal falla con error explícito.
- Tras autenticar: **siempre 200** aunque el procesamiento falle (igual que WhatsApp: evita el
  bucle de reentregas); el fallo va a `conversation_failure`.

### D6 · Resolución de tenant/zona agnóstica del canal

- Nuevas funciones `SECURITY DEFINER` (migración escrita a mano, patrón de `0027`/`0049`):
  `resolve_tenant_by_channel(text)`, `resolve_zone_path_by_channel(text)` (ramifican por prefijo
  `tg:` a `telegram_channel`, si no a `whatsapp_channel` + fallback `tenant_config`) y
  `resolve_telegram_hook(text)` → `(tenant_id, channel_id)` para el webhook. Solo `GRANT` a `app`.
- En `unit-of-work.ts`: `resolveTenantByChannel` / `resolveZonePathByChannel`. Los 10 call sites
  cambian el import (renombre mecánico); `resolveTenantByWhatsappPhone` queda como alias
  deprecado una fase y luego se elimina.
- Los 3 JOIN directos a `whatsapp_channel` pasan a la VIEW `messaging_channel`.

### D7 · Formato de texto por canal

Los casos de uso siguen redactando en el marcado ligero de WhatsApp (`*negrita*`, `_cursiva_`).
`TelegramTextSender` lo traduce con una **función pura** `whatsappMarkupToTelegramHtml(text)`:
escapa `& < >` y convierte los pares de marcadores a `<b>`, `<i>`, `<s>`, `<code>`, enviando con
`parse_mode: "HTML"`. Si Telegram responde 400 por entidades inválidas, reintenta **una vez** en
texto plano (degradación elegante). Textos dependientes del canal ("por WhatsApp") pasan a
redacción neutra ("por este chat") o a una constante por proveedor.

### D8 · Canal preferido para mensajes proactivos

Las respuestas a un mensaje salen **por el canal por el que llegó** (ya ocurre: los handlers usan
`message.channelId`). Los **proactivos** (recordatorio de cobro, oferta de plan, crédito
registrado, aviso de conciliación) usan hoy el `channel_id` guardado. Nuevo puerto de
infraestructura `ReachableChannelResolver.forPhone(tenant, phone, zoneId)`:

1. Último canal con mensaje **entrante** del teléfono (transcript) si sigue activo y habilitado.
2. Si no, canal de la zona según prioridad del tenant (`preferredProactiveChannel`).
3. Telegram solo es elegible si hay `telegram_chat_link` verificado y no bloqueado.
4. Si ninguno es alcanzable → objetivo **omitido** (no error), contado en el resultado del cron.

Motivo: por Telegram no hay ventana de 24 h ni plantillas, así que para cobranza suele ser el
canal más barato y fiable cuando el deudor está vinculado.

### D9 · Habilitación por tenant

`tenant_config.messaging_channels` (jsonb, con default):
`{ whatsappEnabled: true, telegramEnabled: false, preferredProactiveChannel: "WHATSAPP" }`.
Invariante (validado en contrato y dominio): **al menos uno habilitado**; el preferido debe estar
habilitado. Deshabilitar un proveedor **no borra** sus canales: el webhook responde 200 y descarta
(registrando `CHANNEL_DISABLED` en logs), y los salientes lo excluyen.

---

## 5. Modelo de datos

> Tablas y columnas: **solo en los esquemas Drizzle** y luego `pnpm db:generate`. RLS, `GRANT`,
> funciones `SECURITY DEFINER` y la VIEW: migración manual (drizzle-kit no los representa), con
> snapshot encadenado según la nota de migraciones RLS.

### 5.1 `telegram_channel` (nuevo, `packages/db/src/schema/telegram-channel.ts`)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid not null | RLS FORCE |
| `bot_id` | text not null | **único global** (un bot pertenece a un solo tenant) |
| `channel_id` | text not null | `tg:<bot_id>`, único; es lo que viaja en los agregados |
| `bot_username` | text | de `getMe`, para mostrar `t.me/<username>` |
| `zone_id` / `zone_path` | uuid / ltree not null | **único por zona** (un bot por zona) |
| `bot_token` | text | **cifrado** AES-256-GCM (`enc:v1:`) |
| `webhook_hook_id` | text not null | id opaco de la URL, único |
| `webhook_secret` | text | **cifrado** |
| `webhook_registered_at` | timestamptz | null ⇒ webhook no registrado |
| `created_at` | timestamptz | |

### 5.2 `telegram_chat_link` (nuevo)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | |
| `tenant_id` | uuid not null | RLS FORCE |
| `channel_id` | text not null | `tg:<bot_id>` |
| `chat_id` | text not null | int64 como texto (evita pérdida de precisión en JS) |
| `phone` | text | E.164 sin `+`; null hasta compartir el contacto |
| `verified_at` | timestamptz | momento del contacto verificado |
| `blocked_at` | timestamptz | 403 del bot; se limpia si el usuario vuelve a escribir |
| `created_at` / `updated_at` | timestamptz | |

Índices: único `(channel_id, chat_id)`; único parcial `(channel_id, phone) WHERE phone IS NOT NULL`;
índice `(tenant_id, phone)` para el resolver de canal preferido. No lleva el nombre/username del
usuario de Telegram (**minimización de PII**).

### 5.3 Cambios en tablas existentes

- `tenant_config.messaging_channels` jsonb (D9).
- `conversation_failure_stage`: nuevo valor `CONTACT_VERIFICATION` (contacto ajeno o inválido).
- Sin cambios en `credit_application`, `payment`, `payment_charge`, `borrower_contact`,
  `conversation_message`: `channel_id` ya es texto libre y el remitente sigue siendo el teléfono.

### 5.4 Migración manual (RLS + funciones + VIEW)

- `ENABLE/FORCE ROW LEVEL SECURITY` + política `tenant_isolation` en ambas tablas nuevas; `GRANT`
  a `app` y `platform`.
- `resolve_tenant_by_channel`, `resolve_zone_path_by_channel`, `resolve_telegram_hook` (§4 D6).
- VIEW `messaging_channel` con `security_invoker = true`.
- Purga de tenant: añadir `telegram_chat_link` y `telegram_channel` a
  [tenant-data-purge.repository.ts](../apps/api/src/platform/tenant-data-purge.repository.ts).

---

## 6. Contratos (`@preztiaos/contracts`)

- **`telegram-channels.ts`** (ADMIN): `listTelegramChannels`, `createTelegramChannel { zoneId,
  botToken }`, `updateTelegramChannel { botToken? }` (rota token + re-registra webhook),
  `deleteTelegramChannel`, `verifyTelegramChannel` → `{ webhookUrlOk, pendingUpdates,
  lastErrorMessage, lastErrorAt }`. Salida sin secretos: `hasBotToken`, `botUsername`,
  `webhookRegistered`, `linkedChats` (conteo).
- **`telegram-webhook.ts`**: zod tolerante del `Update` (`update_id`, `message` con `chat`,
  `from`, `text`, `photo[]`, `document`, `voice`, `audio`, `location`, `contact`, `caption`,
  `media_group_id`), `.passthrough()` como el de WhatsApp.
- **`tenant-config.ts`**: `messagingChannels` en lectura/escritura con el invariante "≥ 1
  habilitado" como `refine`.
- **`conversations-inbox.ts`**: `channelProvider: "WHATSAPP" | "TELEGRAM"` en el resumen y filtro
  opcional `provider`. (El filtro `channelId` actual ya acepta `tg:…`.)
- **`collections.ts`**: el resultado del envío manual informa `channel` usado y motivo de omisión
  (`NO_REACHABLE_CHANNEL`).

---

## 7. Backend (`apps/api`)

### 7.1 Estructura nueva (`apps/api/src/telegram/`)

```
telegram/
  telegram.module.ts
  telegram-channel.controller.ts        # CRUD ADMIN + verify (JwtGuard, requireTenant + requireRole ADMIN)
  telegram-channel.repository.ts        # cifra token/secreto; nunca los devuelve
  telegram-webhook.controller.ts        # POST /webhooks/telegram/:hookId (público, falla cerrado)
  telegram-update.mapper.ts             # Update → TelegramInbound (puro, testeado)
  telegram-contact-gate.ts              # D1: vínculo chat⇄teléfono (orquesta; reglas puras en dominio)
  telegram-chat-link.repository.ts
  telegram-bot-api.client.ts            # getMe, setWebhook, deleteWebhook, getWebhookInfo, sendMessage, getFile, descarga
  telegram-text-sender.ts               # OutboundTextSender (phone → chat_id, HTML, 403/429)
  telegram-media.downloader.ts          # MediaDownloader (getFile + descarga, 20 MB, sha256)
  telegram-markup.ts                    # whatsappMarkupToTelegramHtml (puro)
messaging/
  channel-routing.text-sender.ts        # router por prefijo
  channel-routing.media-downloader.ts
  channel-tenant.resolver.ts
  reachable-channel.resolver.ts         # D8
```

### 7.2 Flujo de entrada (Telegram)

```
POST /webhooks/telegram/:hookId
 ├─ resolve_telegram_hook(hookId) ─► null ⇒ 403
 ├─ tenant.messagingChannels.telegramEnabled? no ⇒ 200 + descarte
 ├─ timingSafeEqual(header, secret) ─► no ⇒ 403
 ├─ zod Update ─► no parsea ⇒ 200 + warn
 ├─ chat.type !== "private" ⇒ 200 + descarte
 ├─ ¿contact? ─► ContactGate.verify(from.id, contact) ⇒ vincula + saludo + (si es 1ª vez) arranque del asistente
 ├─ ¿/start o sin vínculo verificado? ⇒ pedir contacto (teclado request_contact) ⇒ 200
 └─ mapear a InboundMessage { id: "tg:<bot>:<chat>:<msg>", from: phone, channelId: "tg:<bot>", … }
      └─ ProcessInboundMessageHandler.execute(...)   ← MISMO handler que WhatsApp
           (try/catch por mensaje → ConversationFailureLog; siempre 200)
```

Mapeo de tipos: `text` → text; `photo[]` (mayor tamaño, `image/jpeg`) → image (+caption);
`document` → document (`mime_type`, `file_name`); `voice` → audio(voice=true); `audio` → audio;
`location` → location; `edited_message`, `sticker`, `video`, `poll` → ignorados (no se piden en
`allowed_updates` salvo `message`). `MediaRef.mediaId` = `file_id`.

### 7.3 Salida

- `TelegramTextSender.sendText({channelId:"tg:…", recipient: phone}, body)`:
  resuelve tenant → `chat_id` (vínculo verificado, no bloqueado) → `sendMessage` HTML.
  - 403 ⇒ `blocked_at = now()`, `RecipientUnreachableError`.
  - 429 ⇒ espera `retry_after` y reintenta (máx. 3, backoff).
  - Timeout (`AbortSignal.timeout`) y errores **sin la URL** (el token va en ella).
  - Mensajes > 4096 caracteres se parten por párrafos.
- Envíos masivos (cron de cobranza): throttle por bot (≤ 25 msg/s) en el `ChannelRoutingTextSender`
  o, preferible, encolados en Redis (cola ya prevista en arquitectura) si el volumen lo exige.

### 7.4 Cambios en código existente (quirúrgicos)

| Archivo | Cambio |
|---|---|
| `conversations.module.ts` | `OUTBOUND_TEXT_SENDER` = `LoggingTextSender(ChannelRoutingTextSender)`; `MEDIA_DOWNLOADER` = router; `TENANT_RESOLVER` = `ChannelTenantResolver` |
| `payments.module.ts`, `collections.module.ts` | Inyectar el puerto (router) en lugar de `WhatsappTextSender` |
| `plan-offer.notifier.ts`, `credit-registered.notifier.ts` | Recibir `OutboundTextSender` por constructor (no `new`) + canal vía `ReachableChannelResolver` |
| 10 adaptadores con `resolveTenantByWhatsappPhone` | Import a `resolveTenantByChannel` / `resolveZonePathByChannel` |
| `credit-application.repository.ts`, `applicant-journey.repository.ts` | JOIN a la VIEW `messaging_channel` |
| `due-credits.repository.ts` | Canal por `ReachableChannelResolver` (y corrige la duplicación latente si una zona tuviera 2 números) |
| `conversation-failure.log.ts` | Etapa `CONTACT_VERIFICATION` |
| `conversations-inbox-query.repository.ts` | Derivar `channelProvider` del prefijo; filtro `provider` |
| `assistant-instructions.ts`, `submit-application-document.ts`, `approve-application-review.ts` | Redacción neutral de canal |
| `tenant-config.*` | `messagingChannels` (lectura/escritura + auditoría) |
| `deploy/scripts/logs.sh`, `Caddyfile` | Sección de diagnóstico `/webhooks/telegram/*` |

### 7.5 Cobranza y proactivos

- Cron y envío manual: objetivo = crédito activo; canal = `ReachableChannelResolver`. Si el deudor
  nunca vinculó Telegram y el tenant solo tiene Telegram ⇒ `NO_REACHABLE_CHANNEL` (visible en la
  pantalla de Cartera y en el resultado del cron). La idempotencia diaria no cambia.
- Opcional (Fase 6): botón **"Invitar por Telegram"** en la ficha del deudor que genera un deep
  link `t.me/<bot>?start=<token firmado, 1 uso, TTL>`; al entrar, el gate sigue pidiendo el
  contacto (el token solo pre-selecciona la zona/deudor, **no** sustituye la verificación).

---

## 8. Frontend (`apps/mobile`, web + nativo)

1. **Ajustes → pestaña "Canales / IA"** (renombra "WhatsApp / IA"): tarjeta *Canales de
   mensajería* con dos `Switch` (WhatsApp, Telegram), selector *canal preferido para cobranza* y
   validación "al menos uno". Solo ADMIN (misma RBAC de la pestaña actual).
2. **Zonas → "Canales de la zona"**: el modal actual pasa a tener secciones por proveedor
   habilitado. Telegram: campo *Bot token* (secreto, con la UX "vacío conserva"), estado
   (`@username`, webhook registrado ✓/✗, chats vinculados), acciones *Verificar*, *Rotar token*,
   *Desvincular*, y guía corta de BotFather (`/newbot`, `/setprivacy`, `/setjoingroups` → Disable).
   No hay URL ni verify token que copiar (el backend registra el webhook).
3. **Bandeja**: ícono de canal por conversación (componente `ChannelLogo` junto al
   `whatsapp-logo.tsx` existente), filtro por proveedor, e hilo único por teléfono mezclando ambos
   canales con la marca del canal en cada burbuja.
4. **Cartera/Cobranza**: el botón "recordatorio por WhatsApp" pasa a "Enviar recordatorio" con el
   ícono del canal que se usará; muestra "sin canal alcanzable" cuando aplique.
5. **i18n**: claves nuevas `channels.*`, `telegram.*`; revisar textos "WhatsApp" en revisión de
   solicitudes y planes que en realidad significan "el chat del cliente".

---

## 9. Seguridad (atributo crítico)

| Amenaza | Control |
|---|---|
| Webhook falsificado (suplantar deudor, inyectar comprobantes) | Secret token por bot + `timingSafeEqual`; `hookId` opaco; **falla cerrado** en todos los casos no probables (lección del hallazgo #1) |
| Suplantación por contacto reenviado | `contact.user_id === from.id` obligatorio; si no, rechazo + `CONTACT_VERIFICATION` |
| Filtración del bot token | Cifrado en reposo; nunca en respuestas API, logs ni `audit_log` (el saneador ya enmascara `*token*`); errores de `fetch` re-lanzados **sin URL**; `hookId` ≠ token |
| Bot añadido a grupos | Solo chats privados; recomendar `/setjoingroups Disable` |
| Replay / reentregas | Dedup `tg:<bot>:<chat>:<msg>` en `processed_inbound_message` (+ dinero ya idempotente) |
| Cruce entre tenants | RLS FORCE en tablas nuevas; funciones `SECURITY DEFINER` que solo devuelven ids; `bot_id` único global |
| AuthZ de configuración | `requireTenant` + `requireRole(ADMIN)` en todo endpoint de canal y en `messagingChannels` |
| PII | No guardar nombre/username de Telegram; teléfonos enmascarados en bandeja y logs como hoy |
| Defensa en profundidad (opcional) | Allowlist de IPs de Telegram (`149.154.160.0/20`, `91.108.4.0/22`) en Caddy para `/webhooks/telegram/*` |

Actualizar [SECURITY_AUDIT.md](SECURITY_AUDIT.md) con los controles del canal Telegram.

## 10. Confiabilidad y observabilidad

- Timeouts en toda llamada a `api.telegram.org`; reintentos con backoff solo en 429/5xx.
- Logs estructurados con `tenantId`, `correlationId`, `channelId` y tipo — sin teléfono completo
  ni cuerpo del mensaje.
- `audit_log`: alta/rotación/baja de canal, cambio de `messagingChannels`, vínculo/re-vínculo de
  chat (sin el teléfono completo en el payload).
- Métricas por canal en la estadística de la bandeja (ya agrupa; se añade el proveedor).
- `drop_pending_updates` solo al registrar por primera vez; en rotación se conserva la cola.

---

## 11. Estrategia de pruebas (spec → dominio → implementación)

**Gherkin (resumen):**

```gherkin
Escenario: Un chat nuevo debe compartir su número antes de ser atendido
  Dado un bot de Telegram activo en la zona "Norte"
  Cuando un usuario sin vínculo escribe "quiero un crédito"
  Entonces el bot le pide compartir su número con el botón de contacto
  Y no se crea ninguna solicitud ni mensaje en el transcript

Escenario: Contacto de un tercero es rechazado
  Cuando el usuario comparte un contacto cuyo user_id difiere del remitente
  Entonces no se vincula ningún teléfono
  Y se registra un fallo CONTACT_VERIFICATION

Escenario: Misma persona por dos canales
  Dado un solicitante con solicitud activa iniciada por WhatsApp
  Cuando escribe por Telegram con el mismo teléfono verificado
  Entonces continúa la MISMA solicitud (no se crea otra)
  Y la respuesta sale por Telegram

Escenario: Webhook sin secreto válido
  Cuando llega un POST a /webhooks/telegram/:hookId con header inválido
  Entonces responde 403 y no procesa nada

Escenario: Recordatorio a deudor que bloqueó el bot
  Dado un deudor vinculado por Telegram que bloqueó el bot
  Cuando corre el cron de cobranza
  Entonces el vínculo queda marcado como bloqueado
  Y se usa WhatsApp si está habilitado, o se omite con NO_REACHABLE_CHANNEL
```

**Unitarias (puras):** `channelProviderOf`/`telegramChannelId`; `telegram-update.mapper` (cada
tipo, foto de mayor tamaño, chat no privado, `media_group_id`); `whatsappMarkupToTelegramHtml`
(escapado, marcadores anidados/sin cerrar, emojis); normalización de teléfono de contacto;
invariante de `messagingChannels`; `ReachableChannelResolver` (tabla de decisión).

**Integración (Nest + PG real):** webhook 403 en los 4 casos de fallo cerrado; flujo completo
contacto → monto → documentos → ubicación → revisión con `fetch` de Telegram simulado; RLS de las
tablas nuevas (tenant A no ve el vínculo de B); funciones `SECURITY DEFINER`; router de envío y
descarga por prefijo; regresión: **toda la suite actual de WhatsApp sigue verde**.

**CI:** typecheck + lint + test + build.

---

## 12. Plan por fases

| Fase | Entregable | Criterio de aceptación |
|---|---|---|
| **0 · Base agnóstica** ✅ | `channelProviderOf` (dominio); `resolveTenantByChannel`/`resolveZonePathByChannel` y `findChannelZone` con despacho por prefijo en TS; routers `ChannelRouting{TextSender,MediaDownloader}` en `MessagingModule` (solo WhatsApp detrás); `ChannelTenantResolver`; inyección por puerto en Payments/Collections/notificadores | Cero cambio de comportamiento; suite WhatsApp verde |
| **1 · Datos + config** | Funciones SQL `*_by_channel` + VIEW `messaging_channel` (movidas desde Fase 0: sin `telegram_channel` no aportaban nada y obligaban a reescribir la migración); esquemas `telegram_channel`, `telegram_chat_link`, `messaging_channels` → `pnpm db:generate` + migración RLS manual; contratos; CRUD ADMIN + `getMe`/`setWebhook`/`deleteWebhook`/verify; `PUBLIC_API_URL` | Alta de bot por zona registra el webhook; secretos nunca expuestos; RLS probado |
| **2 · Entrada + gate** | Webhook con fallo cerrado; mapper; gate de contacto; dedup | Chat nuevo → pide contacto; contacto ajeno rechazado; mensajes enrutados al handler común |
| **3 · Salida + media** | `TelegramTextSender` (HTML, 403/429, partición), `TelegramMediaDownloader` | Flujo completo de originación y KYC por Telegram; comprobantes de pago procesados |
| **4 · Proactivos + cobranza** | `ReachableChannelResolver`; cron/manual, oferta de plan, crédito registrado, avisos de conciliación | Recordatorios por el canal correcto; `NO_REACHABLE_CHANNEL` visible; idempotencia intacta |
| **5 · Frontend** | Pestaña Canales/IA, editor de zona por proveedor, bandeja con canal, cartera | ADMIN configura uno o ambos canales sin tocar el servidor |
| **6 · Endurecimiento** | Allowlist IPs, throttle/cola, `logs.sh`, deep link de invitación, docs (ARCHITECTURE ADR #40, DESIGN, SECURITY_AUDIT, DEPLOYMENT runbook BotFather) | Checklist de CLAUDE.md completo |

---

### Bitácora de la Fase 5 (frontend) y migraciones

- Migraciones: **0055** (generada: tablas, índices, `messaging_channels`, etapa `CONTACT_VERIFICATION`) y **0056_telegram_rls** a mano, en archivo numerado propio: RLS `ENABLE` + `FORCE` + `tenant_isolation` en las dos tablas, `GRANT` a `app`/`platform` y las funciones `resolve_tenant_by_telegram_channel`, `resolve_zone_path_by_telegram_channel` y `resolve_telegram_hook` (SECURITY DEFINER, `REVOKE PUBLIC`). El snapshot 0056 está encadenado (`prevId` = 0055); `drizzle-kit check` y `generate` (sin cambios) pasan. Se validaron de la 0052 a la 0056 en PostgreSQL real dentro de una transacción revertida: `relrowsecurity`/`relforcerowsecurity` activos, funciones operativas y el rol `app` sin ver filas de otro tenant. **Después de `db:migrate`, verificar con `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname LIKE 'telegram_%'`.**
- Ajustes → pestaña **Canales / IA** (el id RBAC `whatsapp` se conserva): `MessagingChannelsCard` con los interruptores de WhatsApp y Telegram y el canal preferido (solo ofrece los habilitados y reacomoda el preferido al apagar uno).
- Zonas → acción **Canales**: el modal agrupa el teléfono de atención, WhatsApp (sin cambios; se oculta si está deshabilitado) y la sección de Telegram ([zone-telegram-section.tsx](../apps/mobile/src/features/zones/screens/zone-telegram-section.tsx)): alta con el token (guía de BotFather), `@username` y enlace `t.me`, estado del webhook, **Verificar** (autocorrección, cola, último error), rotación del token y desvinculación con confirmación.
- Bandeja: el canal aparece en cada fila y en cada burbuja del hilo (`channelId` en `inboxMessage`); títulos neutrales ("Comunicaciones").
- Cobranza: el panel dice por qué canal saldrá el recordatorio y deshabilita el envío si no hay canal alcanzable. El botón del listado toma la identidad del tenant: verde WhatsApp, azul Telegram, o neutro con avión de papel si opera ambos.
- Errores accionables para `TELEGRAM_INVALID_TOKEN`, `TELEGRAM_DISABLED`, `TELEGRAM_BOT_MISMATCH`, `PUBLIC_API_URL_MISSING` (el 503 ahora trae código), `MESSAGING_CHANNEL_REQUIRED`, `PREFERRED_CHANNEL_DISABLED` y `NO_REACHABLE_CHANNEL`.
- Textos neutralizados donde aplican a ambos canales (oferta de plan, asistente, revisión, bandeja).
- Verificado: typecheck, lint y test en todo el monorepo; `expo export --platform web` compila e incluye las pantallas nuevas. **No se probó visualmente** en navegador ni en un dispositivo.

### Bitácora de la Fase 4 (código listo; depende de la migración de la Fase 1)

- Dominio: `chooseProactiveChannel` ([proactive-channel.ts](../packages/domain/src/conversations/proactive-channel.ts)). Orden: último canal por el que el cliente escribió → canal guardado en el agregado → canales de la zona con el proveedor preferido primero → número heredado del tenant. Solo cuentan los canales alcanzables de proveedores habilitados. Telegram es alcanzable solo con vínculo verificado y sin bloqueo.
- Cobranza: el read model trae los candidatos en UN SQL por lote (`LATERAL` al último mensaje entrante, sin N+1). Se retira el `JOIN whatsapp_channel`, que duplicaba créditos si la zona tenía dos números. Un objetivo sin canal alcanzable se omite con el motivo `NO_REACHABLE_CHANNEL` ANTES de reservar la idempotencia del día (así no bloquea un reintento como `ALREADY_SENT_TODAY`). El envío manual ya no reporta ese caso como "sin crédito activo". El panel informa `reachableChannel` y el resultado del envío, el `channel` usado.
- Avisos (oferta de plan, crédito registrado, pago confirmado): `ProactiveTextSender` resuelve el canal alcanzable con `ReachableChannelResolver` (mismo SQL de alcanzabilidad, `channelReachableSql`) y va por fuera del decorador de transcript, así el transcript registra el canal real. Sin canal: `NoReachableChannelError` (409 `NO_REACHABLE_CHANNEL`).
- **Riesgo previo corregido:** el aviso "tu pago fue confirmado" se enviaba después de abonar la cartera y, si fallaba, abortaba el resto del lote de conciliación. Ahora es de mejor esfuerzo (`BestEffortTextSender`, con registro en el log).
- Notificadores renombrados: `PlanOfferMessagingNotifier`, `CreditRegisteredMessagingNotifier`.
- **Cambio de comportamiento para los tenants que solo usan WhatsApp:** el recordatorio sale por el último número al que el cliente escribió (si sigue vinculado), en lugar de siempre por el número de la zona. En la operación normal es el mismo número.
- Validado contra PostgreSQL real (transacción revertida, rol `app` + RLS, código compilado): los 7 escenarios dan el canal esperado.
- Fuera de alcance (anterior a esta fase): los mensajes de oferta de plan y de crédito registrado no quedan en el transcript. Ya era así antes de Telegram.

### Bitácora de la Fase 3 (código listo; depende de la migración de la Fase 1)

- `TelegramTextSender`: teléfono → chat vinculado; `NOT_LINKED` / `BLOCKED` / `NO_BOT` como `TelegramRecipientUnreachableError` explícito, así que el mensaje NO se registra en el transcript como enviado. Un 403 marca `blocked_at`. Si Telegram no puede interpretar el HTML, se reenvía una vez en texto plano. Los textos de más de 4000 caracteres se parten por párrafo, línea o espacio.
- `whatsappMarkupToTelegramHtml`: `*b*` `_i_` `~s~` `` `code` `` ` ```pre``` ` → HTML escapado. Solo convierte en límites de palabra (respeta `pix_key`, `2*3*4` y los correos) y no interpreta nada dentro del código.
- `TelegramMediaDownloader`: `getFile` + descarga con tope de 20 MB (declarado y real). Si el documento no trae mime, se deduce por la extensión.
- Cliente de la Bot API: ante un 429 espera el `retry_after` (hasta 30 s, 2 reintentos); una penalización más larga se reporta con `retryAfterSeconds`.
- `MessagingModule` registra ambos drivers; el contenedor real resuelve `drivers = { WHATSAPP, TELEGRAM }`. Instrucciones del asistente redactadas sin nombrar un canal concreto.
- Queda para la Fase 6 (R2): sugerir "enviar como archivo" en la solicitud de documentos KYC cuando el canal es Telegram, porque las fotos llegan recomprimidas.

### Bitácora de la Fase 2 (código listo; depende de la migración de la Fase 1)

- Dominio: [telegram-contact.ts](../packages/domain/src/conversations/telegram-contact.ts) — `verifiedPhoneOf` (contacto PROPIO: `contact.user_id === from.id`; un contacto sin `user_id` también se rechaza; normaliza a E.164 sin `+`) y `telegramInboundMessageId` (`tg:<bot>:<chat>:<message_id>`).
- Aplicación: `IdentifyTelegramSenderHandler` ([telegram-inbound/](../packages/application/src/conversations/telegram-inbound/)) — chat sin teléfono ⇒ pide el contacto y NO enruta; contacto propio ⇒ vincula (el último verificado gana) y confirma; mensaje de chat identificado ⇒ `InboundMessage` común con `from = teléfono`.
- Infra: `POST /webhooks/telegram/:hookId` (forma del id validada antes de la BD, secret comparado por SHA-256 + `timingSafeEqual`, 403 en todo caso no autenticado; tras autenticar, siempre 200); `toTelegramInbound` (solo chats privados, no bots; foto de mayor resolución); `TelegramChatLinkRepository`; `TelegramContactPrompterAdapter` (teclado `request_contact`). Los mensajes de verificación NO van al transcript (sin teléfono al que atribuirlos).
- Fallos: un fallo técnico al vincular un contacto propio se registra con la etapa `CONTACT_VERIFICATION`; un contacto ajeno o inválido no es un fallo nuestro y no se atribuye.
- Resuelto de paso: la purga de datos del tenant no borraba `conversation_failure` ni `credit_application_document_file`; esta última tiene una FK a `credit_application`, así que la purga fallaba entera para cualquier tenant con archivos KYC. Nueva guardia `tenant-data-purge.spec.ts`: toda tabla con `tenant_id` debe estar purgada o conservada explícitamente, en orden FK-seguro.

### Bitácora de la Fase 1 (código listo; falta `db:generate` + migración RLS)

Ajustes respecto al diseño original, decididos al implementar:

- **Sin VIEW `messaging_channel`.** `findChannelZone` (Fase 0) ya despacha por proveedor dentro de
  la transacción del tenant y cubre los JOIN de zona; la cobranza (Fase 4) usará el
  `ReachableChannelResolver`. Una vista más solo añadía superficie en la BD.
- **Funciones `SECURITY DEFINER` específicas de Telegram** (`resolve_tenant_by_telegram_channel`,
  `resolve_zone_path_by_telegram_channel`, `resolve_telegram_hook`) en lugar de reescribir las de
  WhatsApp: el despacho por prefijo ya vive en `unit-of-work.ts` y las funciones de WhatsApp en
  producción quedan intactas.
- **Alta/rotación/verificación/baja como casos de uso** en `packages/application/src/conversations/telegram-channel/`
  (puertos `TelegramBotGateway`, `TelegramChannelStore`, `TelegramWebhookEndpoint`,
  `TelegramWebhookSecrets`, `MessagingChannelsReader`). El alta persiste ANTES de `setWebhook`
  y se compensa (borra) si Telegram falla; la rotación re-registra ANTES de persistir.
- Vincular un bot exige Telegram habilitado en el tenant (409 `TELEGRAM_DISABLED`). Token
  rechazado por Telegram → 400 `TELEGRAM_INVALID_TOKEN`; sin `PUBLIC_API_URL` HTTPS → 503.
- `telegram_channel` se conserva en la purga de datos del tenant (configuración, como
  `whatsapp_channel`); `telegram_chat_link` se purga (PII transaccional).
- La etapa `CONTACT_VERIFICATION` ya existe en BD, contrato e i18n (la usa la Fase 2).

### Bitácora de la Fase 0 (hecha)

- Dominio: [messaging-channel.ts](../packages/domain/src/conversations/messaging-channel.ts) (`channelProviderOf`, `telegramChannelId`, `telegramBotIdOf`) + 14 pruebas.
- Infra: [apps/api/src/messaging/](../apps/api/src/messaging/) — `driverFor` (falla explícita si un proveedor no tiene driver), routers, `MessagingModule` (único que registra los drivers de WhatsApp), `findChannelZone`.
- `unit-of-work.ts`: `resolveTenantByChannel` / `resolveZonePathByChannel`; los 9 adaptadores migrados. Telegram se resuelve como "no mapeado" (`null`) hasta la Fase 1.
- `WhatsappTenantResolver` → `ChannelTenantResolver`; `LoggingTextSender` decora cualquier `OutboundTextSender`.
- Pendiente para la Fase 4: `due-credits.repository.ts` sigue con su JOIN a `whatsapp_channel`, y los notificadores conservan su nombre `*WhatsappNotifier` (se renombran junto al `ReachableChannelResolver`).
- Verificado: typecheck, lint, test (api 116, domain 41 archivos, application 14) y build en verde; el `AppModule` arranca con el cableado nuevo.

## 13. Operación y despliegue

1. `PUBLIC_API_URL=https://api.preztia.co` en `.env` de producción (y en `env.prod.example`).
2. Caddy ya sirve `api.` por HTTPS en 443 (puerto admitido por Telegram); añadir el log de
   `/webhooks/telegram/*` al diagnóstico.
3. Runbook por zona: BotFather `/newbot` → copiar token → *Zonas → Canales → Telegram → Guardar*
   → *Verificar* (debe mostrar webhook OK, 0 errores) → probar con `/start` desde un teléfono.
4. `pnpm db:generate` tras los esquemas; aplicar la migración manual de RLS; `pnpm build` antes de
   la API; `pnpm db:migrate`.

## 14. Riesgos y preguntas abiertas

| # | Tema | Propuesta |
|---|---|---|
| R1 | Fricción del paso "compartir número" | Es 1 toque y se pide una sola vez; medir abandono en la estadística de la bandeja |
| R2 | Fotos comprimidas de Telegram para KYC | Pedir "enviar como archivo" en el texto de solicitud de documentos cuando el canal es Telegram; Gemini tolera JPEG comprimido |
| R3 | Deudores antiguos sin vínculo de Telegram | Cobranza cae a WhatsApp si está habilitado; deep link de invitación (Fase 6) |
| R4 | Tenant solo-Telegram y teléfonos no brasileños para antifraude DDD | Igual que hoy con WhatsApp; el teléfono es verificado |
| Q1 | ¿Botones inline para menús (planes, montos, "¿quieres pagar?")? | Fuera del alcance de paridad; mejora posterior con `callback_query` detrás de un puerto opcional de prompts interactivos |
| Q2 | ¿Un bot por zona o un bot por tenant con deep link por zona? | Se sigue el modelo pedido (**uno por zona**); el esquema admite el otro sin migración |
| Q3 | Notas de voz | Mismo estado que WhatsApp (el dispatcher de audio es aún un TODO); llegan normalizadas igual |
