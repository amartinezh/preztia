import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato de BOTS de Telegram ligados a zona (ADMIN, ADR #40): el análogo de `whatsapp-channels`.
// Un bot atiende una zona y una zona tiene a lo sumo un bot. El ADMIN solo pega el token del bot:
// el servidor lo valida (getMe) y registra el webhook en Telegram (setWebhook) sin pasos manuales.

// Formato del token de BotFather: `<bot_id>:<secreto>`. Se valida la forma en la frontera; la
// validez real la confirma Telegram (getMe) al guardar.
const botToken = z
  .string()
  .trim()
  .regex(/^[1-9]\d{0,19}:[A-Za-z0-9_-]{30,100}$/, "Token de bot de Telegram inválido");

export const telegramChannel = z.object({
  id: z.string().uuid(),
  // `tg:<bot_id>`: el identificador del canal que aparece en la bandeja y los filtros.
  channelId: z.string(),
  botId: z.string(),
  botUsername: z.string().nullable(),
  zoneId: z.string().uuid(),
  zonePath: z.string(),
  // Estado SIN exponer secretos: el token del bot y el secret del webhook nunca salen del servidor.
  webhookRegistered: z.boolean(),
  createdAt: z.string(),
});
export type TelegramChannel = z.infer<typeof telegramChannel>;

export const listTelegramChannelsOutput = z.object({ items: z.array(telegramChannel) });

export const createTelegramChannelInput = z.object({
  zoneId: z.string().uuid(),
  botToken,
});
export type CreateTelegramChannelInput = z.infer<typeof createTelegramChannelInput>;

// Rotación del token (p. ej. tras /revoke en BotFather). Debe ser del MISMO bot: cambiar de bot
// cambiaría el `channelId` de las conversaciones existentes (se elimina el canal y se crea otro).
export const updateTelegramChannelInput = z.object({ botToken });
export type UpdateTelegramChannelInput = z.infer<typeof updateTelegramChannelInput>;

// Estado del webhook según Telegram (getWebhookInfo), tras re-registrarlo si no apuntaba al servidor.
export const telegramWebhookStatus = z.object({
  webhookRegistered: z.boolean(),
  // true si esta verificación tuvo que volver a registrar el webhook (autocorrección).
  reRegistered: z.boolean(),
  pendingUpdateCount: z.number().int(),
  lastErrorMessage: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
});
export type TelegramWebhookStatus = z.infer<typeof telegramWebhookStatus>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const errorBody = z.object({ message: z.string() });

export const telegramChannelsContract = c.router({
  listTelegramChannels: {
    method: "GET",
    path: "/telegram-channels",
    headers: tenantHeaders,
    responses: { 200: listTelegramChannelsOutput },
    summary: "Bots de Telegram del tenant (bot → zona)",
  },
  createTelegramChannel: {
    method: "POST",
    path: "/telegram-channels",
    headers: tenantHeaders,
    body: createTelegramChannelInput,
    responses: { 201: z.object({ id: z.string().uuid() }), 409: errorBody },
    summary: "Vincula un bot de Telegram a una zona y registra su webhook (ADMIN)",
  },
  updateTelegramChannel: {
    method: "PATCH",
    path: "/telegram-channels/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: updateTelegramChannelInput,
    responses: { 204: z.null(), 409: errorBody },
    summary: "Rota el token del bot y re-registra el webhook (ADMIN)",
  },
  verifyTelegramChannel: {
    method: "POST",
    path: "/telegram-channels/:id/verify",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 200: telegramWebhookStatus },
    summary: "Consulta el webhook en Telegram y lo re-registra si no apunta al servidor (ADMIN)",
  },
  deleteTelegramChannel: {
    method: "DELETE",
    path: "/telegram-channels/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 204: z.null() },
    summary: "Desvincula el bot de la zona y elimina su webhook en Telegram (ADMIN)",
  },
});
