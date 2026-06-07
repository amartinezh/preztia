// Tokens de inyección para los puertos de salida (hexagonal): el contenedor de
// Nest los resuelve a los adaptadores concretos en conversations.module.ts.

// Enrutado por tipo de mensaje (process-inbound-message).
export const TEXT_CONSUMER = Symbol("TextMessageConsumer");
export const AUDIO_DISPATCHER = Symbol("AudioMessageDispatcher");
export const IMAGE_DISPATCHER = Symbol("ImageMessageDispatcher");

// Caso de uso de texto (answer-text-message).
export const CONFIG_REPOSITORY = Symbol("TenantAssistantConfigRepository");
export const KNOWLEDGE_ASSISTANT = Symbol("KnowledgeAssistant");
export const OUTBOUND_TEXT_SENDER = Symbol("OutboundTextSender");
export const CREDIT_APPLICATION_STARTER = Symbol("CreditApplicationStarter");
