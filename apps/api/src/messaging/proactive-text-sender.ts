import type {
  OutboundRecipient,
  OutboundTextSender,
} from '@preztiaos/application';
import { ConflictError } from '@preztiaos/domain';
import { ReachableChannelResolver } from './reachable-channel.resolver';

/**
 * Ningún canal habilitado alcanza al cliente: el aviso no se envía (ni se registra como enviado).
 * Es un conflicto de estado (409 en la frontera) con un mensaje accionable para el operador que lo
 * disparó, p. ej. al ofertar un plan a un cliente que solo usó un bot que luego bloqueó.
 */
export class NoReachableChannelError extends ConflictError {
  constructor() {
    super(
      'El cliente no es alcanzable por ningún canal de mensajería habilitado',
      'NO_REACHABLE_CHANNEL',
    );
    this.name = 'NoReachableChannelError';
  }
}

/**
 * Decorador del puerto `OutboundTextSender` para los avisos por INICIATIVA PROPIA (oferta de plan,
 * crédito registrado, pago conciliado). El `channelId` que recibe es el guardado en el agregado;
 * antes de enviar lo reemplaza por el canal alcanzable HOY (ADR #40, D8): el último que el cliente
 * usó, u otro de su zona si el guardado ya no sirve (bot bloqueado, proveedor deshabilitado).
 *
 * Va POR FUERA del decorador de transcript, para que el transcript registre el canal real.
 */
export class ProactiveTextSender implements OutboundTextSender {
  constructor(
    private readonly resolver: ReachableChannelResolver,
    private readonly inner: OutboundTextSender,
  ) {}

  async sendText(to: OutboundRecipient, body: string): Promise<void> {
    const channelId = await this.resolver.resolve({
      storedChannelId: to.channelId,
      phone: to.recipient,
    });
    if (!channelId) throw new NoReachableChannelError();
    await this.inner.sendText({ channelId, recipient: to.recipient }, body);
  }
}
