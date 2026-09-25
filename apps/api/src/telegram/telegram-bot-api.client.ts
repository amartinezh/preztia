import { Injectable } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
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
// Límite de envío (429): Telegram indica cuánto esperar (`retry_after`). Se espera y reintenta
// solo si la espera es corta; una espera larga se reporta (el llamador decide, p. ej. el cron).
const RATE_LIMIT_MAX_RETRIES = 2;
const RATE_LIMIT_MAX_WAIT_SECONDS = 30;
const RATE_LIMITED = 429;

/** Error técnico de la Bot API. NUNCA lleva la URL (contiene el token) ni la causa original. */
export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly errorCode: number | null,
    description: string,
    /** Segundos que Telegram pide esperar ante un 429; null en cualquier otro fallo. */
    readonly retryAfterSeconds: number | null = null,
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
  /** `HTML` para el texto ya traducido por `whatsappMarkupToTelegramHtml`; ausente = plano. */
  readonly parseMode?: 'HTML';
  readonly replyMarkup?: TelegramReplyMarkup;
}

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

interface GetFileResult {
  file_path?: string;
  file_size?: number;
}

/** Archivo alojado en Telegram listo para descargar (la ruta caduca en ~1 h). */
export interface TelegramFileLocation {
  readonly filePath: string;
  readonly fileSize: number | null;
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

  /** Envía un mensaje de texto a un chat (plano o HTML; teclado opcional). */
  async sendMessage(
    botToken: string,
    message: TelegramOutgoingMessage,
  ): Promise<void> {
    await this.call<unknown>(botToken, 'sendMessage', {
      chat_id: message.chatId,
      text: message.text,
      ...(message.parseMode ? { parse_mode: message.parseMode } : {}),
      ...(message.replyMarkup ? { reply_markup: message.replyMarkup } : {}),
    });
  }

  /** Ruta de descarga de un archivo recibido (paso 1 de 2). */
  async getFile(
    botToken: string,
    fileId: string,
  ): Promise<TelegramFileLocation> {
    const file = await this.call<GetFileResult>(botToken, 'getFile', {
      file_id: fileId,
    });
    if (!file.file_path) {
      throw new TelegramApiError(
        'getFile',
        null,
        'Telegram no devolvió la ruta del archivo',
      );
    }
    return { filePath: file.file_path, fileSize: file.file_size ?? null };
  }

  /**
   * Descarga el binario de un archivo (paso 2 de 2). Corta si excede `maxBytes`: la Bot API no
   * entrega archivos de más de 20 MB y un binario mayor no se deja cargar en memoria.
   */
  async downloadFile(
    botToken: string,
    filePath: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    let res: Response;
    try {
      res = await fetchWithRetry(
        `${baseUrl()}/file/bot${botToken}/${filePath}`,
        {
          method: 'GET',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new TelegramApiError('downloadFile', null, 'Telegram no respondió');
    }
    if (!res.ok)
      throw new TelegramApiError(
        'downloadFile',
        res.status,
        'descarga rechazada',
      );
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw tooLarge();
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw tooLarge();
    return bytes;
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
    for (let retry = 0; ; retry++) {
      const body = await this.post<T>(botToken, method, params);
      if (body.ok && body.result !== undefined) return body.result;
      const waitSeconds = body.parameters?.retry_after ?? null;
      const canWait =
        body.error_code === RATE_LIMITED &&
        waitSeconds !== null &&
        waitSeconds <= RATE_LIMIT_MAX_WAIT_SECONDS &&
        retry < RATE_LIMIT_MAX_RETRIES;
      if (!canWait) throw failureOf(method, body);
      await sleep(waitSeconds * MS_PER_SECOND);
    }
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

/** Error que corresponde a una respuesta fallida de la Bot API. */
function failureOf(method: string, body: BotApiResponse<unknown>): Error {
  const code = body.error_code ?? null;
  if (code !== null && INVALID_TOKEN_CODES.has(code)) {
    return new DomainError(
      'Telegram rechazó el token del bot: revísalo en BotFather',
      'TELEGRAM_INVALID_TOKEN',
    );
  }
  return new TelegramApiError(
    method,
    code,
    body.description ?? 'error desconocido',
    body.parameters?.retry_after ?? null,
  );
}

function tooLarge(): TelegramApiError {
  return new TelegramApiError(
    'downloadFile',
    null,
    'el archivo excede el tamaño permitido',
  );
}

function baseUrl(): string {
  return process.env.TELEGRAM_API_BASE_URL ?? 'https://api.telegram.org';
}
