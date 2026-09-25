jest.mock('../tenancy/unit-of-work', () => ({
  resolveTelegramBotToken: jest.fn(),
}));

import { resolveTelegramBotToken } from '../tenancy/unit-of-work';
import type {
  TelegramBotApiClient,
  TelegramOutgoingMessage,
} from './telegram-bot-api.client';
import { TelegramContactPrompterAdapter } from './telegram-contact.prompter';

const CHAT = { channelId: 'tg:7012345678', chatId: '555' };
const TOKEN = '7012345678:AAH-token';
const tokenOf = resolveTelegramBotToken as jest.MockedFunction<
  typeof resolveTelegramBotToken
>;

function setup() {
  const sendMessage = jest.fn().mockResolvedValue(undefined);
  const prompter = new TelegramContactPrompterAdapter({
    sendMessage,
  } as unknown as TelegramBotApiClient);
  const lastMessage = (): TelegramOutgoingMessage =>
    (sendMessage.mock.calls.at(-1) as [string, TelegramOutgoingMessage])[1];
  return { prompter, sendMessage, lastMessage };
}

beforeEach(() => tokenOf.mockReset().mockResolvedValue(TOKEN));

describe('TelegramContactPrompterAdapter', () => {
  it('pide el número con el botón nativo que comparte el contacto propio', async () => {
    const { prompter, lastMessage } = setup();

    await prompter.requestContact(CHAT);

    expect(lastMessage()).toMatchObject({
      chatId: '555',
      parseMode: 'HTML',
      replyMarkup: {
        keyboard: [[expect.objectContaining({ request_contact: true })]],
        one_time_keyboard: true,
      },
    });
  });

  it('al confirmar retira el teclado y aconseja enviar los documentos como archivo', async () => {
    const { prompter, lastMessage } = setup();

    await prompter.confirmIdentified(CHAT);

    const message = lastMessage();
    expect(message.replyMarkup).toEqual({ remove_keyboard: true });
    expect(message.text).toContain('<b>archivo</b>');
  });

  it('explica el rechazo de un contacto ajeno y vuelve a ofrecer el botón', async () => {
    const { prompter, lastMessage } = setup();

    await prompter.rejectContact(CHAT, 'NOT_OWN_CONTACT');

    expect(lastMessage().text).toContain('TU propio número');
    expect(lastMessage().replyMarkup).toHaveProperty('keyboard');
  });

  it('falla explícitamente si el canal no tiene bot', async () => {
    tokenOf.mockResolvedValue(null);
    const { prompter, sendMessage } = setup();

    await expect(prompter.requestContact(CHAT)).rejects.toThrow(/sin bot/);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
