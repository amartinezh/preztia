import { useState } from "react";
import { Pressable } from "react-native";
import type { DepositOrder, FieldOrderStatus } from "@preztiaos/contracts";
import { Button, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { SecureFileViewer } from "@/components/secure-file-viewer";
import { useT } from "@/core/i18n";
import { useDepositOrders, useMarkDepositOrderSeen } from "../api/queries";
import { DepositOrderCard } from "./deposit-order-card";
import { OrderThreadModal } from "./order-thread-modal";
import { ReasonModal } from "./reason-modal";
import { ReportDepositModal } from "./report-deposit-modal";
import { VerifyDepositModal } from "./verify-deposit-modal";

const FILTERS: (FieldOrderStatus | undefined)[] = [undefined, "ISSUED", "REPORTED", "DISPUTED", "VERIFIED"];

type Dialog =
  | { kind: "report" | "verify"; order: DepositOrder }
  | { kind: "dispute" | "cancel"; orderId: string };

/**
 * Órdenes de consignación con todo su historial. `mode="mine"`: el cobrador ve las suyas (abrirlas
 * las marca "vistas") y las reporta. `mode="review"`: el revisor verifica, objeta o cancela dentro
 * de su zona. Ambos abren el hilo de la orden y el comprobante.
 */
export function DepositOrdersPanel({ mode }: { mode: "mine" | "review" }) {
  const { t } = useT();
  const [status, setStatus] = useState<FieldOrderStatus | undefined>(undefined);
  const [threadOf, setThreadOf] = useState<string | null>(null);
  const [receiptOf, setReceiptOf] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const list = useDepositOrders(mode, status);
  const seen = useMarkDepositOrderSeen();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  // El cobrador "abre" la orden al ver su hilo o reportarla: queda vista (una sola vez).
  const openAsCollector = (order: DepositOrder) => {
    if (mode === "mine" && order.status === "ISSUED") seen.mutate(order.id);
  };

  return (
    <Stack gap="sm">
      <Row gap="sm" className="flex-wrap">
        {FILTERS.map((f) => {
          const active = f === status;
          return (
            <Pressable
              key={f ?? "ALL"}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setStatus(f)}
              className={`min-h-[36px] justify-center rounded-full border px-3 ${
                active ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
              }`}
            >
              <Text variant="caption" tone={active ? "primary" : "muted"}>
                {f ? t(`deposit.status.${f}`) : t("cash.expenses.filterAll")}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      {list.isPending ? <Spinner label={t("common.loading")} /> : null}
      {!list.isPending && items.length === 0 ? <Text tone="muted">{t("deposit.empty")}</Text> : null}
      {items.map((order) => (
        <DepositOrderCard
          key={order.id}
          order={order}
          showCollector={mode === "review"}
          actions={{
            onThread: () => {
              openAsCollector(order);
              setThreadOf(order.id);
            },
            onReceipt: () => setReceiptOf(order.id),
            ...(mode === "mine"
              ? {
                  onReport: () => {
                    openAsCollector(order);
                    setDialog({ kind: "report", order });
                  },
                }
              : {
                  onVerify: () => setDialog({ kind: "verify", order }),
                  onDispute: () => setDialog({ kind: "dispute", orderId: order.id }),
                  onCancel: () => setDialog({ kind: "cancel", orderId: order.id }),
                }),
          }}
        />
      ))}
      {list.hasNextPage ? (
        <Button
          label={t("common.loadMore")}
          variant="ghost"
          loading={list.isFetchingNextPage}
          onPress={() => void list.fetchNextPage()}
        />
      ) : null}

      <OrderThreadModal orderId={threadOf} onClose={() => setThreadOf(null)} />
      <SecureFileViewer
        path={receiptOf ? `/deposit-orders/${receiptOf}/receipt` : null}
        title={t("cash.expenses.receipt")}
        onClose={() => setReceiptOf(null)}
      />
      {dialog?.kind === "report" ? <ReportDepositModal order={dialog.order} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "verify" ? <VerifyDepositModal order={dialog.order} onClose={() => setDialog(null)} /> : null}
      {dialog?.kind === "dispute" || dialog?.kind === "cancel" ? (
        <ReasonModal orderId={dialog.orderId} action={dialog.kind} onClose={() => setDialog(null)} />
      ) : null}
    </Stack>
  );
}
