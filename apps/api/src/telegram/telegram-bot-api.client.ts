import { Injectable } from '@nestjs/common';
import { DomainError } from '@preztiaos/domain';
import type {
  TelegramBotGateway,
  TelegramBotIdentity,
  TelegramWebhookInfo,
  TelegramWebhookRegistration,
} from '@preztiaos/application';
import { fetchWithRetry } from '../shared/fetch-retry';

// Tope de espera por llamada a la Bot API (incluye los reintentos de fetchWithRetry).
const REQUEST_TIMEOUT_MS = 15_000;
// Solo se piden mensajes nuevos: ni ediciones, ni canales, ni encuestas (ADR #40).
const ALLOWED_UPDATES = ['message'] as const;
// Conexiones simultáneas que Telegram abre contra el webhook de un bot (default 40): acota la
// carga por bot sobre la API.
const WEBHOOK_MAX_CONNECTIONS = 10;
// Respuestas de la Bot API ante un token inválido (401) o mal formado (404).
const INVALID_TOKEN_CODES = new Set([401, 404]);
const MS_PER_SECOND = 1000;

/** Error técnico de la Bot API. NUNCA lleva la URL (contiene el token) ni la causa original. */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number | null,
    description: string,
  ) {
    super(
      `Telegram ${method} falló (${errorCode ?? 'sin respuesta'}): ${description}`,
    );
    this.name = 'TelegramApiError';
  }
}

/** Botón de un teclado de respuesta; `request_contact` comparte el número del propio usuario. */
export interface TelegramKeyboardButton {
  readonly text: string;
  readonly request_contact?: boolean;
}

/** Teclado nativo bajo el campo de texto, o la orden de retirarlo. */
export type TelegramReplyMarkup =
  | {
      readonly keyboard: readonly (readonly TelegramKeyboardButton[])[];
      readonly one_time_keyboard?: boolean;
      readonly resize_keyboard?: boolean;
      readonly input_field_placeholder?: string;
    }
  | { readonly remove_keyboard: true };

export interface TelegramOutgoingMessage {
  readonly chatId: string;
  readonly text: string;
  readonly replyMarkup?: TelegramReplyMarkup;
}

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

interface GetMeResult {
  id: number;
  username?: string;
}

interface WebhookInfoResult {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

/**
 * Adaptador del puerto `TelegramBotGateway` sobre la Bot API (HTTPS + JSON). El token del bot va en
 * la RUTA de la URL (`/bot<token>/<método>`) por diseño de Telegram: por eso este cliente jamás
 * registra ni propaga la URL, y re-lanza los fallos de red sin su causa (podría contenerla).
 */
@Injectable()
export class TelegramBotApiClient implements TelegramBotGateway {
  async getMe(botToken: string): Promise<TelegramBotIdentity> {
    const me = await this.call<GetMeResult>(botToken, 'getMe');
    return { botId: String(me.id), username: me.username ?? null };
  }

  async setWebhook(
    botToken: string,
    registration: TelegramWebhookRegistration,
  ): Promise<void> {
    await this.call<boolean>(botToken, 'setWebhook', {
      url: registration.url,
      secret_token: registration.secretToken,
      drop_pending_updates: registration.dropPendingUpdates,
      allowed_updates: ALLOWED_UPDATES,
      max_connections: WEBHOOK_MAX_CONNECTIONS,
    });
  }

  async deleteWebhook(botToken: string): Promise<void> {
    await this.call<boolean>(botToken, 'deleteWebhook', {
      drop_pending_updates: false,
    });
  }

  /** Envía un mensaje de texto a un chat (texto plano; teclado opcional). */
  async sendMessage(
    botToken: string,
    message: TelegramOutgoingMessage,
  ): Promise<void> {
    await this.call<unknown>(botToken, 'sendMessage', {
      chat_id: message.chatId,
      text: message.text,
      ...(message.replyMarkup ? { reply_markup: message.replyMarkup } : {}),
    });
  }

  async getWebhookInfo(botToken: string): Promise<TelegramWebhookInfo> {
    const info = await this.call<WebhookInfoResult>(botToken, 'getWebhookInfo');
    return {
      url: info.url,
      pendingUpdateCount: info.pending_update_count,
      lastErrorMessage: info.last_error_message ?? null,
      lastErrorAt: info.last_error_date
        ? new Date(info.last_error_date * MS_PER_SECOND)
        : null,
    };
  }

  private async call<T>(
    botToken: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const body = await this.post<T>(botToken, method, params);
    if (body.ok && body.result !== undefined) return body.result;

    const code = body.error_code ?? null;
    if (code !== null && INVALID_TOKEN_CODES.has(code)) {
      throw new DomainError(
        'Telegram rechazó el token del bot: revísalo en BotFather',
        'TELEGRAM_INVALID_TOKEN',
      );
    }
    throw new TelegramApiError(
      method,
      code,
      body.description ?? 'error desconocido',
    );
  }

  private async post<T>(
    botToken: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<BotApiResponse<T>> {
    let res: Response;
    try {
      res = await fetchWithRetry(`${baseUrl()}/bot${botToken}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Sin la causa: los errores de red de fetch pueden incluir la URL (y con ella el token).
      throw new TelegramApiError(method, null, 'Telegram no respondió');
    }
    try {
      return (await res.json()) as BotApiResponse<T>;
    } catch {
      throw new TelegramApiError(method, res.status, 'respuesta no JSON');
    }
  }
}

function baseUrl(): string {
  return process.env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org';
}
