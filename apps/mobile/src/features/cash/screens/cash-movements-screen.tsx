import { useMemo, useState } from "react";
import type { CashTransactionRow } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Field,
  Input,
  ListItem,
  MoneyText,
  Row,
  Select,
  Spinner,
  Stack,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useT } from "@/core/i18n";
import { useUsersList } from "@/features/users/api/queries";
import {
  useCashBoxes,
  useCashTransactions,
  type TransactionFilters,
} from "../api/boxes-queries";

type Kind = NonNullable<TransactionFilters["kind"]>;
const KINDS: readonly Kind[] = [
  "PAYMENT_IN",
  "DISBURSEMENT",
  "WITHDRAWAL",
  "EXPENSE",
  "TRANSFER",
  "ADJUSTMENT",
  "UNIDENTIFIED",
];

// Una fecha local YYYY-MM-DD se convierte al datetime ISO del contrato: el "desde" abarca el
// inicio del día y el "hasta", el fin, para un rango inclusivo. Cadenas inválidas se ignoran.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function dayToIso(day: string, endOfDay: boolean): string | undefined {
  if (!DATE_PATTERN.test(day)) return undefined;
  const iso = `${day}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

/** Historial de movimientos con filtros por caja, tipo, cobrador y rango de fechas (Req 5). */
export function CashMovementsScreen() {
  const { t } = useT();
  const boxes = useCashBoxes();
  const collectors = useUsersList("COLLECTOR");
  const [boxId, setBoxId] = useState("");
  const [kind, setKind] = useState("");
  const [collectorId, setCollectorId] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");

  const from = dayToIso(fromDay, false);
  const to = dayToIso(toDay, true);
  const filters: TransactionFilters = useMemo(
    () => ({
      ...(boxId ? { cashBoxId: boxId } : {}),
      ...(kind ? { kind: kind as Kind } : {}),
      ...(collectorId ? { collectorId } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    [boxId, kind, collectorId, from, to],
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
  const collectorOptions: SelectOption<string>[] = [
    { value: "", label: t("cash.movements.allCollectors") },
    ...(collectors.data?.pages.flatMap((p) => p.items) ?? []).map((u) => ({
      value: u.id,
      label: u.email,
    })),
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
          <Field label={t("cash.movements.allCollectors")}>
            <Select value={collectorId} options={collectorOptions} onChange={setCollectorId} />
          </Field>
          <Row className="gap-2">
            <Stack gap="xs" className="flex-1">
              <Field label={t("cash.movements.from")}>
                <Input
                  value={fromDay}
                  onChangeText={setFromDay}
                  placeholder={t("cash.movements.datePlaceholder")}
                  autoCapitalize="none"
                />
              </Field>
            </Stack>
            <Stack gap="xs" className="flex-1">
              <Field label={t("cash.movements.to")}>
                <Input
                  value={toDay}
                  onChangeText={setToDay}
                  placeholder={t("cash.movements.datePlaceholder")}
                  autoCapitalize="none"
                />
              </Field>
            </Stack>
          </Row>
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
