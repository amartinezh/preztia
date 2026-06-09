// Tokens de inyección para los puertos de salida (hexagonal): el contenedor de
// Nest los resuelve a los adaptadores concretos en conversations.module.ts.

// Enrutado por tipo de mensaje (process-inbound-message).
export const TEXT_CONSUMER = Symbol('TextMessageConsumer');
export const AUDIO_DISPATCHER = Symbol('AudioMessageDispatcher');
export const IMAGE_DISPATCHER = Symbol('ImageMessageDispatcher');
export const DOCUMENT_DISPATCHER = Symbol('DocumentMessageDispatcher');

// Caso de uso de texto (answer-text-message).
export const CONFIG_REPOSITORY = Symbol('TenantAssistantConfigRepository');
export const KNOWLEDGE_ASSISTANT = Symbol('KnowledgeAssistant');
export const OUTBOUND_TEXT_SENDER = Symbol('OutboundTextSender');
export const CREDIT_APPLICATION_STARTER = Symbol('CreditApplicationStarter');
export const PENDING_DOCUMENT_REMINDER = Symbol('PendingDocumentReminder');

// Slice de solicitud de crédito (start/submit + antifraude + KYC).
export const CREDIT_APPLICATION_REPOSITORY = Symbol(
  'CreditApplicationRepository',
);
export const REQUIRED_DOCUMENT_CATALOG = Symbol('RequiredDocumentCatalog');
export const APPLICATION_COMPLETION_NOTIFIER = Symbol(
  'ApplicationCompletionNotifier',
);
export const DOCUMENT_REVIEWER = Symbol('DocumentReviewer');
export const MEDIA_DOWNLOADER = Symbol('MediaDownloader');
export const DOCUMENT_STORAGE = Symbol('DocumentStorage');
export const ANTIFRAUD_SERVICE = Symbol('AntifraudService');
export const INBOUND_MESSAGE_DEDUPLICATOR = Symbol(
  'InboundMessageDeduplicator',
);
export const TENANT_RESOLVER = Symbol('TenantResolver');
