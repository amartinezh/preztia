import type { RequiredDocumentType } from "@preztiaos/domain";

// Caso de uso: administrar el catálogo de documentos requeridos del tenant (lo que el bot pide
// al iniciar una solicitud). La validación de forma/unicidad vive en la frontera (contrato); la
// persistencia (upsert + desactivar faltantes) va por el puerto.

export interface DocumentRequirementItem {
  documentKey: RequiredDocumentType;
  title: string;
  description: string;
  sortOrder: number;
  active: boolean;
}

export interface DocumentRequirementsStore {
  list(tenantId: string): Promise<DocumentRequirementItem[]>;
  /** Deja el catálogo del tenant EXACTAMENTE como la lista provista (upsert + desactivar el resto). */
  replace(input: { tenantId: string; items: DocumentRequirementItem[] }): Promise<void>;
}

export class SetDocumentRequirementsHandler {
  constructor(private readonly store: DocumentRequirementsStore) {}

  async execute(input: {
    tenantId: string;
    items: DocumentRequirementItem[];
  }): Promise<DocumentRequirementItem[]> {
    await this.store.replace(input);
    return this.store.list(input.tenantId);
  }
}
