import type { MessagingChannelsSettings } from "@preztiaos/domain";

// Puertos del alta/mantenimiento de bots de Telegram por zona (ADR #40). La aplicación los define;
// la infraestructura (Bot API de Telegram, Drizzle, cifrado, entorno) los implementa.

/** Identidad del bot según Telegram (getMe). */
export interface TelegramBotIdentity {
  readonly botId: string;
  readonly username: string | null;
}

/** Estado del webhook según Telegram (getWebhookInfo). */
export interface TelegramWebhookInfo {
  /** URL registrada; cadena vacía si el bot no tiene webhook. */
  readonly url: string;
  readonly pendingUpdateCount: number;
  readonly lastErrorMessage: string | null;
  readonly lastErrorAt: Date | null;
}

export interface TelegramWebhookRegistration {
  readonly url: string;
  readonly secretToken: string;
  /** Descarta los updates encolados (solo en el primer registro: al rotar se conservan). */
  readonly dropPendingUpdates: boolean;
}

/**
 * Puerto: Bot API de Telegram para administrar el bot. Un token rechazado por Telegram se traduce
 * a `DomainError` (el ADMIN pegó un token inválido); la indisponibilidad de Telegram, a error técnico.
 */
export interface TelegramBotGateway {
  getMe(botToken: string): Promise<TelegramBotIdentity>;
  setWebhook(botToken: string, registration: TelegramWebhookRegistration): Promise<void>;
  deleteWebhook(botToken: string): Promise<void>;
  getWebhookInfo(botToken: string): Promise<TelegramWebhookInfo>;
}

/** Puerto: URL pública del webhook de un bot (depende de la configuración del despliegue). */
export interface TelegramWebhookEndpoint {
  urlFor(hookId: string): string;
}

/** Puerto: material aleatorio del webhook (id opaco de la URL y secret token del header). */
export interface TelegramWebhookSecrets {
  newHookId(): string;
  newSecretToken(): string;
}

/** Credenciales de un canal ya descifradas (solo viven en memoria del servidor). */
export interface TelegramChannelCredentials {
  readonly botId: string;
  readonly botToken: string;
  readonly hookId: string;
  readonly secretToken: string;
}

/** Puerto: persistencia de `telegram_channel` (bajo RLS; cifra/descifra los secretos). */
export interface TelegramChannelStore {
  /** Falla con NotFoundError si la zona no existe; ConflictError si el bot o la zona ya tienen canal. */
  create(input: {
    tenantId: string;
    zoneId: string;
    bot: TelegramBotIdentity;
    botToken: string;
    hookId: string;
    secretToken: string;
  }): Promise<{ id: string }>;
  findCredentials(input: {
    tenantId: string;
    id: string;
  }): Promise<TelegramChannelCredentials | null>;
  markWebhookRegistered(input: { tenantId: string; id: string }): Promise<void>;
  replaceToken(input: {
    tenantId: string;
    id: string;
    botToken: string;
    username: string | null;
  }): Promise<void>;
  /** Elimina el canal y los vínculos de chat del bot. */
  remove(input: { tenantId: string; id: string }): Promise<void>;
}

/** Puerto: proveedores de mensajería habilitados en el tenant. */
export interface MessagingChannelsReader {
  get(tenantId: string): Promise<MessagingChannelsSettings>;
}
