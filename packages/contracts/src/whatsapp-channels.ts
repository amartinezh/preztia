import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Contrato de CANALES de WhatsApp ligados a zona (ADMIN). Un `phone_number_id` atiende una zona;
// resuelve tenant+zona desde el webhook y permite scopear conversaciones/solicitudes por zona.

export const whatsappChannel = z.object({
  id: z.string().uuid(),
  phoneNumberId: z.string(),
  zoneId: z.string().uuid(),
  zonePath: z.string(),
  // Versión de la Graph API configurada (null ⇒ default del servidor).
  graphVersion: z.string().nullable(),
  // Estado de las credenciales SIN exponer el secreto (igual que `hasApiKey` del asistente).
  hasAccessToken: z.boolean(),
  hasAppSecret: z.boolean(),
  hasVerifyToken: z.boolean(),
  createdAt: z.string(),
});
export type WhatsappChannel = z.infer<typeof whatsappChannel>;

export const listChannelsOutput = z.object({ items: z.array(whatsappChannel) });

// Credenciales de Meta opcionales en la creación/edición. String vacío ⇒ limpia la credencial
// (misma semántica que `aiApiKey` en el asistente); ausente ⇒ no toca el valor existente.
const credentialFields = {
  accessToken: z.string().trim().max(512).optional(),
  appSecret: z.string().trim().max(256).optional(),
  verifyToken: z.string().trim().max(256).optional(),
  graphVersion: z.string().trim().max(16).optional(),
};

export const createChannelInput = z.object({
  phoneNumberId: z.string().trim().min(3).max(40),
  zoneId: z.string().uuid(),
  ...credentialFields,
});
export type CreateChannelInput = z.infer<typeof createChannelInput>;

// Actualización parcial de credenciales de un canal ya existente (upsert por campo presente).
export const updateChannelInput = z.object(credentialFields);
export type UpdateChannelInput = z.infer<typeof updateChannelInput>;

const tenantHeaders = z.object({ "x-tenant-id": z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });

export const whatsappChannelsContract = c.router({
  listChannels: {
    method: "GET",
    path: "/whatsapp-channels",
    headers: tenantHeaders,
    responses: { 200: listChannelsOutput },
    summary: "Canales de WhatsApp del tenant (número → zona)",
  },
  createChannel: {
    method: "POST",
    path: "/whatsapp-channels",
    headers: tenantHeaders,
    body: createChannelInput,
    responses: { 201: z.object({ id: z.string().uuid() }) },
    summary: "Vincula un número de WhatsApp a una zona (ADMIN)",
  },
  updateChannel: {
    method: "PATCH",
    path: "/whatsapp-channels/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: updateChannelInput,
    responses: { 204: z.null() },
    summary: "Actualiza las credenciales de Meta de un canal (ADMIN)",
  },
  deleteChannel: {
    method: "DELETE",
    path: "/whatsapp-channels/:id",
    pathParams: idParam,
    headers: tenantHeaders,
    body: z.object({}),
    responses: { 204: z.null() },
    summary: "Elimina el vínculo número → zona",
  },
});
