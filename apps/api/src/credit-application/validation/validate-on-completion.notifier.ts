import { Injectable, Logger } from '@nestjs/common';
import {
  type ApplicationCompletionNotifier,
  type ValidateApplicationDocumentsHandler,
} from '@preztiaos/application';

/**
 * Adaptador del puerto ApplicationCompletionNotifier: al lograr la completitud
 * documental dispara el pipeline antifraude (Etapas 2-4) sobre las extracciones
 * ya persistidas. El resultado queda en BD; aquí solo se deja constancia
 * agregada en el log (estructurado, sin PII).
 *
 * Un fallo del pipeline NO interrumpe el flujo conversacional del solicitante:
 * la solicitud ya quedó completa y el analista puede relanzar la validación.
 */
@Injectable()
export class AntifraudValidationCompletionNotifier implements ApplicationCompletionNotifier {
  private readonly logger = new Logger('CreditApplication:Antifraud');

  constructor(private readonly validate: ValidateApplicationDocumentsHandler) {}

  async onCompleted(input: {
    tenantId: string;
    applicationId: string;
    applicant: string;
  }): Promise<void> {
    this.logger.log(
      `✅ Completitud lograda; iniciando validación antifraude. tenantId=${input.tenantId} applicationId=${input.applicationId}`,
    );
    try {
      const report = await this.validate.execute({
        tenantId: input.tenantId,
        applicationId: input.applicationId,
      });
      this.logger.log(
        `🛡️ Validación antifraude terminada: status=${report.status} score=${report.score} alertas=${report.alerts.length} fuentes=[${report.consultedSources.join(',')}] tenantId=${input.tenantId} applicationId=${input.applicationId}`,
      );
    } catch (err) {
      this.logger.error(
        `Fallo la validación antifraude de la solicitud ${input.applicationId}; puede relanzarse desde la esteira`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
