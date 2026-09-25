jest.mock('../tenancy/unit-of-work', () => ({}));

import { ConflictError } from '@preztiaos/domain';
import type { OutboundTextSender } from '@preztiaos/application';
import { BestEffortTextSender } from './best-effort-text-sender';
import {
  NoReachableChannelError,
  ProactiveTextSender,
} from './proactive-text-sender';
import type { ReachableChannelResolver } from './reachable-channel.resolver';

const STORED = '1111111111';
const PHONE = '5561999998888';
const TO = { channelId: STORED, recipient: PHONE };

/** Envío falso: el `jest.fn` se expone aparte para las aserciones. */
function fakeSender(): { sendText: jest.Mock; sender: OutboundTextSender } {
  const sendText = jest.fn().mockResolvedValue(undefined);
  return { sendText, sender: { sendText } };
}

function fakeResolver(channelId: string | null): {
  resolve: jest.Mock;
  resolver: ReachableChannelResolver;
} {
  const resolve = jest.fn().mockResolvedValue(channelId);
  return {
    resolve,
    resolver: { resolve } as unknown as ReachableChannelResolver,
  };
}

describe('ProactiveTextSender', () => {
  it('reemplaza el canal guardado por el canal alcanzable hoy', async () => {
    const { sendText, sender } = fakeSender();
    const { resolve, resolver } = fakeResolver('tg:7012345678');

    await new ProactiveTextSender(resolver, sender).sendText(
      TO,
      'Tu crédito fue registrado',
    );

    expect(resolve).toHaveBeenCalledWith({
      storedChannelId: STORED,
      phone: PHONE,
    });
    expect(sendText).toHaveBeenCalledWith(
      { channelId: 'tg:7012345678', recipient: PHONE },
      'Tu crédito fue registrado',
    );
  });

  it('sin canal alcanzable no envía y reporta un conflicto accionable (409)', async () => {
    const { sendText, sender } = fakeSender();
    const proactive = new ProactiveTextSender(
      fakeResolver(null).resolver,
      sender,
    );

    const error: unknown = await proactive
      .sendText(TO, 'hola')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NoReachableChannelError);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).code).toBe('NO_REACHABLE_CHANNEL');
    expect(sendText).not.toHaveBeenCalled();
  });
});

describe('BestEffortTextSender', () => {
  it('entrega el aviso cuando el envío funciona', async () => {
    const { sendText, sender } = fakeSender();

    await new BestEffortTextSender(sender).sendText(TO, 'ok');

    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('no propaga el fallo del aviso (no aborta la conciliación ya consumada)', async () => {
    const { sendText, sender } = fakeSender();
    sendText.mockRejectedValue(new NoReachableChannelError());

    await expect(
      new BestEffortTextSender(sender).sendText(TO, 'ok'),
    ).resolves.toBeUndefined();
  });
});
