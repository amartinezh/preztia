import { Injectable, Logger } from '@nestjs/common';
import { type ApplicationCompletionNotifier } from '@preztiaos/application';

/**
 * Adaptador del puerto ApplicationCompletionNotifier.
 *
 * TEMPORAL (Fase 1): por ahora solo deja constancia en consola de que la solicitud
 * reunió todos sus documentos (completitud lograda). Más adelante este adaptador
 * disparará el siguiente paso del flujo (revisión, notificaciones, colas). El log es
 * estructurado y NO incluye PII: solo identificadores de tenant/solicitud.
 */
@Injectable()
export class LoggingApplicationCompletionNotifier implements ApplicationCompletionNotifier {
  private readonly logger = new Logger('CreditApplication:Completion');

  onCompleted(input: {
    tenantId: string;
    applicationId: string;
    applicant: string;
  }): Promise<void> {
    this.logger.log(
      `✅ Completitud lograda: documentación completa. tenantId=${input.tenantId} applicationId=${input.applicationId}`,
    );
    return Promise.resolve();
  }
}
