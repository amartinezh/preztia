import { Module } from "@nestjs/common";
import {
  AnswerTextMessageHandler,
  AudioMessageDispatcher,
  CreditApplicationStarter,
  ImageMessageDispatcher,
  KnowledgeAssistant,
  OutboundTextSender,
  ProcessInboundMessageHandler,
  TenantAssistantConfigRepository,
  TextMessageConsumer,
} from "@preztiaos/application";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller";
import { WhatsappTextConsumer } from "./adapters/whatsapp-text.consumer";
import { AudioDispatchAdapter } from "./adapters/audio-dispatch.adapter";
import { DocumentDispatchAdapter } from "./adapters/document-dispatch.adapter";
import { TenantConfigDrizzleRepository } from "./text/tenant-config.repository";
import { KnowledgeAssistantRouter } from "./ai/knowledge-assistant.router";
import { WhatsappTextSender } from "./text/whatsapp-text-sender";
import { CreditApplicationStarterStub } from "./text/credit-application-starter.stub";
import {
  AUDIO_DISPATCHER,
  CONFIG_REPOSITORY,
  CREDIT_APPLICATION_STARTER,
  IMAGE_DISPATCHER,
  KNOWLEDGE_ASSISTANT,
  OUTBOUND_TEXT_SENDER,
  TEXT_CONSUMER,
} from "./conversations.tokens";

/**
 * Cableado del bounded context Conversations: cada puerto de la capa de
 * aplicación se enlaza con su adaptador de infraestructura, y los casos de uso
 * se componen por inyección de dependencias (inversión de dependencias).
 */
@Module({
  controllers: [WhatsappWebhookController],
  providers: [
    // Enrutado por tipo de mensaje → adaptadores.
    { provide: TEXT_CONSUMER, useClass: WhatsappTextConsumer },
    { provide: AUDIO_DISPATCHER, useClass: AudioDispatchAdapter },
    { provide: IMAGE_DISPATCHER, useClass: DocumentDispatchAdapter },

    // Puertos del caso de uso de texto → adaptadores.
    { provide: CONFIG_REPOSITORY, useClass: TenantConfigDrizzleRepository },
    { provide: KNOWLEDGE_ASSISTANT, useClass: KnowledgeAssistantRouter },
    { provide: OUTBOUND_TEXT_SENDER, useClass: WhatsappTextSender },
    { provide: CREDIT_APPLICATION_STARTER, useClass: CreditApplicationStarterStub },

    // Caso de uso de texto (aplicación).
    {
      provide: AnswerTextMessageHandler,
      inject: [CONFIG_REPOSITORY, KNOWLEDGE_ASSISTANT, OUTBOUND_TEXT_SENDER, CREDIT_APPLICATION_STARTER],
      useFactory: (
        configs: TenantAssistantConfigRepository,
        assistant: KnowledgeAssistant,
        sender: OutboundTextSender,
        credit: CreditApplicationStarter,
      ) => new AnswerTextMessageHandler(configs, assistant, sender, credit),
    },

    // Despachador raíz que clasifica y enruta.
    {
      provide: ProcessInboundMessageHandler,
      inject: [TEXT_CONSUMER, AUDIO_DISPATCHER, IMAGE_DISPATCHER],
      useFactory: (
        text: TextMessageConsumer,
        audio: AudioMessageDispatcher,
        image: ImageMessageDispatcher,
      ) => new ProcessInboundMessageHandler(text, audio, image),
    },
  ],
})
export class ConversationsModule {}
