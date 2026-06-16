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
  createdAt: z.string(),
});
export type WhatsappChannel = z.infer<typeof whatsappChannel>;

export const listChannelsOutput = z.object({ items: z.array(whatsappChannel) });

export const createChannelInput = z.object({
  phoneNumberId: z.string().trim().min(3).max(40),
  zoneId: z.string().uuid(),
});
export type CreateChannelInput = z.infer<typeof createChannelInput>;

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
