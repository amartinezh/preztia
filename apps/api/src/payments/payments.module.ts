import { Module } from '@nestjs/common';
import {
  ReconcilePendingPaymentsHandler,
  SubmitPaymentReceiptHandler,
  type BankPaymentVerifier,
  type CreditPortfolioRepository,
  type PaymentAntifraudService,
  type PaymentReceiptStorage,
  type ReconciliationRepository,
  type TenantBankAccountRepository,
} from '@preztiaos/application';
import { ConversationMessageLog } from '../conversations/conversation-message.log';
import { WhatsappTextSender } from '../conversations/text/whatsapp-text-sender';
import { LoggingTextSender } from '../conversations/text/logging-text-sender';
import { GeminiPaymentClassifier } from './ai/gemini-payment.classifier';
import { CreditPortfolioDrizzleRepository } from './credit-portfolio.repository';
import { PaymentReconciliationDrizzleRepository } from './payment-reconciliation.repository';
import {
  DuplicateEndToEndRule,
  PaymentAntifraudComposite,
  Sha256ReuseRule,
  StaleReceiptRule,
} from './payment-antifraud.service';
import { MinioPaymentReceiptStorage } from './payment-receipt.storage';
import { TenantBankAccountDrizzleRepository } from './tenant-bank-account.repository';
import { BankVerifierRegistry } from './banking/bank-verifier.registry';
import { InterApiClient } from './banking/inter/inter-api.client';
import { InterPaymentVerifier } from './banking/inter/inter-payment.verifier';
import { PaymentsQueryRepository } from './payments-query.repository';
import { PaymentsController } from './payments.controller';
import {
  BANK_PAYMENT_VERIFIER,
  CREDIT_PORTFOLIO_REPOSITORY,
  MEDIA_CLASSIFIER,
  PAYMENT_ANTIFRAUD_SERVICE,
  PAYMENT_RECEIPT_STORAGE,
  RECONCILIATION_REPOSITORY,
  TENANT_BANK_ACCOUNT_REPOSITORY,
} from './payments.tokens';

const DEFAULT_RECONCILIATION_MAX_ATTEMPTS = 5;

function reconciliationMaxAttempts(): number {
  const n = Number(process.env.RECONCILIATION_MAX_ATTEMPTS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_RECONCILIATION_MAX_ATTEMPTS;
}

/**
 * Slice de pagos (PIX): recepción de comprobantes, cartera, conciliación
 * bancaria por (país, banco) y antifraude de pagos. ConversationsModule lo
 * importa para enrutar el media entrante hacia SubmitPaymentReceiptHandler.
 */
@Module({
  controllers: [PaymentsController],
  providers: [
    // Puertos del slice → adaptadores.
    { provide: CREDIT_PORTFOLIO_REPOSITORY, useClass: CreditPortfolioDrizzleRepository },
    { provide: MEDIA_CLASSIFIER, useClass: GeminiPaymentClassifier },
    { provide: PAYMENT_RECEIPT_STORAGE, useClass: MinioPaymentReceiptStorage },
    { provide: TENANT_BANK_ACCOUNT_REPOSITORY, useClass: TenantBankAccountDrizzleRepository },
    { provide: RECONCILIATION_REPOSITORY, useClass: PaymentReconciliationDrizzleRepository },
    PaymentsQueryRepository,
    TenantBankAccountDrizzleRepository,

    // Antifraude de pagos: composite de reglas. PUNTO DE EXTENSIÓN: para ampliar
    // el antifraude se agrega aquí una regla nueva (clase PaymentFraudRule).
    {
      provide: PAYMENT_ANTIFRAUD_SERVICE,
      useFactory: () =>
        new PaymentAntifraudComposite([
          new Sha256ReuseRule(),
          new DuplicateEndToEndRule(),
          new StaleReceiptRule(),
        ]),
    },

    // Conciliación bancaria por (país, entidad). PUNTO DE EXTENSIÓN: para un
    // banco nuevo se registra su adaptador con la clave "PAÍS:BANCO".
    InterApiClient,
    InterPaymentVerifier,
    {
      provide: BANK_PAYMENT_VERIFIER,
      inject: [InterPaymentVerifier],
      useFactory: (inter: InterPaymentVerifier) =>
        new BankVerifierRegistry(new Map([['BR:INTER', inter]])),
    },

    // Envío de WhatsApp con registro en el transcript (instancia propia del slice).
    ConversationMessageLog,
    WhatsappTextSender,
    {
      provide: SubmitPaymentReceiptHandler,
      inject: [
        CREDIT_PORTFOLIO_REPOSITORY,
        TENANT_BANK_ACCOUNT_REPOSITORY,
        PAYMENT_ANTIFRAUD_SERVICE,
        BANK_PAYMENT_VERIFIER,
        PAYMENT_RECEIPT_STORAGE,
        WhatsappTextSender,
        ConversationMessageLog,
      ],
      useFactory: (
        portfolios: CreditPortfolioRepository,
        accounts: TenantBankAccountRepository,
        antifraud: PaymentAntifraudService,
        bank: BankPaymentVerifier,
        storage: PaymentReceiptStorage,
        sender: WhatsappTextSender,
        log: ConversationMessageLog,
      ) =>
        new SubmitPaymentReceiptHandler(
          portfolios,
          accounts,
          antifraud,
          bank,
          storage,
          new LoggingTextSender(sender, log),
        ),
    },
    {
      provide: ReconcilePendingPaymentsHandler,
      inject: [
        RECONCILIATION_REPOSITORY,
        TENANT_BANK_ACCOUNT_REPOSITORY,
        BANK_PAYMENT_VERIFIER,
        WhatsappTextSender,
        ConversationMessageLog,
      ],
      useFactory: (
        repo: ReconciliationRepository,
        accounts: TenantBankAccountRepository,
        bank: BankPaymentVerifier,
        sender: WhatsappTextSender,
        log: ConversationMessageLog,
      ) =>
        new ReconcilePendingPaymentsHandler(
          repo,
          accounts,
          bank,
          new LoggingTextSender(sender, log),
          reconciliationMaxAttempts(),
        ),
    },
  ],
  exports: [
    CREDIT_PORTFOLIO_REPOSITORY,
    MEDIA_CLASSIFIER,
    SubmitPaymentReceiptHandler,
  ],
})
export class PaymentsModule {}
