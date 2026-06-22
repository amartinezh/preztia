import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import {
  assertCanPost,
  buildTransfer,
  type CashBoxType,
  type CashTxDirection,
  type CashTxKind,
} from '@preztiaos/domain';
import type {
  CashBox,
  CashTransactionRow,
  CreateCashBoxInput,
  UpdateCashBoxInput,
} from '@preztiaos/contracts';
import { withTenantTxFor, type Tx } from '../tenancy/unit-of-work';
import { balanceOfBox } from './cash-ledger';
import { guardDomain } from './domain-guard';
import { resolveTenantCurrency } from '../tenant-config/tenant-currency';

interface BoxRow {
  id: string;
  type: CashBoxType;
  name: string;
  currency: string;
  active: boolean;
}

function toBoxView(row: typeof schema.cashBox.$inferSelect): CashBox {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    currency: row.currency,
    bankAccountId: row.bankAccountId,
    assignedTo: row.assignedTo,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Valida que el cobrador a asignar exista, esté activo y tenga rol COLLECTOR en el tenant
 * (RLS aísla por tenant dentro de la tx). Una caja de ruta es el efectivo de un cobrador.
 */
async function assertAssignableCollector(
  tx: Tx,
  assignedTo: string,
): Promise<void> {
  const [user] = await tx
    .select({ role: schema.appUser.role, active: schema.appUser.active })
    .from(schema.appUser)
    .where(eq(schema.appUser.id, assignedTo))
    .limit(1);
  if (!user || !user.active || user.role !== 'COLLECTOR') {
    throw new BadRequestException(
      'El cobrador asignado no existe o no es un cobrador activo',
    );
  }
}

/** Un asiento a postear contra una caja (la naturaleza la decide el caso de uso). */
export interface PostingCommand {
  tenantId: string;
  cashBoxId: string;
  direction: CashTxDirection;
  kind: CashTxKind;
  amountMinor: number;
  reason: string | null;
  createdBy: string;
  paymentId?: string | null;
}

export interface TransferCommand {
  tenantId: string;
  fromBoxId: string;
  toBoxId: string;
  amountMinor: number;
  reason: string;
  createdBy: string;
}

/**
 * CRUD de cajas y posteo ATÓMICO de asientos en el libro mayor. Cada posteo toma un
 * advisory lock por caja (serializa los movimientos de esa caja), recalcula el saldo y
 * aplica la regla de dominio `assertCanPost` (motivo obligatorio, saldo no negativo,
 * reglas de tránsito) antes de insertar. El saldo nunca se almacena: es Σ de los asientos.
 */
@Injectable()
export class CashBoxDrizzleRepository {
  async list(tenantId: string): Promise<CashBox[]> {
    return withTenantTxFor(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(schema.cashBox)
        .orderBy(desc(schema.cashBox.createdAt));
      return rows.map(toBoxView);
    });
  }

  async create(tenantId: string, input: CreateCashBoxInput): Promise<CashBox> {
    const tenantCurrency = await resolveTenantCurrency(tenantId);
    return withTenantTxFor(tenantId, async (tx) => {
      // Para una caja bancaria, la cuenta debe existir (RLS garantiza que es del tenant).
      if (input.type === 'BANK') {
        const [account] = await tx
          .select({ id: schema.tenantBankAccount.id })
          .from(schema.tenantBankAccount)
          .where(eq(schema.tenantBankAccount.id, input.bankAccountId!))
          .limit(1);
        if (!account)
          throw new NotFoundException('Cuenta bancaria no encontrada');
      }
      // Una caja de ruta exige un cobrador válido (el CHECK ya garantiza que sea CASH).
      if (input.assignedTo) await assertAssignableCollector(tx, input.assignedTo);
      try {
        const [row] = await tx
          .insert(schema.cashBox)
          .values({
            tenantId,
            type: input.type,
            name: input.name,
            currency: tenantCurrency,
            bankAccountId: input.type === 'BANK' ? input.bankAccountId! : null,
            assignedTo: input.type === 'CASH' ? (input.assignedTo ?? null) : null,
          })
          .returning();
        return toBoxView(row);
      } catch (err) {
        // Una sola caja de tránsito por tenant / una sola caja por cuenta bancaria.
        if (isUnique(err)) {
          throw new ConflictException(
            'Ya existe una caja de tránsito o una caja para esa cuenta',
          );
        }
        throw err;
      }
    });
  }

  async update(
    tenantId: string,
    id: string,
    patch: UpdateCashBoxInput,
  ): Promise<CashBox> {
    return withTenantTxFor(tenantId, async (tx) => {
      // Asignar un cobrador exige que la caja sea de efectivo y el cobrador sea válido.
      if (patch.assignedTo) {
        const box = await loadBox(tx, id);
        if (!box) throw new NotFoundException('Caja no encontrada');
        if (box.type !== 'CASH') {
          throw new BadRequestException(
            'Solo una caja de efectivo se asigna a un cobrador',
          );
        }
        await assertAssignableCollector(tx, patch.assignedTo);
      }
      const [row] = await tx
        .update(schema.cashBox)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.cashBox.id, id))
        .returning();
      if (!row) throw new NotFoundException('Caja no encontrada');
      return toBoxView(row);
    });
  }

  async remove(tenantId: string, id: string): Promise<{ id: string }> {
    return withTenantTxFor(tenantId, async (tx) => {
      // Integridad financiera: una caja con movimientos no se borra (rompería el historial).
      const [movement] = await tx
        .select({ id: schema.cashTransaction.id })
        .from(schema.cashTransaction)
        .where(eq(schema.cashTransaction.cashBoxId, id))
        .limit(1);
      if (movement) {
        throw new ConflictException(
          'No se puede eliminar una caja con movimientos',
        );
      }
      const [row] = await tx
        .delete(schema.cashBox)
        .where(eq(schema.cashBox.id, id))
        .returning({ id: schema.cashBox.id });
      if (!row) throw new NotFoundException('Caja no encontrada');
      return { id: row.id };
    });
  }

  /** Postea un asiento (retiro, ingreso/egreso de caja menor, abono entrante). */
  async post(cmd: PostingCommand): Promise<CashTransactionRow> {
    return withTenantTxFor(cmd.tenantId, async (tx) => {
      const box = await lockBox(tx, cmd.cashBoxId);
      if (!box) throw new NotFoundException('Caja no encontrada');
      if (!box.active) throw new ConflictException('La caja está inactiva');

      const currentBalanceMinor = await balanceOfBox(tx, box.id);
      guardDomain(() =>
        assertCanPost({
          type: box.type,
          currentBalanceMinor,
          intent: {
            direction: cmd.direction,
            kind: cmd.kind,
            amountMinor: cmd.amountMinor,
            reason: cmd.reason,
          },
        }),
      );

      const [row] = await tx
        .insert(schema.cashTransaction)
        .values({
          tenantId: cmd.tenantId,
          cashBoxId: box.id,
          direction: cmd.direction,
          kind: cmd.kind,
          amountMinor: cmd.amountMinor,
          currency: box.currency,
          reason: cmd.reason,
          paymentId: cmd.paymentId ?? null,
          createdBy: cmd.createdBy,
        })
        .returning();
      return toTxView(row, box.name);
    });
  }

  /** Transfiere entre dos cajas en una transacción (dos asientos balanceados, Σ = 0). */
  async transfer(cmd: TransferCommand): Promise<{ transferGroupId: string }> {
    if (cmd.fromBoxId === cmd.toBoxId) {
      throw new BadRequestException(
        'Las cajas de origen y destino deben ser distintas',
      );
    }
    return withTenantTxFor(cmd.tenantId, async (tx) => {
      // Bloqueo ordenado por id para evitar interbloqueos entre transferencias cruzadas.
      const [firstId, secondId] = [cmd.fromBoxId, cmd.toBoxId].sort();
      await lockBox(tx, firstId);
      await lockBox(tx, secondId);

      const from = await loadBox(tx, cmd.fromBoxId);
      const to = await loadBox(tx, cmd.toBoxId);
      if (!from || !to) throw new NotFoundException('Caja no encontrada');
      if (!from.active || !to.active)
        throw new ConflictException('Alguna caja está inactiva');
      if (from.currency !== to.currency) {
        throw new ConflictException(
          'No se puede transferir entre cajas de distinta moneda',
        );
      }

      const { out, in: incoming } = guardDomain(() =>
        buildTransfer({ amountMinor: cmd.amountMinor, reason: cmd.reason }),
      );
      const fromBalance = await balanceOfBox(tx, from.id);
      guardDomain(() =>
        assertCanPost({
          type: from.type,
          currentBalanceMinor: fromBalance,
          intent: out,
        }),
      );
      // El asiento IN al destino nunca depende de su saldo (solo suma).
      guardDomain(() =>
        assertCanPost({
          type: to.type,
          currentBalanceMinor: 0,
          intent: incoming,
        }),
      );

      const transferGroupId = randomUUID();
      await tx.insert(schema.cashTransaction).values([
        {
          tenantId: cmd.tenantId,
          cashBoxId: from.id,
          direction: 'OUT',
          kind: 'TRANSFER',
          amountMinor: cmd.amountMinor,
          currency: from.currency,
          reason: cmd.reason,
          transferGroupId,
          createdBy: cmd.createdBy,
        },
        {
          tenantId: cmd.tenantId,
          cashBoxId: to.id,
          direction: 'IN',
          kind: 'TRANSFER',
          amountMinor: cmd.amountMinor,
          currency: to.currency,
          reason: cmd.reason,
          transferGroupId,
          createdBy: cmd.createdBy,
        },
      ]);
      return { transferGroupId };
    });
  }
}

/** Toma un advisory lock transaccional por caja y devuelve su fila (serializa el posteo). */
async function lockBox(tx: Tx, boxId: string): Promise<BoxRow | null> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${boxId}))`);
  return loadBox(tx, boxId);
}

async function loadBox(tx: Tx, boxId: string): Promise<BoxRow | null> {
  const [row] = await tx
    .select({
      id: schema.cashBox.id,
      type: schema.cashBox.type,
      name: schema.cashBox.name,
      currency: schema.cashBox.currency,
      active: schema.cashBox.active,
    })
    .from(schema.cashBox)
    .where(eq(schema.cashBox.id, boxId))
    .limit(1);
  return row ?? null;
}

function toTxView(
  row: typeof schema.cashTransaction.$inferSelect,
  boxName: string,
): CashTransactionRow {
  return {
    id: row.id,
    cashBoxId: row.cashBoxId,
    boxName,
    direction: row.direction,
    kind: row.kind,
    amountMinor: row.amountMinor,
    currency: row.currency,
    reason: row.reason,
    paymentId: row.paymentId,
    transferGroupId: row.transferGroupId,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUnique(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === '23505'
  );
}
