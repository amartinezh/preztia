import { useState } from "react";
import type { Expense, ExpenseStatus } from "@preztiaos/contracts";
import { Button, Row, Spinner, Stack, Text } from "@preztiaos/ui";
import { Pressable } from "react-native";

import { SecureFileViewer } from "@/components/secure-file-viewer";
import { useT } from "@/core/i18n";
import { useExpensesList } from "../../api/queries";
import { ExpenseCard } from "./expense-card";
import { ExpenseReviewModal } from "./expense-review-modal";

const FILTERS: (ExpenseStatus | undefined)[] = ["PENDING", "APPROVED", "REJECTED", undefined];

/**
 * Lista de gastos con su historial completo. `mode="mine"`: el cobrador ve sus solicitudes (el
 * servidor ya las acota a él). `mode="review"`: la bandeja del coordinador/ADMIN dentro de su zona,
 * con quién lo pidió y la revisión. En ambos se abre el comprobante descifrado.
 */
export function ExpensesPanel({ mode, currency }: { mode: "mine" | "review"; currency: string }) {
  const { t } = useT();
  const [status, setStatus] = useState<ExpenseStatus | undefined>(mode === "review" ? "PENDING" : undefined);
  const [receiptOf, setReceiptOf] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<Expense | null>(null);
  const list = useExpensesList(status);
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

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
                {f ? t(`cash.status.${f}`) : t("cash.expenses.filterAll")}
              </Text>
            </Pressable>
          );
        })}
      </Row>

      {list.isPending ? <Spinner label={t("common.loading")} /> : null}
      {!list.isPending && items.length === 0 ? <Text tone="muted">{t("cash.expenses.empty")}</Text> : null}
      {items.map((e) => (
        <ExpenseCard
          key={e.id}
          expense={e}
          currency={currency}
          showRequester={mode === "review"}
          onViewReceipt={() => setReceiptOf(e.id)}
          {...(mode === "review" ? { onReview: () => setReviewing(e) } : {})}
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

      <SecureFileViewer
        path={receiptOf ? `/expenses/${receiptOf}/receipt` : null}
        title={t("cash.expenses.receipt")}
        onClose={() => setReceiptOf(null)}
      />
      {reviewing ? (
        <ExpenseReviewModal expense={reviewing} currency={currency} onClose={() => setReviewing(null)} />
      ) : null}
    </Stack>
  );
}
