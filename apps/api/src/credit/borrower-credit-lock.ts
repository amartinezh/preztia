import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@preztiaos/db';
import { assertCanReceiveCredit, NotFoundError } from '@preztiaos/domain';
import { type Tx } from '../tenancy/unit-of-work';

/** Saldo pendiente del cliente: Σ (debido − pagado) de las cuotas de sus créditos ACTIVE. */
export async function outstandingOfBorrower(
  tx: Tx,
  borrowerId: string,
): Promise<number> {
  const [agg] = await tx
    .select({
      outstanding: sql<number>`COALESCE(SUM(${schema.installment.amountDueMinor} - ${schema.installment.paidMinor}), 0)`,
    })
    .from(schema.installment)
    .innerJoin(schema.credit, eq(schema.credit.id, schema.installment.creditId))
    .where(
      and(
        eq(schema.credit.borrowerId, borrowerId),
        eq(schema.credit.status, 'ACTIVE'),
      ),
    );
  return Number(agg?.outstanding ?? 0);
}

/**
 * Re-verifica el cupo y el bloqueo del cliente DENTRO de la transacción que crea el crédito, que
 * es la garantía final de la regla. Bloquea la fila del cliente (FOR UPDATE) para serializar
 * "leer saldo → insertar crédito" por cliente: un otorgamiento concurrente al mismo cliente espera
 * al commit de este y, al leer el saldo (READ COMMITTED, nueva instantánea por sentencia), ya ve
 * el crédito recién creado. Sin esto, dos aprobaciones simultáneas podrían pasar ambas la
 * verificación previa y sumar más que el cupo. La decisión es del dominio (`assertCanReceiveCredit`,
 * 409); aquí solo se cargan los datos. Debe llamarse ANTES de insertar el crédito.
 */
export async function lockBorrowerAndAssertCreditPolicy(
  tx: Tx,
  input: { borrowerId: string; requestedMinor: number },
): Promise<void> {
  const [borrower] = await tx
    .select({
      creditBlocked: schema.borrower.creditBlocked,
      creditLimitMinor: schema.borrower.creditLimitMinor,
    })
    .from(schema.borrower)
    .where(eq(schema.borrower.id, input.borrowerId))
    .limit(1)
    .for('update');
  if (!borrower) throw new NotFoundError('El cliente no está registrado');

  assertCanReceiveCredit(borrower, {
    requestedMinor: input.requestedMinor,
    outstandingMinor: await outstandingOfBorrower(tx, input.borrowerId),
  });
}
