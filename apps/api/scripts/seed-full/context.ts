import { schema, type Db } from '@preztiaos/db';
import {
  clientMessagesFor,
  DEFAULT_OPERATIONAL_SETTINGS,
  type ClientMessages,
  type OperationalSettings,
} from '@preztiaos/domain';
import { WriteBatch } from './batch';
import type { BusinessClock } from './clock';
import type { FileVault } from './files';
import { Ledger } from './ledger';
import type {
  BankAccountRef,
  BorrowerState,
  BoxState,
  CreditState,
  PlanRef,
  UserRef,
  ZoneRef,
} from './model';
import { SeededRandom } from './random';
import type { TenantScenario } from './scenario';

// Contexto de UN tenant durante la siembra: catálogos ya creados (zonas, usuarios, cajas, planes,
// cuentas, canales), el estado vivo de la cartera y las herramientas de escritura (búfer, libro,
// archivos). Todos los módulos de la simulación reciben este objeto.

/** Contadores que alimentan el resumen final. */
export interface SeedStats {
  credits: number;
  payments: number;
  pixPayments: number;
  applications: number;
  remittances: number;
  depositOrders: number;
  expenses: number;
  routeStops: number;
  settlements: number;
  messages: number;
}

export class TenantContext {
  readonly batch = new WriteBatch();
  readonly ledger: Ledger;
  readonly messages: ClientMessages;
  readonly zones = new Map<string, ZoneRef>();
  readonly users = new Map<string, UserRef>();
  readonly boxes = new Map<string, BoxState>();
  readonly plans = new Map<string, PlanRef>();
  readonly accounts = new Map<string, BankAccountRef>();
  /** Canal (WhatsApp `phone_number_id` o Telegram `tg:<bot>`) que atiende cada zona hoja. */
  readonly channelByZone = new Map<string, string>();
  /** Zona que atiende cada canal (la que estampa conversaciones y solicitudes, como la API). */
  readonly zonePathByChannel = new Map<string, string>();
  defaultChannel: string | null = null;
  telegramChannel: string | null = null;
  /** Ajustes operativos vigentes (los mismos que se guardan en `tenant_config`). */
  settings: OperationalSettings = DEFAULT_OPERATIONAL_SETTINGS;
  /** Fin de la última liquidación sellada (bloquea fechas de pago anteriores). */
  sealedUntil: Date | null = null;
  readonly borrowers: BorrowerState[] = [];
  readonly credits: CreditState[] = [];
  readonly stats: SeedStats = {
    credits: 0,
    payments: 0,
    pixPayments: 0,
    applications: 0,
    remittances: 0,
    depositOrders: 0,
    expenses: 0,
    routeStops: 0,
    settlements: 0,
    messages: 0,
  };
  private phoneSequence = 0;

  constructor(
    readonly scenario: TenantScenario,
    readonly tenantId: string,
    readonly clock: BusinessClock,
    readonly files: FileVault,
    readonly db: Db,
  ) {
    this.ledger = new Ledger(tenantId, this.batch);
    this.messages = clientMessagesFor(scenario.language);
    this.random = new SeededRandom(seedOf(scenario.slug));
  }

  /** Aleatoriedad determinista propia del tenant (misma corrida ⇒ mismos datos). */
  readonly random: SeededRandom;

  get currency(): string {
    return this.scenario.currency;
  }

  zone(key: string): ZoneRef {
    return required(this.zones.get(key), `zona ${key}`);
  }

  user(key: string): UserRef {
    return required(this.users.get(key), `usuario ${key}`);
  }

  box(key: string): BoxState {
    return required(this.boxes.get(key), `caja ${key}`);
  }

  plan(key: string): PlanRef {
    return required(this.plans.get(key), `plan ${key}`);
  }

  account(key: string): BankAccountRef {
    return required(this.accounts.get(key), `cuenta ${key}`);
  }

  get admin(): UserRef {
    return this.user('admin');
  }

  /** Caja de ruta activa de un cobrador (la que recibe su efectivo). */
  routeBoxOf(collectorId: string): BoxState {
    const box = [...this.boxes.values()].find(
      (b) => b.assignedTo === collectorId && b.row.active,
    );
    return required(box, `caja de ruta del cobrador ${collectorId}`);
  }

  /** Coordinador cuyo alcance cubre la zona (o el ADMIN si no hay). */
  coordinatorFor(zone: ZoneRef): UserRef {
    const coordinator = [...this.users.values()].find(
      (u) =>
        u.role === 'COORDINATOR' &&
        u.zonePaths.some(
          (p) => zone.path === p || zone.path.startsWith(`${p}.`),
        ),
    );
    return coordinator ?? this.admin;
  }

  /** Canal por el que escribe un cliente de la zona. */
  channelFor(zone: ZoneRef): string {
    return required(
      this.channelByZone.get(zone.path) ?? this.defaultChannel,
      `canal de la zona ${zone.path}`,
    );
  }

  /** Siguiente teléfono de prueba no asignable para la ciudad. */
  nextPhoneSequence(): number {
    this.phoneSequence += 1;
    return this.phoneSequence;
  }

  /** Entrada de la bitácora transversal append-only (quién/qué/cuándo). */
  audit(input: {
    at: Date;
    actorId: string | null;
    action: string;
    entity: string;
    entityId: string | null;
    payload: Record<string, unknown> | null;
  }): void {
    this.batch.insert(schema.auditLog, {
      tenantId: this.tenantId,
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      payload: input.payload,
      correlationId: `seed-${input.at.getTime().toString(36)}`,
      createdAt: input.at,
    });
  }

  /** Operaciones que deben correr después de persistir el día (p. ej. reemplazar asignaciones). */
  readonly afterFlush: Array<() => Promise<void>> = [];

  async flush(): Promise<void> {
    await this.batch.flush(this.db);
    for (const task of this.afterFlush.splice(0)) await task();
  }
}

/** Semilla estable a partir de un texto (FNV-1a de 32 bits). */
function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function required<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Seed: no existe ${label}`);
  }
  return value;
}
