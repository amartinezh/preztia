import type { DocumentMessage, ImageMessage } from "@preztiaos/domain";
import type {
  CreditApplicationRepository,
  DownloadedMedia,
  InboundMessageDeduplicator,
  MediaDownloader,
  TenantResolver,
} from "../credit/application/ports";
import type { SubmitDocumentCommand } from "../credit/application/submit-application-document";
import type { CreditPortfolioRepository, MediaClassifier } from "../credit/payment/ports";
import type { SubmitPaymentReceiptCommand } from "../credit/payment/submit-payment-receipt";

/** Destino del media; el handler KYC o el de pagos (segregados para poder fakear en tests). */
export interface DocumentSubmission {
  execute(cmd: SubmitDocumentCommand): Promise<void>;
}
export interface PaymentSubmission {
  execute(cmd: SubmitPaymentReceiptCommand): Promise<void>;
}

/** Confianza mínima del clasificador para enrutar a pagos cuando hay ambigüedad. */
const MIN_PAYMENT_ROUTING_CONFIDENCE = 0.6;

/**
 * Enrutador de media entrante (imagen/archivo): decide si va al protocolo KYC o a
 * la recepción de pagos. Es el ÚNICO dueño de resolver tenant, deduplicar y
 * descargar el binario (una sola vez); los handlers reciben el trabajo preparado.
 *
 * La IA clasifica solo cuando hace falta: con solicitud KYC como único contexto se
 * va directo a documentos; con crédito activo se clasifica (la misma llamada ya
 * extrae los campos del PIX); si coexisten ambos, decide la clasificación.
 */
export class RouteInboundMediaHandler {
  constructor(
    private readonly tenants: TenantResolver,
    private readonly dedup: InboundMessageDeduplicator,
    private readonly applications: CreditApplicationRepository,
    private readonly portfolios: CreditPortfolioRepository,
    private readonly downloader: MediaDownloader,
    private readonly classifier: MediaClassifier,
    private readonly documents: DocumentSubmission,
    private readonly payments: PaymentSubmission,
  ) {}

  async execute(message: ImageMessage | DocumentMessage): Promise<void> {
    const tenantId = await this.tenants.resolveByChannel(message.channelId);
    if (!tenantId) return; // canal no asociado a ningún tenant

    if (!(await this.dedup.firstSeen({ tenantId, messageId: message.id }))) return; // ya procesado

    const [application, portfolio] = await Promise.all([
      this.applications.findActiveByApplicant({
        tenantId,
        channelId: message.channelId,
        applicant: message.from,
      }),
      this.portfolios.findActiveByPhone({ tenantId, phone: message.from }),
    ]);
    if (!application && !portfolio) return; // sin contexto activo: el archivo se ignora

    const downloaded = await this.downloader.download(message.media);

    // Solo solicitud KYC: directo a documentos, sin gastar IA en clasificar.
    if (application && !portfolio) {
      await this.documents.execute(this.toDocumentCommand(message, tenantId, downloaded));
      return;
    }

    const classification = await this.classifier.classify({ tenantId, media: downloaded });
    const paymentCommand: SubmitPaymentReceiptCommand = {
      tenantId,
      channelId: message.channelId,
      payerPhone: message.from,
      messageId: message.id,
      mediaId: message.media.mediaId,
      media: downloaded,
      classification,
    };

    // Solo crédito activo: todo media se trata como posible pago (el handler
    // responde con orientación si no era un comprobante).
    if (!application) {
      await this.payments.execute(paymentCommand);
      return;
    }

    // Coexisten solicitud y crédito: decide la clasificación. Bajo ambigüedad se
    // prefiere el KYC (hay un documento pendiente esperado).
    const isPayment =
      classification.kind === "payment_receipt" &&
      classification.confidence >= MIN_PAYMENT_ROUTING_CONFIDENCE;
    if (isPayment) {
      await this.payments.execute(paymentCommand);
      return;
    }
    await this.documents.execute(this.toDocumentCommand(message, tenantId, downloaded));
  }

  private toDocumentCommand(
    message: ImageMessage | DocumentMessage,
    tenantId: string,
    downloaded: DownloadedMedia,
  ): SubmitDocumentCommand {
    return {
      messageId: message.id,
      channelId: message.channelId,
      applicant: message.from,
      media: message.media,
      prepared: { tenantId, downloaded },
    };
  }
}
