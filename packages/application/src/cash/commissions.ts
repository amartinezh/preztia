import {
  NotFoundError,
  assertCommissionPayable,
  assertValidCommissionPolicy,
  isWithinScope,
  type CommissionPolicy,
} from "@preztiaos/domain";

// Casos de uso de la COMISIÓN DEL COBRADOR. El ADMIN fija el tope y el valor por defecto (ajustes
// del tenant); el COORDINATOR configura las zonas de su subárbol sin superar el tope; la comisión
// se CAUSA al cerrar la liquidación (foto sellada) y se PAGA después con un asiento COMMISSION. El
// controlador ya filtró el rol; aquí se imponen el alcance y las invariantes de dominio.

/** Quién actúa: `scopes` = subárbol de zonas del coordinador; `null` = ADMIN (todo el tenant). */
export interface CommissionActor {
  readonly userId: string;
  readonly scopes: readonly string[] | null;
}

export interface ZoneCommissionStore {
  /** Ruta de la zona y el tope vigente del tenant; null si la zona no existe. */
  loadZone(input: { tenantId: string; zoneId: string }): Promise<{ path: string; capPerMille: number } | null>;
  /** Guarda (o borra, con `policy: null`) la configuración propia de la zona y la audita. */
  saveZonePolicy(input: {
    tenantId: string;
    zoneId: string;
    policy: CommissionPolicy | null;
    actorId: string;
  }): Promise<void>;
}

export interface CommissionPaymentStore {
  /** Comisión causada del cobrador en una liquidación CERRADA; null si no hay tal línea. */
  loadDue(input: {
    tenantId: string;
    settlementId: string;
    collectorId: string;
  }): Promise<{ amountMinor: number; collectorZoneId: string | null; collectorZonePath: string | null } | null>;
  /**
   * Postea el egreso COMMISSION desde la caja elegida (regla de caja pagadora + saldo, en la misma
   * transacción) y lo audita. Pagar dos veces la misma comisión es 409 `COMMISSION_ALREADY_PAID`.
   */
  pay(input: {
    tenantId: string;
    settlementId: string;
    collectorId: string;
    /** Zona del cobrador: el egreso se le atribuye a ella aunque salga de una caja superior. */
    collectorZoneId: string | null;
    collectorZonePath: string | null;
    cashBoxId: string;
    amountMinor: number;
    paidBy: string;
  }): Promise<{ cashTransactionId: string }>;
}

/** ¿El actor alcanza esta zona? El ADMIN todo; el coordinador su subárbol (sin zona = del ADMIN). */
function reaches(actor: CommissionActor, zonePath: string | null): boolean {
  if (actor.scopes === null) return true;
  return zonePath !== null && isWithinScope(zonePath, actor.scopes);
}

export interface SetZoneCommissionCommand {
  tenantId: string;
  zoneId: string;
  /** null = quitar la configuración propia y volver a heredar. */
  policy: CommissionPolicy | null;
  actor: CommissionActor;
}

export class SetZoneCommissionHandler {
  constructor(private readonly zones: ZoneCommissionStore) {}

  async execute(cmd: SetZoneCommissionCommand): Promise<void> {
    const zone = await this.zones.loadZone({ tenantId: cmd.tenantId, zoneId: cmd.zoneId });
    // Fuera del alcance del coordinador responde igual que si no existiera (no se revela).
    if (!zone || !reaches(cmd.actor, zone.path)) throw new NotFoundError("La zona no existe");
    if (cmd.policy) assertValidCommissionPolicy(cmd.policy, zone.capPerMille);
    await this.zones.saveZonePolicy({
      tenantId: cmd.tenantId,
      zoneId: cmd.zoneId,
      policy: cmd.policy,
      actorId: cmd.actor.userId,
    });
  }
}

export interface PayCollectorCommissionCommand {
  tenantId: string;
  settlementId: string;
  collectorId: string;
  /** Caja de la que sale el dinero: su caja de ruta o una de oficina/banco que su zona usa. */
  cashBoxId: string;
  actor: CommissionActor;
}

export class PayCollectorCommissionHandler {
  constructor(private readonly payments: CommissionPaymentStore) {}

  async execute(cmd: PayCollectorCommissionCommand): Promise<{ cashTransactionId: string; amountMinor: number }> {
    const due = await this.payments.loadDue({
      tenantId: cmd.tenantId,
      settlementId: cmd.settlementId,
      collectorId: cmd.collectorId,
    });
    if (!due || !reaches(cmd.actor, due.collectorZonePath)) {
      throw new NotFoundError("La comisión no existe");
    }
    // Se paga exactamente lo causado y sellado en la foto: el monto no viaja desde el cliente.
    assertCommissionPayable(due.amountMinor);
    const { cashTransactionId } = await this.payments.pay({
      tenantId: cmd.tenantId,
      settlementId: cmd.settlementId,
      collectorId: cmd.collectorId,
      collectorZoneId: due.collectorZoneId,
      collectorZonePath: due.collectorZonePath,
      cashBoxId: cmd.cashBoxId,
      amountMinor: due.amountMinor,
      paidBy: cmd.actor.userId,
    });
    return { cashTransactionId, amountMinor: due.amountMinor };
  }
}
