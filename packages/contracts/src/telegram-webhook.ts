import { z } from "zod";

// ─── Esquema del Update de la Bot API de Telegram (webhook) ─────────────────────────────────
// Tolerante a propósito (`passthrough`, casi todo opcional), igual que el de WhatsApp: Telegram
// agrega campos y tipos que no procesamos. Se valida lo que nos interesa y el resto se ignora.
// Los ids de Telegram caben en 52 bits (enteros seguros en JS).

const user = z.object({ id: z.number().int(), is_bot: z.boolean().optional() }).passthrough();
const chat = z.object({ id: z.number().int(), type: z.string() }).passthrough();

const photoSize = z
  .object({
    file_id: z.string(),
    width: z.number().int(),
    height: z.number().int(),
    file_size: z.number().int().optional(),
  })
  .passthrough();

const fileObject = z
  .object({
    file_id: z.string(),
    mime_type: z.string().optional(),
    file_name: z.string().optional(),
    file_size: z.number().int().optional(),
  })
  .passthrough();

const telegramMessage = z
  .object({
    message_id: z.number().int(),
    date: z.number().int(),
    chat,
    from: user.optional(),
    text: z.string().optional(),
    caption: z.string().optional(),
    photo: z.array(photoSize).optional(),
    document: fileObject.optional(),
    voice: fileObject.optional(),
    audio: fileObject.optional(),
    location: z.object({ latitude: z.number(), longitude: z.number() }).passthrough().optional(),
    contact: z
      .object({ phone_number: z.string(), user_id: z.number().int().optional() })
      .passthrough()
      .optional(),
    // Álbum: cada foto llega como un update propio con el mismo id de grupo.
    media_group_id: z.string().optional(),
  })
  .passthrough();

export const telegramUpdate = z
  .object({
    update_id: z.number().int(),
    // Solo se suscribe `message` (allowed_updates); el resto de campos se ignora.
    message: telegramMessage.optional(),
  })
  .passthrough();
export type TelegramUpdate = z.infer<typeof telegramUpdate>;
export type TelegramMessage = z.infer<typeof telegramMessage>;
