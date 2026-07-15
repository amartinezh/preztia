import type { Role, TenantStatus } from "@preztiaos/domain";

// Puertos de salida del bounded context IAM (identidad, tenants, zonas, asignaciones).
// La infraestructura los implementa con Drizzle: el plano de control (tenants + provisión
// de admins) bajo la conexión BYPASSRLS; el plano de datos (usuarios, zonas, cobradores)
// bajo el rol `app` + RLS. Aquí solo se DECLARAN; el dominio no conoce I/O.

/** Hashing de contraseñas (impl en infraestructura con node:crypto scrypt). */
export interface PasswordHasher {
  hash(plain: string): Promise<string>;
}

/** Identidad del actor que ejecuta la operación, derivada del JWT verificado. */
export interface ActorContext {
  readonly userId: string;
  readonly role: Role;
  /** Tenant del actor; el SUPER_ADMIN no lo usa (opera el plano de control). */
  readonly tenantId: string;
  /** Subárbol(es) de zonas asignadas (paths ltree) para authZ de alcance. */
  readonly zonePaths: readonly string[];
}

// ---------------------------------------------------------------------------
// Plano de control: tenants y provisión de admins (SUPER_ADMIN / BYPASSRLS)
// ---------------------------------------------------------------------------

export interface TenantRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: TenantStatus;
}

export interface TenantStore {
  /** Inserta el tenant; lanza `ConflictError` si el slug ya existe. */
  create(input: { id: string; name: string; slug: string }): Promise<void>;
  /** Actualiza nombre/estado; `null` si no existe. */
  update(input: {
    id: string;
    name?: string;
    status?: TenantStatus;
  }): Promise<TenantRecord | null>;
  /** Elimina el tenant; `false` si no existía. */
  remove(id: string): Promise<boolean>;
  findById(id: string): Promise<TenantRecord | null>;
}

/** Filas borradas por tabla (nombre físico → conteo) durante una purga de datos. */
export type PurgeCounts = Readonly<Record<string, number>>;

/**
 * Purga ATÓMICA de los datos transaccionales de un tenant (reinicio de pruebas): borra
 * solicitudes, créditos, cuotas, pagos, documentos, conversaciones, caja y auditoría, en
 * orden seguro de claves foráneas. NO toca el tenant, sus usuarios ni la configuración
 * (zonas, canales, cuentas, planes, catálogo). El orden de borrado es detalle de
 * persistencia y vive en la infraestructura.
 */
export interface TenantDataPurger {
  purge(tenantId: string): Promise<PurgeCounts>;
}

/**
 * Purga de los archivos de un tenant en el almacén de objetos (MinIO): documentos KYC y
 * comprobantes cifrados en reposo. Devuelve cuántos objetos se eliminaron. Es "best-effort"
 * fuera de la transacción de BD: los objetos huérfanos no tienen referencias.
 */
export interface TenantFilePurger {
  purge(tenantId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Plano de datos: usuarios del tenant
// ---------------------------------------------------------------------------

export interface NewUser {
  readonly id: string;
  /** SIEMPRE presente para roles de tenant; el control-plane lo fija al tenant destino. */
  readonly tenantId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly zonePaths: readonly string[];
}

export interface UserRecord {
  readonly id: string;
  readonly tenantId: string | null;
  readonly email: string;
  readonly role: Role;
  readonly zonePaths: readonly string[];
  readonly active: boolean;
}

export interface UserStore {
  /** Inserta el usuario; lanza `ConflictError` si el email (único GLOBAL) ya existe. */
  create(user: NewUser): Promise<void>;
  /** Actualiza zonas/estado/contraseña; `null` si el usuario no existe en el tenant. */
  update(input: {
    tenantId: string;
    userId: string;
    zonePaths?: readonly string[];
    active?: boolean;
    passwordHash?: string;
  }): Promise<UserRecord | null>;
  findById(input: { tenantId: string; userId: string }): Promise<UserRecord | null>;
}

// ---------------------------------------------------------------------------
// Plano de datos: zonas (árbol ltree)
// ---------------------------------------------------------------------------

export interface ZoneRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly parentZoneId: string | null;
  readonly path: string;
  readonly name: string;
  /** Teléfono de atención al cliente de la zona (null si no se configuró). */
  readonly supportPhone: string | null;
}

export interface ZoneStore {
  create(input: {
    id: string;
    tenantId: string;
    parentZoneId: string | null;
    path: string;
    name: string;
    supportPhone: string | null;
  }): Promise<void>;
  update(input: {
    tenantId: string;
    zoneId: string;
    name: string;
    /** `undefined` conserva el valor actual; `null`/string lo actualiza. */
    supportPhone?: string | null;
  }): Promise<ZoneRecord | null>;
  /** Elimina la zona si es hoja; informa si tiene hijas (para impedirlo). */
  remove(input: {
    tenantId: string;
    zoneId: string;
  }): Promise<{ deleted: boolean; hasChildren: boolean }>;
  findById(input: { tenantId: string; zoneId: string }): Promise<ZoneRecord | null>;
  /** Vincula un coordinador a una zona (idempotente). */
  assignCoordinator(input: {
    tenantId: string;
    zoneId: string;
    coordinatorId: string;
  }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Plano de datos: asignación cobrador → clientes
// ---------------------------------------------------------------------------

export interface CollectorAssignmentStore {
  /**
   * Reemplaza ATÓMICAMENTE el conjunto de clientes de un cobrador por `borrowerIds`
   * (borra los que sobran, inserta los nuevos). Idempotente.
   */
  replaceAssignments(input: {
    tenantId: string;
    collectorId: string;
    assignedBy: string;
    borrowerIds: readonly string[];
  }): Promise<void>;
}
