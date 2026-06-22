import { Injectable } from '@nestjs/common';
import {
  CaptureApplicantLocationHandler,
  type LocationMessageDispatcher,
} from '@preztiaos/application';
import type { LocationMessage } from '@preztiaos/domain';

/**
 * Adaptador del puerto LocationMessageDispatcher: delega la ubicación entrante en el caso de uso
 * que la captura en la solicitud activa. Frontera fina (sin reglas): solo conecta el enrutador de
 * mensajes con la aplicación.
 */
@Injectable()
export class LocationDispatchAdapter implements LocationMessageDispatcher {
  constructor(private readonly handler: CaptureApplicantLocationHandler) {}

  async dispatch(message: LocationMessage): Promise<void> {
    await this.handler.execute(message);
  }
}
