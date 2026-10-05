import { parseClientLanguage, type ClientLanguage } from "@preztiaos/domain";

// Caso de uso: fijar el idioma en que la empresa atiende a sus clientes por chat. El cambio aplica
// en caliente: cada mensaje saliente vuelve a leer el idioma (ver `ClientLanguageResolver`).

export interface ClientLanguageStore {
  get(tenantId: string): Promise<ClientLanguage>;
  save(input: { tenantId: string; language: ClientLanguage }): Promise<void>;
}

export class UpdateClientLanguageHandler {
  constructor(private readonly store: ClientLanguageStore) {}

  async execute(input: { tenantId: string; language: string }): Promise<{ language: ClientLanguage }> {
    // El contrato ya restringe los valores; el dominio es la última barrera (fallo rápido).
    const language = parseClientLanguage(input.language);
    await this.store.save({ tenantId: input.tenantId, language });
    return { language };
  }
}
