import { useMemo, useState } from "react";
import type { CashTransactionRow } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Field,
  ListItem,
  MoneyText,
  Select,
  Spinner,
  Stack,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT } from "@/core/i18n";
import {
  useCashBoxes,
  useCashTransactions,
  type TransactionFilters,
} from "../api/boxes-queries";

type Kind = NonNullable<TransactionFilters["kind"]>;
const KINDS: readonly Kind[] = [
  "PAYMENT_IN",
  "WITHDRAWAL",
  "EXPENSE",
  "TRANSFER",
  "ADJUSTMENT",
  "UNIDENTIFIED",
];

/** Historial de movimientos con filtros por caja y tipo, paginado (Req 5). */
export function CashMovementsScreen() {
  const { t } = useT();
  const boxes = useCashBoxes();
  const [boxId, setBoxId] = useState("");
  const [kind, setKind] = useState("");

  const filters: TransactionFilters = useMemo(
    () => ({
      ...(boxId ? { cashBoxId: boxId } : {}),
      ...(kind ? { kind: kind as Kind } : {}),
    }),
    [boxId, kind],
  );
  const query = useCashTransactions(filters);

  const boxOptions: SelectOption<string>[] = [
    { value: "", label: t("cash.movements.all") },
    ...(boxes.data?.items ?? []).map((b) => ({ value: b.id, label: b.name })),
  ];
  const kindOptions: SelectOption<string>[] = [
    { value: "", label: t("cash.movements.allKinds") },
    ...KINDS.map((k) => ({ value: k, label: t(`cash.kind.${k}`) })),
  ];

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("cash.movements.title")}</Text>

        <Stack gap="sm">
          <Field label={t("cash.movements.all")}>
            <Select value={boxId} options={boxOptions} onChange={setBoxId} />
          </Field>
          <Field label={t("cash.movements.allKinds")}>
            <Select value={kind} options={kindOptions} onChange={setKind} />
          </Field>
        </Stack>

        {query.isPending ? <Spinner label={t("common.loading")} /> : null}
        {query.isError ? <Banner tone="danger" title={t("errors.network")} /> : null}

        {query.data ? (
          items.length ? (
            <Stack gap="xs">
              {items.map((tx) => (
                <MovementRow key={tx.id} tx={tx} />
              ))}
              {query.hasNextPage ? (
                <Button
                  label={t("cash.movements.more")}
                  variant="secondary"
                  loading={query.isFetchingNextPage}
                  block
                  onPress={() => void query.fetchNextPage()}
                />
              ) : null}
            </Stack>
          ) : (
            <Text tone="muted">{t("cash.movements.empty")}</Text>
          )
        ) : null}
      </Stack>
    </Screen>
  );
}

function MovementRow({ tx }: { tx: CashTransactionRow }) {
  const { t } = useT();
  return (
    <ListItem
      title={tx.boxName}
      subtitle={`${t(`cash.kind.${tx.kind}`)}${tx.reason ? ` · ${tx.reason}` : ""}`}
      trailing={
        <Stack gap="xs" className="items-end">
          <MoneyText
            variant="body"
            tone={tx.direction === "IN" ? "success" : "danger"}
            amountMinor={tx.amountMinor}
            currency={tx.currency}
          />
          <Badge label={new Date(tx.createdAt).toLocaleDateString()} tone="neutral" />
        </Stack>
      }
    />
  );
}
