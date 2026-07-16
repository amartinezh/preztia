# Bitácora técnica — "Envié un WhatsApp y no llega al back"

Guía rápida de revisión para cuando un mensaje de WhatsApp **no aparece** en el sistema
(no se persiste en `conversation_message` ni se ve en la bandeja). Sigue los pasos **en orden**:
cada uno descarta una capa del camino. Marca ✅/❌ en la columna _Resultado_ a medida que avanzas.

> El back **siempre responde 200** al webhook (a propósito, para que Meta no reintente en bucle).
> Por eso un mensaje puede "perderse en silencio": el síntoma casi nunca es un 500, sino un
> mensaje **ignorado** o **no enrutado**. Los pasos 5–7 cubren esos casos silenciosos.

---

## 0. Mapa del flujo (de Meta al back)

```
[Teléfono] → [WhatsApp Cloud API (Meta)]
   │  POST  https://<host-público>/webhooks/whatsapp
   ▼
[WhatsappWebhookController.receive]            apps/api/src/conversations/whatsapp-webhook.controller.ts
   1. assertAuthentic(rawBody, x-hub-signature-256)   ← WHATSAPP_APP_SECRET
   2. whatsappWebhookEvent.safeParse(body)            ← si no matchea → warn + 200 (se descarta)
   3. toInboundMessages(event)                        ← channelId = value.metadata.phone_number_id
   ▼
[ProcessInboundMessageHandler.execute]         packages/application/src/conversations/process-inbound-message.ts
   4. conversationLog.recordInbound(msg)              ← persiste en conversation_message (best-effort)
   5. enruta por tipo (text/audio/image/document)
   ▼
[ConversationMessageLog.persist]               apps/api/src/conversations/conversation-message.log.ts
   - resolve_tenant_by_whatsapp_phone(phone_number_id)  ← si NULL, no hay tenant → no se guarda
```

**Datos clave del entorno:**
- Ruta del webhook: `POST /webhooks/whatsapp` y `GET /webhooks/whatsapp` (sin prefijo global).
- Puerto del API: `process.env.PORT ?? 3000`.
- Variables (`.env` en la raíz): `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
  `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION`.

> ⚠️ **Vigencia (2026-07-16):** las variables `WHATSAPP_*` del `.env` YA NO EXISTEN. Las
> credenciales de Meta se configuran **por zona** en la app (Zonas → WhatsApp de la zona) y viven
> cifradas en la tabla `whatsapp_channel`; la pantalla además muestra la URL exacta del webhook
> para pegar en Meta. Lo que sigue abajo es el registro histórico de cuando se usaba `.env`.

---

## 1. ¿El API está arriba y escuchando?

| Check | Comando | Esperado |
|---|---|---|
| Proceso vivo | `pnpm dev` (o el proceso del API) corriendo | logs de Nest sin crash |
| Puerto | `curl -i http://localhost:3000/webhooks/whatsapp?hub.mode=subscribe` | responde (403/200), no _connection refused_ |

Si da _connection refused_ → el API no está levantado o está en otro puerto (`PORT`). **Resultado: ___**

---

## 2. ¿Meta puede *alcanzar* tu servidor? (la causa #1 en local)

Meta llama desde Internet. `localhost:3000` **no es accesible** para Meta: necesitas un túnel público.

```bash
# Exponer el API local (ej. con cloudflared o ngrok)
cloudflared tunnel --url http://localhost:3000
#   o
ngrok http 3000
```

- La URL del túnel (`https://algo.trycloudflare.com/webhooks/whatsapp`) debe estar registrada en
  **Meta → App → WhatsApp → Configuration → Webhook (Callback URL)**.
- Si reinicias el túnel, la URL cambia → **vuelve a registrarla**.

**Verificación end-to-end del alcance:** envía un POST de prueba a la URL pública y mira si llega
a los logs del API (paso 5). **Resultado: ___**

---

## 3. ¿El webhook quedó *verificado y suscrito* en Meta?

1. **Handshake (GET):** Meta llama `GET /webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`.
   El back devuelve el `challenge` **solo si** `hub.verify_token === WHATSAPP_VERIFY_TOKEN`.

   ```bash
   curl -i "http://localhost:3000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=$WHATSAPP_VERIFY_TOKEN&hub.challenge=ping123"
   # Esperado: HTTP 200 con cuerpo "ping123"
   # 403 "Verificación de webhook fallida" → el token no coincide con WHATSAPP_VERIFY_TOKEN
   ```

