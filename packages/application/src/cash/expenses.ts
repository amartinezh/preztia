import { randomUUID } from "node:crypto";
import {
  NotFoundError,
  assertExpenseAmountMinor,
  assertValidExpenseReceipt,
  isWithinScope,
  reviewExpense,
} from "@preztiaos/domain";
import type { ExpenseReceiptStorage, ExpenseRecord, ExpenseStore } from "./ports";

// Casos de uso de GASTOS (maker-checker). El cobrador solicita con comprobante; el
// ADMIN/COORDINATOR revisa dentro de su alcance. El controlador ya filtró el rol; aquí se imponen
// las invariantes de dominio.

export interface RequestExpenseCommand {
  tenantId: string;
  requestedBy: string;
  description: string;
  amountMinor: number;
  /** Comprobante obligatorio (foto o PDF). */
  receipt: { bytes: Uint8Array; mimeType: string };
}

export class RequestExpenseHandler {
  constructor(
    private readonly expenses: ExpenseStore,
    private readonly receipts: ExpenseReceiptStorage,
  ) {}

  async execute(cmd: RequestExpenseCommand): Promise<{ id: string }> {
    assertExpenseAmountMinor(cmd.amountMinor);
    assertValidExpenseReceipt({
      mimeType: cmd.receipt.mimeType,
      sizeBytes: cmd.receipt.bytes.length,
    });
    const id = randomUUID();
    // Primero la evidencia: si falla el guardado, no queda un gasto sin comprobante.
    const receipt = await this.receipts.store({
      tenantId: cmd.tenantId,
      expenseId: id,
      bytes: cmd.receipt.bytes,
      mimeType: cmd.receipt.mimeType,
    });
    await this.expenses.create({
      id,
      tenantId: cmd.tenantId,
      requestedBy: cmd.requestedBy,
      description: cmd.description,
      amountMinor: cmd.amountMinor,
      receipt,
    });
    return { id };
  }
}

export interface ReviewExpenseCommand {
  tenantId: string;
  expenseId: string;
  reviewerId: string;
  /** Subárbol de zonas del revisor; `null` = ADMIN (todo el tenant). */
  reviewerZonePaths: readonly string[] | null;
  approve: boolean;
  /** Caja/cuenta de la que sale el dinero del gasto; requerida al aprobar (validada en el contrato). */
  paidFromCashBoxId?: string;
  /** Motivo del rechazo; obligatorio al rechazar (lo impone el dominio). */
  rejectionReason?: string;
}

export class ReviewExpenseHandler {
  constructor(private readonly expenses: ExpenseStore) {}

  async execute(cmd: ReviewExpenseCommand): Promise<ExpenseRecord> {
    const current = await this.expenses.findById({
      tenantId: cmd.tenantId,
      expenseId: cmd.expenseId,
    });
    // Fuera del alcance del coordinador responde igual que si no existiera (no se revela).
    if (!current || !this.canReview(current, cmd.reviewerZonePaths)) {
      throw new NotFoundError("El gasto no existe");
    }
    // El dominio impone la transición única (solo PENDING) y el motivo al rechazar.
    const decision = reviewExpense({
      current: current.status,
      approve: cmd.approve,
      ...(cmd.rejectionReason !== undefined ? { rejectionReason: cmd.rejectionReason } : {}),
    });
    const updated = await this.expenses.updateReview({
      tenantId: cmd.tenantId,
      expenseId: cmd.expenseId,
      status: decision.status,
      reviewedBy: cmd.reviewerId,
      reviewedAt: new Date(),
      rejectionReason: decision.rejectionReason,
      // Aprobar debita el gasto de la caja pagadora en la misma transacción.
      ...(cmd.approve && cmd.paidFromCashBoxId
        ? { paidFromCashBoxId: cmd.paidFromCashBoxId }
        : {}),
    });
    if (!updated) throw new NotFoundError("El gasto no existe");
    return updated;
  }

  /** ADMIN revisa todo; el coordinador solo gastos de su subárbol (un gasto sin zona es del ADMIN). */
  private canReview(expense: ExpenseRecord, scopes: readonly string[] | null): boolean {
    if (scopes === null) return true;
    return expense.zonePath !== null && isWithinScope(expense.zonePath, scopes);
  }
}
