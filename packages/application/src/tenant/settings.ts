import { mergeOperationalSettings, type OperationalSettings } from "@preztiaos/domain";

// Caso de uso: actualizar los ajustes operativos del tenant (configuración de cobro). La mezcla
// del parche es pura (dominio); la persistencia va por el puerto.

export interface TenantSettingsStore {
  get(tenantId: string): Promise<OperationalSettings>;
  save(input: { tenantId: string; settings: OperationalSettings }): Promise<void>;
}

export class UpdateTenantSettingsHandler {
  constructor(private readonly store: TenantSettingsStore) {}

  async execute(input: {
    tenantId: string;
    patch: Partial<OperationalSettings>;
  }): Promise<OperationalSettings> {
    const current = await this.store.get(input.tenantId);
    const next = mergeOperationalSettings(current, input.patch);
    await this.store.save({ tenantId: input.tenantId, settings: next });
    return next;
  }
}
