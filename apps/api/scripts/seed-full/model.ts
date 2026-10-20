import type { schema } from '@preztiaos/db';
import type {
  CashBoxType,
  PortfolioInstallment,
  Role,
  ScheduleFrequency,
} from '@preztiaos/domain';
import type { CityProfile } from './fake-data';

// Modelo EN MEMORIA de cada tenant durante la simulación. Es la fuente de la que salen las filas:
// cada mutación se refleja aquí primero (saldos, cuotas, estados) y luego se persiste con el
// mismo valor, de modo que las reglas del dominio se evalúan siempre sobre el estado vigente.

export type Row<T extends { $inferInsert: unknown }> = T['$inferInsert'] & {
  id: string;
};

export interface ZoneRef {
  readonly id: string;
  readonly key: string;
  readonly path: string;
  readonly name: string;
  readonly city: CityProfile | null;
}

export interface UserRef {
  readonly id: string;
  readonly key: string;
  readonly email: string;
  readonly role: Role;
  readonly zonePaths: readonly string[];
  readonly row: Row<typeof schema.appUser>;
}

export interface BoxState {
  readonly id: string;
  readonly key: string;
  readonly type: CashBoxType;
  readonly name: string;
  readonly currency: string;
  readonly zoneId: string | null;
  readonly zonePath: string | null;
  readonly assignedTo: string | null;
  readonly bankAccountId: string | null;
  readonly pixKey: string | null;
  readonly row: Row<typeof schema.cashBox>;
  /** Saldo derivado (Σ asientos firmados): espejo en memoria del libro. */
  balance: number;
}

export interface PlanRef {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly installmentsCount: number;
  readonly frequency: ScheduleFrequency;
  readonly interestPct: number;
  readonly isActive: boolean;
}

export interface BankAccountRef {
  readonly id: string;
  readonly key: string;
  readonly bankCode: string;
  readonly providerType: 'MANUAL' | 'INTER' | 'MERCADOPAGO' | 'PICPAY';
  readonly pixKey: string | null;
  readonly receiverName: string | null;
}

/** Comportamiento de pago de un cliente: decide qué, cuándo y por qué canal paga. */
export type PayerProfile =
  | 'PUNCTUAL'
  | 'LATE'
  | 'PARTIAL'
  | 'DEFAULTER'
  | 'PIX'
  | 'SETTLER';

export interface BorrowerState {
  readonly id: string;
  readonly zone: ZoneRef;
  readonly collector: UserRef | null;
  readonly profile: PayerProfile;
  readonly phone: string;
  readonly nationalId: string;
  readonly fullName: string;
  readonly payerBank: { name: string; ispb: string };
  readonly row: Row<typeof schema.borrower>;
}

export interface CreditState {
  readonly id: string;
  readonly borrower: BorrowerState;
  readonly zone: ZoneRef;
  readonly principalMinor: number;
  readonly totalDueMinor: number;
  readonly currency: string;
  readonly frequency: ScheduleFrequency;
  readonly row: Row<typeof schema.credit>;
  installments: PortfolioInstallment[];
  readonly installmentRows: Map<string, Row<typeof schema.installment>>;
  paidSoFarMinor: number;
  /** Día en que el cliente deja de pagar (perfil DEFAULTER); null = nunca. */
  stopsPayingOn: string | null;
}
