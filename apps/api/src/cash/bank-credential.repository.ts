import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { decryptSecret, encryptSecret } from '../shared/secret-cipher';

/** Mapa nombre → valor del secreto. `null` BORRA; `undefined` no toca; string lo cifra y guarda. */
export type SecretPatch = Readonly<Record<string, string | null | undefined>>;

/**
 * Repositorio de SECRETOS NOMBRADOS de un banco/proveedor (tabla `bank_credential`). Un
 * proveedor como Mercado Pago necesita varias credenciales (`public_key`, `access_token`,
 * `webhook_secret`): cada una es una fila, cifrada en reposo (AES-256-GCM).
 *
 * SRP: traduce dominio ↔ persistencia cifrada; no contiene reglas de negocio. El valor en
 * claro nunca sale salvo por `get`/`getAll` (uso interno de los adaptadores bancarios); la
 * frontera HTTP solo expone la PRESENCIA del secreto vía `listNames`. Todo bajo RLS.
 *
 * Métodos `*Tx`: operan sobre una transacción existente para componer atómicamente con el CRUD
 * de la cuenta (escribir cuenta + credenciales en una sola transacción).
 */
@Injectable()
export class BankCredentialDrizzleRepository {
  /** Crea o reemplaza un secreto (upsert idempotente por (cuenta, nombre)). Lo cifra. */
  async set(input: {
    tenantId: string;
    bankAccountId: string;
    name: string;
    value: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, (tx) =>
      this.upsert(
        tx,
        input.tenantId,
        input.bankAccountId,
        input.name,
        input.value,
      ),
    );
  }

  /** Aplica un `SecretPatch` a una cuenta (abre su propia transacción). */
  async setMany(input: {
    tenantId: string;
    bankAccountId: string;
    secrets: SecretPatch;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, (tx) =>
      this.setManyTx(tx, input.tenantId, input.bankAccountId, input.secrets),
    );
  }

  /** Igual que `setMany` pero dentro de una transacción dada (composición atómica). */
  async setManyTx(
    tx: Tx,
    tenantId: string,
    bankAccountId: string,
    secrets: SecretPatch,
  ): Promise<void> {
    for (const [name, value] of Object.entries(secrets)) {
      if (value === undefined) continue; // ausente: no se toca
      if (value === null) await this.removeIn(tx, bankAccountId, name);
      else await this.upsert(tx, tenantId, bankAccountId, name, value);
    }
  }

  /** Lee y descifra un secreto; `null` si no existe. */
  async get(input: {
    tenantId: string;
    bankAccountId: string;
    name: string;
  }): Promise<string | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select({ value: schema.bankCredential.valueEncrypted })
        .from(schema.bankCredential)
        .where(
          and(
            eq(schema.bankCredential.bankAccountId, input.bankAccountId),
            eq(schema.bankCredential.name, input.name),
          ),
        )
        .limit(1);
      return row ? decryptSecret(row.value) : null;
    });
  }

  /** Lee y descifra todos los secretos de una cuenta como mapa nombre → valor. */
  async getAll(input: {
    tenantId: string;
    bankAccountId: string;
  }): Promise<Record<string, string>> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const rows = await tx
        .select({
          name: schema.bankCredential.name,
          value: schema.bankCredential.valueEncrypted,
        })
        .from(schema.bankCredential)
        .where(eq(schema.bankCredential.bankAccountId, input.bankAccountId));
      const out: Record<string, string> = {};
      for (const row of rows) out[row.name] = decryptSecret(row.value);
      return out;
    });
  }

  /** Nombres de los secretos presentes (sin exponer valores): para los `hasX` de la vista. */
  async listNames(input: {
    tenantId: string;
    bankAccountId: string;
  }): Promise<string[]> {
    return withTenantTxFor(input.tenantId, (tx) =>
      this.listNamesTx(tx, input.bankAccountId),
    );
  }

  /** Igual que `listNames` dentro de una transacción dada. */
  async listNamesTx(tx: Tx, bankAccountId: string): Promise<string[]> {
    const rows = await tx
      .select({ name: schema.bankCredential.name })
      .from(schema.bankCredential)
      .where(eq(schema.bankCredential.bankAccountId, bankAccountId));
    return rows.map((r) => r.name);
  }

  /**
   * Presencia de secretos de TODAS las cuentas del tenant, agrupada por cuenta. Una sola
   * consulta (evita N+1 al armar la lista de cuentas). RLS acota al tenant del contexto.
   */
  async namesByAccountTx(tx: Tx): Promise<Map<string, string[]>> {
    const rows = await tx
      .select({
        bankAccountId: schema.bankCredential.bankAccountId,
        name: schema.bankCredential.name,
      })
      .from(schema.bankCredential);
    const map = new Map<string, string[]>();
    for (const row of rows) {
      const names = map.get(row.bankAccountId) ?? [];
      names.push(row.name);
      map.set(row.bankAccountId, names);
    }
    return map;
  }

  /** Borra un secreto (rotación/baja). No falla si no existe. */
  async remove(input: {
    tenantId: string;
    bankAccountId: string;
    name: string;
  }): Promise<void> {
    await withTenantTxFor(input.tenantId, (tx) =>
      this.removeIn(tx, input.bankAccountId, input.name),
    );
  }

  private async upsert(
    tx: Tx,
    tenantId: string,
    bankAccountId: string,
    name: string,
    value: string,
  ): Promise<void> {
    await tx
      .insert(schema.bankCredential)
      .values({
        tenantId,
        bankAccountId,
        name,
        valueEncrypted: encryptSecret(value),
      })
      .onConflictDoUpdate({
        target: [
          schema.bankCredential.bankAccountId,
          schema.bankCredential.name,
        ],
        set: { valueEncrypted: encryptSecret(value), updatedAt: new Date() },
      });
  }

  private async removeIn(
    tx: Tx,
    bankAccountId: string,
    name: string,
  ): Promise<void> {
    await tx
      .delete(schema.bankCredential)
      .where(
        and(
          eq(schema.bankCredential.bankAccountId, bankAccountId),
          eq(schema.bankCredential.name, name),
        ),
      );
  }
}