2. **Suscripción al campo `messages`:** en Meta → Webhooks, confirma que el campo **`messages`**
   está suscrito. Sin esa suscripción, Meta **no envía** los mensajes entrantes (aunque la URL sea válida).

**Resultado: ___**

---

## 4. ¿La firma HMAC pasa? (descarta un 403 en el POST)

El POST se rechaza con `403 "Firma de webhook inválida"` si `x-hub-signature-256` no coincide
con el HMAC-SHA256 del **cuerpo crudo** usando `WHATSAPP_APP_SECRET`
(ver [whatsapp-signature.ts](../apps/api/src/conversations/whatsapp-signature.ts)).

- `WHATSAPP_APP_SECRET` debe ser **exactamente** el _App Secret_ de la app de Meta (no el access token).
- El back usa `rawBody: true` ([main.ts](../apps/api/src/main.ts)); si algún middleware reescribe el
  body, la firma falla. No reserializar el body antes del controller.
- **En local puedes omitir la firma:** si `WHATSAPP_APP_SECRET` **no está seteada**, el back loguea
  `WHATSAPP_APP_SECRET no configurado: se omite la verificación de firma` y acepta el POST. Útil para
  probar con `curl`, pero **no** para producción.

Prueba sin firma (con la variable vacía/ausente en dev):

```bash
curl -i -X POST http://localhost:3000/webhooks/whatsapp \
  -H "Content-Type: application/json" \
  -d '{"object":"whatsapp_business_account","entry":[{"id":"E","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"57300","phone_number_id":"<PHONE_NUMBER_ID>"},"messages":[{"from":"573001112233","id":"wamid.TEST","timestamp":"1718480000","type":"text","text":{"body":"hola"}}]}}]}]}'
# Esperado: HTTP 200 {"received":true}
```

Si responde 403 → revisa firma/secret. **Resultado: ___**

---

## 5. ¿El cuerpo coincide con el esquema? (descarte silencioso #1)

Si el JSON no valida contra `whatsappWebhookEvent`, el back **no procesa** y loguea:

```
WARN  Evento de webhook ignorado (no coincide con el esquema)
```

- Busca ese WARN en los logs del API al momento de enviar.
- Tipos **no soportados** (ubicación, sticker, reacciones, contactos) se descartan en el mapper
  ([whatsapp-message.mapper.ts](../apps/api/src/conversations/whatsapp-message.mapper.ts), `default → null`).
  Prueba con un **texto** plano para aislar.
- Los `statuses` (entregado/leído) **no** son mensajes entrantes: no se persisten como conversación.

**Resultado: ___**

---

## 6. ¿El `phone_number_id` está mapeado a una zona/tenant? (descarte silencioso #2)

El persistir resuelve el tenant con `resolve_tenant_by_whatsapp_phone(phone_number_id)`
([conversation-message.log.ts](../apps/api/src/conversations/conversation-message.log.ts) +
[unit-of-work.ts](../apps/api/src/tenancy/unit-of-work.ts)). Si el número **no está registrado**
en `whatsapp_channel`, no hay tenant → el transcript **no se guarda** (best-effort, sin romper).

```sql
-- ¿Existe el canal para ese phone_number_id?
SELECT id, phone_number_id, zone_id, zone_path, tenant_id
FROM whatsapp_channel
WHERE phone_number_id = '<PHONE_NUMBER_ID>';

-- ¿La función resuelve el tenant?
SELECT resolve_tenant_by_whatsapp_phone('<PHONE_NUMBER_ID>');   -- NULL = no mapeado
```

- Si está vacío → **vincula el número a una zona** desde la app: _Ajustes → Canales de WhatsApp_
  (o `POST` del slice de canales). Sin ese mapeo, los mensajes llegan pero se pierden.
- Verifica que el `phone_number_id` del payload de Meta sea **idéntico** al registrado (es un ID
  numérico, **no** el número de teléfono visible).

**Resultado: ___**

---

## 7. ¿Quedó registrado? (confirmación final en BD)

```sql
SELECT id, direction, kind, applicant_phone, message_id, created_at
FROM conversation_message
ORDER BY created_at DESC
LIMIT 10;
```

- Si aparece tu mensaje → el back **sí** lo recibió y persistió; el problema (si lo hay) está
  **aguas abajo** (bandeja/RLS/zona del usuario que mira, IA, o el front).
- Si **no** aparece y los pasos 5 y 6 estaban OK → busca en logs el error por-mensaje:
  ```
  ERROR  Error procesando mensaje <id> (canal <channelId>)
  ```
  (el back atrapa la excepción, loguea y responde 200 igualmente).

**Resultado: ___**

---

## 8. Llega, se procesa, pero **no responde** (asistente sin configurar)

