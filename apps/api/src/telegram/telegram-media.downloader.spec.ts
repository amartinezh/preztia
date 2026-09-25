jest.mock('../tenancy/unit-of-work', () => ({
  resolveTelegramBotToken: jest.fn(),
}));

import { createHash } from 'node:crypto';
import { resolveTelegramBotToken } from '../tenancy/unit-of-work';
import {
  TelegramApiError,
  type TelegramBotApiClient,
} from './telegram-bot-api.client';
import {
  TELEGRAM_MAX_DOWNLOAD_BYTES,
  TelegramMediaDownloader,
} from './telegram-media.downloader';

const CHANNEL = 'tg:7012345678';
const TOKEN = '7012345678:AAH-token';
const BYTES = new Uint8Array([1, 2, 3, 4]);
const tokenOf = resolveTelegramBotToken as jest.MockedFunction<
  typeof resolveTelegramBotToken
>;

function setup(file: { filePath: string; fileSize: number | null }) {
  const api = {
    getFile: jest.fn().mockResolvedValue(file),
    downloadFile: jest.fn().mockResolvedValue(BYTES),
  };
  return {
    api,
    downloader: new TelegramMediaDownloader(
      api as unknown as TelegramBotApiClient,
    ),
  };
}

beforeEach(() => tokenOf.mockReset().mockResolvedValue(TOKEN));

describe('TelegramMediaDownloader', () => {
  it('descarga el archivo en dos pasos y calcula su huella', async () => {
    const { api, downloader } = setup({
      filePath: 'photos/file_1.jpg',
      fileSize: 4,
    });

    const media = await downloader.download(
      { mediaId: 'file-1', mimeType: 'image/jpeg' },
      CHANNEL,
    );

    expect(api.getFile).toHaveBeenCalledWith(TOKEN, 'file-1');
    expect(api.downloadFile).toHaveBeenCalledWith(
      TOKEN,
      'photos/file_1.jpg',
      TELEGRAM_MAX_DOWNLOAD_BYTES,
    );
    expect(media).toEqual({
      bytes: BYTES,
      mimeType: 'image/jpeg',
      sizeBytes: 4,
      sha256: createHash('sha256').update(BYTES).digest('hex'),
    });
  });

  it('deduce el mime de un documento sin mime por la extensión', async () => {
    const { downloader } = setup({
      filePath: 'documents/rut.PDF',
      fileSize: 4,
    });

    const media = await downloader.download(
      { mediaId: 'doc', mimeType: 'application/octet-stream' },
      CHANNEL,
    );

    expect(media.mimeType).toBe('application/pdf');
  });

  it('no intenta descargar un archivo de más de 20 MB', async () => {
    const { api, downloader } = setup({
      filePath: 'documents/enorme.pdf',
      fileSize: TELEGRAM_MAX_DOWNLOAD_BYTES + 1,
    });

    await expect(
      downloader.download(
        { mediaId: 'doc', mimeType: 'application/pdf' },
        CHANNEL,
      ),
    ).rejects.toThrow(TelegramApiError);
    expect(api.downloadFile).not.toHaveBeenCalled();
  });

  it('falla explícitamente si el canal no tiene bot', async () => {
    tokenOf.mockResolvedValue(null);
    const { downloader } = setup({ filePath: 'x.jpg', fileSize: 1 });

    await expect(
      downloader.download({ mediaId: 'f', mimeType: 'image/jpeg' }, CHANNEL),
    ).rejects.toThrow(/sin bot/);
  });
});
