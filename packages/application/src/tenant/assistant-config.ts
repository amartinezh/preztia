import type { AiProvider } from "@preztiaos/domain";

// Caso de uso: leer/actualizar la configuración del asistente de WhatsApp del tenant (base de
// conocimiento, proveedor de IA y credencial). La credencial es un SECRETO: la vista de lectura
// nunca la devuelve (solo `hasApiKey`); la persistencia va por el puerto.

/** Vista segura: jamás incluye la API key en claro. */
export interface AssistantConfigView {
  knowledgeBase: string;
  aiProvider: AiProvider;
  hasApiKey: boolean;
}

/** Parche parcial: solo los campos presentes se modifican. `aiApiKey` vacío borra la credencial. */
export interface AssistantConfigPatch {
  knowledgeBase?: string;
  aiProvider?: AiProvider;
  aiApiKey?: string;
}

export interface AssistantConfigStore {
  getView(tenantId: string): Promise<AssistantConfigView>;
  save(input: { tenantId: string } & AssistantConfigPatch): Promise<void>;
}

export class UpdateAssistantConfigHandler {
  constructor(private readonly store: AssistantConfigStore) {}

  async execute(input: {
    tenantId: string;
    patch: AssistantConfigPatch;
  }): Promise<AssistantConfigView> {
    await this.store.save({ tenantId: input.tenantId, ...input.patch });
    return this.store.getView(input.tenantId);
  }
}