Síntoma típico: en los logs aparece `[WhatsApp:Text] 📝 [<tel>] <texto>` pero **no** hay respuesta
saliente ni error. Causa: el caso de uso
[answer-text-message.ts](../packages/application/src/conversations/text/answer-text-message.ts)
corta en silencio en su primera guarda si el tenant **no tiene** configurado el asistente:

```ts
const config = await this.configs.findByChannelId(message.channelId);
if (!config?.aiApiKey || config.knowledgeBase.trim() === "") return; // ← sale sin responder ni error
```

Ese config sale de `tenant_config` (`knowledge_base`, `ai_provider`, `ai_api_key`). Verifica:

```sql
SELECT tc.tenant_id,
       tc.ai_provider,
       (tc.ai_api_key IS NOT NULL AND tc.ai_api_key <> '') AS tiene_api_key,
       length(tc.knowledge_base)                          AS kb_largo
FROM tenant_config tc
WHERE tc.tenant_id = resolve_tenant_by_whatsapp_phone('<PHONE_NUMBER_ID>');
```

- Si `tiene_api_key = false` o `kb_largo = 0` → **esa es la causa**.
- **Solución (recomendada):** _Ajustes → Asistente de WhatsApp_ (solo ADMIN) permite cargar la
  base de conocimiento, el proveedor y la API key. La key es un secreto: el server nunca la
  devuelve, solo indica si ya hay una configurada.
- Solución por SQL (si no usas la UI):
  ```sql
  UPDATE tenant_config
  SET ai_api_key = '<GEMINI_API_KEY>', knowledge_base = 'Interés ... Cuotas ... Requisitos ...',
      ai_provider = 'GEMINI', updated_at = now()
  WHERE tenant_id = resolve_tenant_by_whatsapp_phone('<PHONE_NUMBER_ID>');
  ```
- La API key de Gemini vive en la **BD** (`ai_api_key`), no en el `.env`; el `.env` solo aporta
  `GEMINI_MODEL` (default `gemini-2.0-flash`).
- **Idempotencia:** el mismo `wamid` no se reprocesa (`dedup.firstSeen`). Para reprobar tras
  configurar, envía un mensaje **nuevo** (los ya recibidos quedan marcados como vistos).

Otras variantes del mismo síntoma (200, sin respuesta):
- `ASSISTANT_UNAVAILABLE_REPLY` sí llega al usuario → la API key existe pero el proveedor falló
  (cuota/clave inválida); revisa logs y la cuota de Gemini.
- Tipo no soportado (audio/imagen/documento) → no usa este flujo de texto; se enruta a otro puerto.

**Resultado: ___**

---

## Tabla rápida: síntoma → causa probable → dónde mirar

| Síntoma | Causa probable | Dónde verificar |
|---|---|---|
| `connection refused` al `curl` local | API caído / puerto distinto | Paso 1 (`PORT`) |
| Meta marca el webhook como no verificado | `verify_token` ≠ `WHATSAPP_VERIFY_TOKEN` | Paso 3.1 |
| No llega nada y en local nunca llamó | URL pública no registrada / túnel caído / campo `messages` no suscrito | Pasos 2 y 3.2 |
| POST responde `403 Firma inválida` | `WHATSAPP_APP_SECRET` errado o body reserializado | Paso 4 |
| Llega POST 200 pero WARN "evento ignorado" | Body no matchea esquema o tipo no soportado | Paso 5 |
| 200 sin WARN pero no se guarda | `phone_number_id` sin canal → tenant NULL | Paso 6 |
| `📝` en logs pero no responde | `tenant_config` sin `ai_api_key`/`knowledge_base` | Paso 8 |
| Guardado en BD pero no se ve en la app | RLS / zona del usuario / front | Paso 7 + bandeja |
| `ERROR Error procesando mensaje …` | Fallo aguas abajo (IA, media, etc.) | Logs del API |

---

## Dónde mirar (resumen)

- **Logs del API:** salida de `pnpm dev` / proceso de Nest. Filtra por `Whatsapp`, `Conversations:Transcript`, `Evento de webhook ignorado`, `Error procesando mensaje`.
- **BD:** tablas `whatsapp_channel` y `conversation_message`; funciones `resolve_tenant_by_whatsapp_phone`, `resolve_zone_path_by_whatsapp_phone`.
- **Meta dashboard:** App → WhatsApp → Configuration (Callback URL, Verify token, campos suscritos) y la consola de _Webhooks_ con el log de entregas.
- **Variables:** `.env` de la raíz — `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_GRAPH_VERSION`.
