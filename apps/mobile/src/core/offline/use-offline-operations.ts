import { useEffect, useMemo, useState } from "react";

import { listOperations, subscribeOperations, type QueueState } from "./queue";

const EMPTY: QueueState = { pending: [], failed: [] };

/**
 * Estado REACTIVO de la cola offline (pendientes de envío + rechazadas por el servidor). Carga el
 * estado persistido al montar y se actualiza con cada cambio (encolar, barrido, reintento,
 * descarte) para que la UI nunca muestre un pendiente que ya no existe.
 */
export function useOfflineOperations(): QueueState {
  const [state, setState] = useState<QueueState>(EMPTY);
  useEffect(() => {
    let active = true;
    void listOperations().then((loaded) => {
      if (active) setState(loaded);
    });
    const unsubscribe = subscribeOperations(setState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return state;
}

/** Payload de una operación de dinero sobre un crédito (abono encolado). */
export type CreditOperationPayload = { creditId: string; amountMinor: number | null };

/**
 * Lee del payload (opaco para la cola) el crédito y el monto de una operación de dinero.
 * `null` si la operación no apunta a un crédito. Tolerante: el monto puede faltar.
 */
export function readCreditPayload(payload: unknown): CreditOperationPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const { creditId, amountMinor } = payload as { creditId?: unknown; amountMinor?: unknown };
  if (typeof creditId !== "string") return null;
  return { creditId, amountMinor: typeof amountMinor === "number" ? amountMinor : null };
}

export type PendingPaymentsSummary = { pending: number; failed: number };

/**
 * Cuántas operaciones de dinero hay por crédito sin confirmar: `pending` (guardadas sin señal,
 * aún no enviadas) y `failed` (rechazadas por el servidor). Para marcar en las listas del
 * cobrador los clientes cuyo abono todavía no existe en el servidor.
 */
export function usePendingPaymentsByCredit(): Map<string, PendingPaymentsSummary> {
  const { pending, failed } = useOfflineOperations();
  return useMemo(() => {
    const byCredit = new Map<string, PendingPaymentsSummary>();
    const bump = (payload: unknown, field: keyof PendingPaymentsSummary) => {
      const credit = readCreditPayload(payload);
      if (!credit) return;
      const current = byCredit.get(credit.creditId) ?? { pending: 0, failed: 0 };
      byCredit.set(credit.creditId, { ...current, [field]: current[field] + 1 });
    };
    for (const op of pending) bump(op.payload, "pending");
    for (const op of failed) bump(op.payload, "failed");
    return byCredit;
  }, [pending, failed]);
}
