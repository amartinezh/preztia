import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import type {
  BorrowerNoteStore,
  BorrowerPatch,
  BorrowerRecord,
  BorrowerStore,
  NewBorrower,
  NewBorrowerNote,
} from '@preztiaos/application';
import { withTenantTxFor } from '../tenancy/unit-of-work';
import { mapUniqueViolation } from '../shared/persistence-errors';

// Adaptadores del PLANO DE DATOS para clientes: operan `borrower`/`borrower_note` bajo el rol
// `app` + RLS (toda escritura con el tenant del actor). No contienen reglas de negocio.

const DUPLICATE_NATIONAL_ID = 'Ya existe un cliente con esa cédula';

@Injectable()
export class BorrowerDrizzleRepository implements BorrowerStore {
  async create(b: NewBorrower): Promise<void> {
    await mapUniqueViolation(
      () =>
        withTenantTxFor(b.tenantId, async (tx) => {
          await tx.insert(schema.borrower).values({
            id: b.id,
            tenantId: b.tenantId,
            nationalId: b.nationalId,
            firstName: b.firstName,
            lastName: b.lastName,
            business: b.business,
            phone: b.phone,
            lat: b.lat,
            lng: b.lng,
            color: b.color,
            creditBlocked: b.creditBlocked,
            creditLimitMinor: b.creditLimitMinor,
          });
        }),
      DUPLICATE_NATIONAL_ID,
    );
  }

  async update(input: {
    tenantId: string;
    borrowerId: string;
    patch: BorrowerPatch;
  }): Promise<BorrowerRecord | null> {
    return mapUniqueViolation(
      () =>
        withTenantTxFor(input.tenantId, async (tx) => {
          const [row] = await tx
            .update(schema.borrower)
            .set({ ...presentColumns(input.patch), updatedAt: new Date() })
            .where(eq(schema.borrower.id, input.borrowerId))
            .returning();
          return row ? toRecord(row) : null;
        }),
      DUPLICATE_NATIONAL_ID,
    );
  }

  async findById(input: {
    tenantId: string;
    borrowerId: string;
  }): Promise<BorrowerRecord | null> {
    return withTenantTxFor(input.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.borrower)
        .where(eq(schema.borrower.id, input.borrowerId))
        .limit(1);
      return row ? toRecord(row) : null;
    });
  }
}

@Injectable()
export class BorrowerNoteDrizzleRepository implements BorrowerNoteStore {
  async add(note: NewBorrowerNote): Promise<void> {
    await withTenantTxFor(note.tenantId, async (tx) => {
      await tx.insert(schema.borrowerNote).values({
        id: note.id,
        tenantId: note.tenantId,
        borrowerId: note.borrowerId,
        authorId: note.authorId,
        body: note.body,
      });
    });
  }
}

// Solo incluye en el UPDATE los campos presentes en el patch (undefined = no tocar; null =
// limpiar). Evita pisar columnas con NULL por accidente.
function presentColumns(patch: BorrowerPatch) {
  const set: Record<string, unknown> = {};
  for (const key of [
    'nationalId',
    'firstName',
    'lastName',
    'business',
    'phone',
    'lat',
    'lng',
    'color',
    'creditBlocked',
    'creditLimitMinor',
  ] as const) {
    if (patch[key] !== undefined) set[key] = patch[key];
  }
  return set;
}

function toRecord(row: typeof schema.borrower.$inferSelect): BorrowerRecord {
  return {
    id: row.id,
    nationalId: row.nationalId,
    firstName: row.firstName,
    lastName: row.lastName,
    business: row.business,
    phone: row.phone,
    lat: row.lat,
    lng: row.lng,
    color: row.color,
    creditBlocked: row.creditBlocked,
    creditLimitMinor: row.creditLimitMinor,
    createdAt: row.createdAt.toISOString(),
  };
}
