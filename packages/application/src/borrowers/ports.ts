import type { BorrowerColor, ChangeRequestStatus } from "@preztiaos/domain";

// Puertos de salida del bounded context BORROWERS (clientes/deudores). La infraestructura los
// implementa con Drizzle bajo el rol `app` + RLS (toda escritura con el tenant del actor). Aquí
// solo se DECLARAN; la aplicación no conoce I/O ni framework.

export interface NewBorrower {
  readonly id: string;
  readonly tenantId: string;
  readonly nationalId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly business: string | null;
  readonly phone: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly color: BorrowerColor;
  readonly creditBlocked: boolean;
  readonly creditLimitMinor: number;
}

// Forma del cliente que devuelve la persistencia (espejo de `borrowerSummary` del contrato).
export interface BorrowerRecord {
  readonly id: string;
  readonly nationalId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly business: string | null;
  readonly phone: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly color: BorrowerColor;
  readonly creditBlocked: boolean;
  readonly creditLimitMinor: number;
  readonly createdAt: string;
}

// Edición parcial: solo se persisten los campos presentes (acciones rápidas o formulario).
export interface BorrowerPatch {
  readonly nationalId?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly business?: string | null;
  readonly phone?: string | null;
  readonly lat?: number | null;
  readonly lng?: number | null;
  readonly color?: BorrowerColor;
  readonly creditBlocked?: boolean;
  readonly creditLimitMinor?: number;
}

export interface BorrowerStore {
  /** Inserta el cliente; lanza `ConflictError` si la cédula ya existe en el tenant. */
  create(borrower: NewBorrower): Promise<void>;
  /** Aplica el patch; `null` si el cliente no existe en el tenant. */
  update(input: {
    tenantId: string;
    borrowerId: string;
    patch: BorrowerPatch;
  }): Promise<BorrowerRecord | null>;
  findById(input: {
    tenantId: string;
    borrowerId: string;
  }): Promise<BorrowerRecord | null>;
}

export interface NewBorrowerNote {
  readonly id: string;
  readonly tenantId: string;
  readonly borrowerId: string;
  readonly authorId: string;
  readonly body: string;
}

export interface BorrowerNoteStore {
  /** Inserta una nota (bitácora append-only: nunca se edita ni borra). */
  add(note: NewBorrowerNote): Promise<void>;
}

// --- Solicitud de modificación de cliente (maker-checker) --------------------

export interface NewChangeRequest {
  readonly id: string;
  readonly tenantId: string;
  readonly borrowerId: string;
  readonly requestedBy: string;
  /** Cambios propuestos (subconjunto de BorrowerPatch). */
  readonly changes: BorrowerPatch;
}

export interface ChangeRequestRecord {
  readonly id: string;
  readonly borrowerId: string;
  readonly requestedBy: string;
  readonly changes: BorrowerPatch;
  readonly status: ChangeRequestStatus;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly createdAt: string;
}

export interface ChangeRequestStore {
  create(request: NewChangeRequest): Promise<void>;
  findById(input: {
    tenantId: string;
    requestId: string;
  }): Promise<ChangeRequestRecord | null>;
  updateReview(input: {
    tenantId: string;
    requestId: string;
    status: ChangeRequestStatus;
    reviewedBy: string;
    reviewedAt: Date;
  }): Promise<ChangeRequestRecord | null>;
}

// --- Listas personalizadas (segmentación) -----------------------------------

export interface BorrowerListStore {
  /** Crea la lista; lanza `ConflictError` si el nombre ya existe en el tenant. */
  createList(input: { id: string; tenantId: string; name: string }): Promise<void>;
  /** Elimina la lista (y sus miembros); `false` si no existía. */
  deleteList(input: { tenantId: string; listId: string }): Promise<boolean>;
  findList(input: { tenantId: string; listId: string }): Promise<{ id: string } | null>;
  /** Alta masiva idempotente de miembros; devuelve cuántos se agregaron (sin contar repetidos). */
  addMembers(input: {
    tenantId: string;
    listId: string;
    borrowerIds: readonly string[];
  }): Promise<number>;
  /** Quita un cliente de la lista; `false` si no era miembro. */
  removeMember(input: {
    tenantId: string;
    listId: string;
    borrowerId: string;
  }): Promise<boolean>;
}
