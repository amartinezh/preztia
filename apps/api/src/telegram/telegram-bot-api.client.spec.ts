// Sin reintentos ni esperas en las pruebas: se ejerce el cliente, no el backoff.
jest.mock('../shared/fetch-retry', () => ({
  fetchWithRetry: (url: string, init: RequestInit) => fetch(url, init),
}));

import { DomainError } from '@preztiaos/domain';
import {
  TelegramApiError,
  TelegramBotApiClient,
} from './telegram-bot-api.client';

const TOKEN = '7012345678:AAHsecretoDelBotQueNuncaDebeFiltrarse';
const client = new TelegramBotApiClient();
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock;
});

function telegramReplies(body: unknown, status = 200): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

async function errorOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('se esperaba un fallo');
}

describe('TelegramBotApiClient', () => {
  it('traduce getMe a la identidad del bot (bot_id como texto)', async () => {
    telegramReplies({
      ok: true,
      result: { id: 7012345678, username: 'norte_bot' },
    });

    await expect(client.getMe(TOKEN)).resolves.toEqual({
      botId: '7012345678',
      username: 'norte_bot',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    expect(init.method).toBe('POST');
  });

  it('registra el webhook solo para mensajes, con secret y límite de conexiones', async () => {
    telegramReplies({ ok: true, result: true });

    await client.setWebhook(TOKEN, {
      url: 'https://api.preztia.co/webhooks/telegram/hook',
      secretToken: 'secreto',
      dropPendingUpdates: true,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      url: 'https://api.preztia.co/webhooks/telegram/hook',
      secret_token: 'secreto',
      drop_pending_updates: true,
      allowed_updates: ['message'],
      max_connections: 10,
    });
  });

  it('mapea getWebhookInfo, incluida la fecha del último error', async () => {
    telegramReplies({
      ok: true,
      result: {
        url: 'https://x/hook',
        pending_update_count: 3,
        last_error_date: 1_700_000_000,
        last_error_message: 'Wrong response from the webhook: 403 Forbidden',
      },
    });

    await expect(client.getWebhookInfo(TOKEN)).resolves.toEqual({
      url: 'https://x/hook',
      pendingUpdateCount: 3,
      lastErrorMessage: 'Wrong response from the webhook: 403 Forbidden',
      lastErrorAt: new Date(1_700_000_000_000),
    });
  });

  it.each([401, 404])(
    'convierte el rechazo del token (%i) en un error de dominio accionable',
    async (code) => {
      telegramReplies(
        { ok: false, error_code: code, description: 'Unauthorized' },
        code,
      );

      const error = await errorOf(client.getMe(TOKEN));

      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('TELEGRAM_INVALID_TOKEN');
    },
  );

  it('reporta otros fallos de la API sin filtrar el token', async () => {
    telegramReplies(
      {
        ok: false,
        error_code: 400,
        description: 'Bad Request: bad webhook: HTTPS url must be provided',
      },
      400,
    );

    const error = await errorOf(
      client.setWebhook(TOKEN, {
        url: 'http://inseguro',
        secretToken: 's',
        dropPendingUpdates: false,
      }),
    );

    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error.message).toContain('HTTPS url must be provided');
    expect(error.message).not.toContain(TOKEN);
  });

  it('ante un fallo de red no propaga la causa (que puede contener la URL con el token)', async () => {
    fetchMock.mockRejectedValue(
      new TypeError(`fetch failed: https://api.telegram.org/bot${TOKEN}/getMe`),
    );

    const error = await errorOf(client.getMe(TOKEN));

    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error.message).not.toContain(TOKEN);
    expect(error.cause).toBeUndefined();
    expect(error.stack ?? '').not.toContain(TOKEN);
  });

  it('espera lo que Telegram pide ante un 429 y reintenta', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: false,
            error_code: 429,
            description: 'Too Many Requests: retry after 0',
            parameters: { retry_after: 0 },
          }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, result: {} })),
      );

    await client.sendMessage(TOKEN, {
      chatId: '1',
      text: 'hola',
      parseMode: 'HTML',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      chat_id: '1',
      text: 'hola',
      parse_mode: 'HTML',
    });
  });

  it('no espera una penalización larga: la reporta con su retry_after', async () => {
    telegramReplies(
      {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests',
        parameters: { retry_after: 600 },
      },
      429,
    );

    const error = await errorOf(
      client.sendMessage(TOKEN, { chatId: '1', text: 'hola' }),
    );

    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).retryAfterSeconds).toBe(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('obtiene la ruta del archivo y lo descarga sin exceder el límite', async () => {
    telegramReplies({
      ok: true,
      result: { file_path: 'photos/f.jpg', file_size: 3 },
    });
    await expect(client.getFile(TOKEN, 'file-1')).resolves.toEqual({
      filePath: 'photos/f.jpg',
      fileSize: 3,
    });

    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    await expect(
      client.downloadFile(TOKEN, 'photos/f.jpg', 10),
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
    const [url] = fetchMock.mock.calls.at(-1) as [string];
    expect(url).toBe(`https://api.telegram.org/file/bot${TOKEN}/photos/f.jpg`);
  });

  it('corta la descarga que excede el límite, sin filtrar el token', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(11)));

    const error = await errorOf(
      client.downloadFile(TOKEN, 'documents/x.pdf', 10),
    );

    expect(error).toBeInstanceOf(TelegramApiError);
    expect(error.message).not.toContain(TOKEN);
  });
});
