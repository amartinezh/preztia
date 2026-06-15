import { randomUUID } from "node:crypto";
import { NotFoundError, assertExpenseAmountMinor, decideExpense } from "@preztiaos/domain";
import type { ExpenseRecord, ExpenseStore } from "./ports";

// Casos de uso de GASTOS (maker-checker). El cobrador solicita; el ADMIN/COORDINATOR revisa.
// El controlador ya filtró el rol; aquí se imponen las invariantes de dominio.

export interface RequestExpenseCommand {
  tenantId: string;
  requestedBy: string;
  description: string;
  amountMinor: number;
}

export class RequestExpenseHandler {
  constructor(private readonly expenses: ExpenseStore) {}

  async execute(cmd: RequestExpenseCommand): Promise<{ id: string }> {
    assertExpenseAmountMinor(cmd.amountMinor);
    const id = randomUUID();
    await this.expenses.create({
      id,
      tenantId: cmd.tenantId,
      requestedBy: cmd.requestedBy,
      description: cmd.description,
      amountMinor: cmd.amountMinor,
    });
    return { id };
  }
}

export interface ReviewExpenseCommand {
  tenantId: string;
  expenseId: string;
  reviewerId: string;
  approve: boolean;
}

export class ReviewExpenseHandler {
  constructor(private readonly expenses: ExpenseStore) {}

  async execute(cmd: ReviewExpenseCommand): Promise<ExpenseRecord> {
    const current = await this.expenses.findById({
      tenantId: cmd.tenantId,
      expenseId: cmd.expenseId,
    });
    if (!current) throw new NotFoundError("El gasto no existe");
    // El dominio impone la transición única (solo PENDING se revisa).
    const status = decideExpense(current.status, cmd.approve);
    const updated = await this.expenses.updateReview({
      tenantId: cmd.tenantId,
      expenseId: cmd.expenseId,
      status,
      reviewedBy: cmd.reviewerId,
      reviewedAt: new Date(),
    });
    if (!updated) throw new NotFoundError("El gasto no existe");
    return updated;
  }
}
