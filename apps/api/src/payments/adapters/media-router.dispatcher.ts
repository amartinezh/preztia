import { Inject, Injectable } from '@nestjs/common';
import {
  RouteInboundMediaHandler,
  type DocumentMessageDispatcher,
  type ImageMessageDispatcher,
} from '@preztiaos/application';
import { type DocumentMessage, type ImageMessage } from '@preztiaos/domain';
import { MEDIA_ROUTER } from '../payments.tokens';

/**
 * Adaptador de los puertos ImageMessageDispatcher y DocumentMessageDispatcher:
 * todo media entrante pasa por el enrutador, que decide entre el protocolo KYC
 * y la recepción de pagos (reemplaza el despacho directo al caso de uso KYC).
 */
@Injectable()
export class MediaRouterDispatcher implements ImageMessageDispatcher, DocumentMessageDispatcher {
  constructor(@Inject(MEDIA_ROUTER) private readonly router: RouteInboundMediaHandler) {}

  async dispatch(message: ImageMessage | DocumentMessage): Promise<void> {
    await this.router.execute(message);
  }
}
