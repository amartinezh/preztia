import { randomUUID } from "node:crypto";
import {
  NotFoundError,
  assertCreditLimitMinor,
  resolveInitialCreditLimit,
  UNLIMITED_CREDIT_LIMIT,
  normalizeNationalId,
  type BorrowerColor,
} from "@preztiaos/domain";
import type {
  BorrowerNoteStore,
  BorrowerPatch,
  BorrowerRecord,
  BorrowerStore,
} from "./ports";

// Casos de uso del PLANO DE DATOS para clientes (deudores). Orquestan dominio + puertos y
// definen la transacción; no validan HTTP ni arman SQL. El controlador ya filtró el rol del
// actor (requireRole); toda escritura ocurre con el tenant del ACTOR.

export interface CreateBorrowerCommand {
  tenantId: string;
  nationalId: string;
  firstName: string;
  lastName: string;
  business: string | null;
  address: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  color: BorrowerColor;
  creditBlocked: boolean;
  /** Ausente = cupo por defecto de la empresa; 0 = sin límite a propósito; > 0 = ese cupo. */
  creditLimitMinor?: number | undefined;
}

// Puerto opcional: cupo por defecto del tenant (config). Si se inyecta y el cliente se crea SIN
// especificar cupo, nace con el cupo por defecto; un 0 explícito es "sin límite" a propósito.
export interface DefaultCreditLimitProvider {
  defaultCreditLimitMinor(tenantId: string): Promise<number>;
}

export class CreateBorrowerHandler {
  constructor(
    private readonly borrowers: BorrowerStore,
    private readonly defaults?: DefaultCreditLimitProvider,
  ) {}

  /** Devuelve también el cupo con el que nació (puede venir del cupo por defecto). */
  async execute(cmd: CreateBorrowerCommand): Promise<{ id: string; creditLimitMinor: number }> {
    // Sin especificar → cupo por defecto de la empresa; 0 explícito → sin límite (regla de dominio).
    const tenantDefault =
      cmd.creditLimitMinor === undefined && this.defaults
        ? await this.defaults.defaultCreditLimitMinor(cmd.tenantId)
        : UNLIMITED_CREDIT_LIMIT;
    const creditLimitMinor = resolveInitialCreditLimit(cmd.creditLimitMinor, tenantDefault);
    const id = randomUUID();
    await this.borrowers.create({
      id,
      tenantId: cmd.tenantId,
      nationalId: normalizeNationalId(cmd.nationalId),
      firstName: cmd.firstName,
      lastName: cmd.lastName,
      business: cmd.business,
      address: cmd.address,
      phone: cmd.phone,
      lat: cmd.lat,
      lng: cmd.lng,
      color: cmd.color,
      creditBlocked: cmd.creditBlocked,
      creditLimitMinor,
    });
    return { id, creditLimitMinor };
  }
}

export interface UpdateBorrowerCommand {
  tenantId: string;
  borrowerId: string;
  patch: BorrowerPatch;
}

export class UpdateBorrowerHandler {
  constructor(private readonly borrowers: BorrowerStore) {}

  async execute(cmd: UpdateBorrowerCommand): Promise<BorrowerRecord> {
    if (cmd.patch.creditLimitMinor !== undefined) {
      assertCreditLimitMinor(cmd.patch.creditLimitMinor);
    }
    const patch: BorrowerPatch =
      cmd.patch.nationalId !== undefined
        ? { ...cmd.patch, nationalId: normalizeNationalId(cmd.patch.nationalId) }
        : cmd.patch;
    const updated = await this.borrowers.update({
      tenantId: cmd.tenantId,
      borrowerId: cmd.borrowerId,
      patch,
    });
    if (!updated) throw new NotFoundError("El cliente no existe");
    return updated;
  }
}

export interface AddBorrowerNoteCommand {
  tenantId: string;
  borrowerId: string;
  authorId: string;
  body: string;
}

export class AddBorrowerNoteHandler {
  constructor(
    private readonly notes: BorrowerNoteStore,
    private readonly borrowers: BorrowerStore,
  ) {}

  async execute(cmd: AddBorrowerNoteCommand): Promise<{ id: string }> {
    // El cliente debe existir en el tenant antes de anotarlo (404 si no).
    const borrower = await this.borrowers.findById({
      tenantId: cmd.tenantId,
      borrowerId: cmd.borrowerId,
    });
    if (!borrower) throw new NotFoundError("El cliente no existe");
    const id = randomUUID();
    await this.notes.add({
      id,
      tenantId: cmd.tenantId,
      borrowerId: cmd.borrowerId,
      authorId: cmd.authorId,
      body: cmd.body,
    });
    return { id };
  }
}
