import { useMemo, useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { BorrowerSummary, CashTransactionRow } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  ListItem,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { useT, type MessageKey } from "@/core/i18n";
import { useBorrowersList } from "@/features/borrowers/api/queries";
import { useCashTransactions } from "@/features/cash/api/boxes-queries";

/**
 * Movimientos por cliente (#3c): el libro de INGRESOS (abonos que paga) y EGRESOS (desembolsos
 * que recibe) que causa un cliente. Primero se elige el cliente; luego se ve su ledger con el
 * neto. Reusa el read-model de movimientos de caja filtrado por `borrowerId` (backend), así el
 * dinero sigue teniendo una sola fuente de verdad (libro de cajas).
 */
export function ClientMovementsScreen() {
  const [selected, setSelected] = useState<BorrowerSummary | null>(null);

  if (!selected) return <ClientPicker onPick={setSelected} />;
  return <ClientLedger borrower={selected} onChange={() => setSelected(null)} />;
}

/** Paso 1: elegir el cliente cuyos movimientos se quieren ver (búsqueda por nombre). */
function ClientPicker({ onPick }: { onPick: (borrower: BorrowerSummary) => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const query = useBorrowersList({ ...(name.trim() ? { name: name.trim() } : {}) });
  const items = query.data?.items ?? [];

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(b) => b.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        ListHeaderComponent={
          <Stack gap="sm" className="pb-2">
            <Text variant="subtitle">{t("clientMovements.title")}</Text>
            <Text variant="caption" tone="muted">
              {t("clientMovements.pickClient")}
            </Text>
            <Input value={name} onChangeText={setName} placeholder={t("clientMovements.search")} />
          </Stack>
        }
        ListEmptyComponent={
          query.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <Text tone="muted">{t("borrowers.list.empty")}</Text>
          )
        }
        renderItem={({ item }) => (
          <ListItem
            title={`${item.firstName} ${item.lastName}`.trim()}
            subtitle={[item.nationalId, item.phone].filter(Boolean).join(" · ") || item.id.slice(0, 8)}
            onPress={() => onPick(item)}
          />
        )}
      />
    </SafeAreaView>
  );
}

/** Paso 2: ledger del cliente — resumen de ingresos/egresos/neto + lista de movimientos. */
function ClientLedger({
  borrower,
  onChange,
}: {
  borrower: BorrowerSummary;
  onChange: () => void;
}) {
  const { t } = useT();
  const query = useCashTransactions({ borrowerId: borrower.id });
  const items = useMemo<CashTransactionRow[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  // El neto se calcula sobre los movimientos CARGADOS; solo es total exacto cuando no hay más
  // páginas (`allLoaded`). En ese caso el hint desaparece.
  const totals = useMemo(() => {
    let inMinor = 0;
    let outMinor = 0;
    for (const tx of items) {
      if (tx.direction === "IN") inMinor += tx.amountMinor;
      else outMinor += tx.amountMinor;
    }
    return { inMinor, outMinor, netMinor: inMinor - outMinor };
  }, [items]);
  const currency = items[0]?.currency ?? "BRL";
  const allLoaded = !query.hasNextPage;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(tx) => tx.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        onEndReachedThreshold={0.5}
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        ListHeaderComponent={
          <Stack gap="sm" className="pb-2">
            <Row className="justify-between items-center">
              <Stack gap="none">
                <Text variant="subtitle">{`${borrower.firstName} ${borrower.lastName}`.trim()}</Text>
                <Text variant="caption" tone="muted">
                  {t("clientMovements.title")}
                </Text>
              </Stack>
              <Button
                label={t("clientMovements.change")}
                variant="ghost"
                size="sm"
                onPress={onChange}
              />
            </Row>
            {query.isError ? <Banner tone="danger" title={t("errors.network")} /> : null}
            {items.length > 0 ? (
              <Card>
                <Stack gap="xs">
                  <Row className="justify-between">
                    <Text tone="muted">{t("clientMovements.income")}</Text>
                    <MoneyText variant="label" tone="success" amountMinor={totals.inMinor} currency={currency} />
                  </Row>
                  <Row className="justify-between">
                    <Text tone="muted">{t("clientMovements.expenses")}</Text>
                    <MoneyText variant="label" tone="danger" amountMinor={totals.outMinor} currency={currency} />
                  </Row>
                  <Row className="justify-between">
                    <Text variant="label">{t("clientMovements.net")}</Text>
                    <MoneyText variant="label" amountMinor={totals.netMinor} currency={currency} />
                  </Row>
                  {allLoaded ? null : (
                    <Text variant="caption" tone="muted">
                      {t("clientMovements.partialHint")}
                    </Text>
                  )}
                </Stack>
              </Card>
            ) : null}
          </Stack>
        }
        ListEmptyComponent={
          query.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <EmptyState title={t("clientMovements.empty")} />
          )
        }
        renderItem={({ item }) => <MovementRow tx={item} />}
        ListFooterComponent={query.isFetchingNextPage ? <Spinner /> : null}
      />
    </SafeAreaView>
  );
}

/** Fila de movimiento: tipo (Abono/Desembolso), caja origen y monto coloreado por sentido. */
function MovementRow({ tx }: { tx: CashTransactionRow }) {
  const { t } = useT();
  return (
    <ListItem
      title={t(`cash.kind.${tx.kind}` as MessageKey)}
      subtitle={`${tx.boxName}${tx.reason ? ` · ${tx.reason}` : ""}`}
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
