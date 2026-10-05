import { Inject, Injectable } from '@nestjs/common';
import {
  type CreditApplicationRepository,
  type PendingDocumentReminder,
  type RequiredDocumentCatalog,
} from '@preztiaos/application';
import {
  clientMessagesFor,
  findDocumentSpec,
  nextPendingDocument,
} from '@preztiaos/domain';
import { ClientLanguageRepository } from '../../tenant-config/client-language.repository';
import {
  CREDIT_APPLICATION_REPOSITORY,
  REQUIRED_DOCUMENT_CATALOG,
} from '../conversations.tokens';

/**
 * Adaptador del puerto PendingDocumentReminder: si el solicitante tiene una solicitud
 * activa con un documento pendiente, construye el recordatorio (su título del catálogo)
 * para que el flujo de texto insista hasta lograr la completitud. Devuelve null cuando
 * no hay nada pendiente. No contiene reglas: compone repositorio + catálogo + dominio.
 */
@Injectable()
export class CreditApplicationPendingDocumentReminder implements PendingDocumentReminder {
  constructor(
    @Inject(CREDIT_APPLICATION_REPOSITORY)
    private readonly applications: CreditApplicationRepository,
    @Inject(REQUIRED_DOCUMENT_CATALOG)
    private readonly catalog: RequiredDocumentCatalog,
    private readonly languages: ClientLanguageRepository,
  ) {}

  async forApplicant(input: {
    tenantId: string;
    channelId: string;
    applicant: string;
  }): Promise<string | null> {
    const active = await this.applications.findActiveByApplicant(input);
    if (!active) return null;

    const pending = nextPendingDocument(active.application);
    if (!pending) return null;

    const specs = await this.catalog.listRequested(input.tenantId);
    const spec = findDocumentSpec(specs, pending);
    if (!spec) return null;

    const language = await this.languages.byTenant(input.tenantId);
    return clientMessagesFor(language).application.pendingReminder(spec.title);
  }
}
