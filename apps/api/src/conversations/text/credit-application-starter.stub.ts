import { Injectable, Logger } from "@nestjs/common";
import { CreditApplicationStarter } from "@preztiaos/application";

/**
 * Adaptador provisional: cuando el usuario quiere solicitar el crédito, aquí
 * arrancará el proceso de solicitud de documentación. Por ahora solo lo deja
 * trazado; se desarrollará en una fase posterior.
 */
@Injectable()
export class CreditApplicationStarterStub implements CreditApplicationStarter {
  private readonly logger = new Logger("WhatsApp:CreditApplication");

  async start(input: { tenantId: string; channelId: string; applicant: string }): Promise<void> {
    this.logger.log(
      `🚀 Solicitud de crédito iniciada para ${input.applicant} (tenant=${input.tenantId}). Proceso de documentación: pendiente de implementar.`,
    );
    // TODO Fase futura: crear el borrador de solicitud y pedir documentos al usuario.
  }
}
