// Tokens de inyección del slice de pagos (PIX): un Symbol por puerto de la
// capa de aplicación; el módulo mapea cada token a su adaptador concreto.

export const CREDIT_PORTFOLIO_REPOSITORY = Symbol('CreditPortfolioRepository');
export const MEDIA_CLASSIFIER = Symbol('MediaClassifier');
export const PAYMENT_ANTIFRAUD_SERVICE = Symbol('PaymentAntifraudService');
export const BANK_PAYMENT_VERIFIER = Symbol('BankPaymentVerifier');
export const PAYMENT_RECEIPT_STORAGE = Symbol('PaymentReceiptStorage');
export const TENANT_BANK_ACCOUNT_REPOSITORY = Symbol('TenantBankAccountRepository');
export const RECONCILIATION_REPOSITORY = Symbol('ReconciliationRepository');
export const MEDIA_ROUTER = Symbol('RouteInboundMediaHandler');
