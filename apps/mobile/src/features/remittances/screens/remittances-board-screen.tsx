import { useState } from "react";
import { Pressable } from "react-native";
import type { DebtClosureType, RemittanceBoardRow, RemittanceObligationStatus } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  ConfirmModal,
  Field,
  formatMoney,
  Input,
  Modal,
  MoneyInput,
  MoneyText,
  Row,
  Select,
  Spinner,
  Stack,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { moneyInputText } from "@/components/money-input-text";
import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT, type MessageKey } from "@/core/i18n";
import { useCashBoxes, useCashDashboard } from "@/features/cash/api/boxes-queries";
import {
  useCloseDebt,
  useReceiveRemittance,
  useRemittanceBoard,
  useRemittanceHistory,
} from "../api/queries";
import { ObligationBadge, RemittanceHistoryItem } from "../components/remittance-parts";
import { IssueDepositModal } from "@/features/deposit-orders/components/issue-deposit-modal";

// Chips del tablero: se clasifica en cliente con los campos que ya trae cada fila.
type BoardFilter = "all" | "awaiting" | "late" | "upToDate" | "withDebt";
const BOARD_FILTERS: readonly BoardFilter[] = ["all", "awaiting", "late", "upToDate", "withDebt"];
const FILTER_LABEL: Record<BoardFilter, MessageKey> = {
  all: "remittance.board.filter.all",
  awaiting: "remittance.board.filter.awaiting",
  late: "remittance.board.filter.late",
  upToDate: "remittance.board.filter.upToDate",
  withDebt: "remittance.board.filter.withDebt",
};
// Orden del tablero: primero lo que espera al coordinador (recibir), luego los atrasos.
const STATUS_RANK: Record<RemittanceObligationStatus, number> = {
  AWAITING_RECEPTION: 0,
  LATE: 1,
  PENDING: 2,
  UP_TO_DATE: 3,
};

function matchesFilter(row: RemittanceBoardRow, filter: BoardFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "awaiting":
      return row.status === "AWAITING_RECEPTION";
    case "late":
      return row.status === "LATE";
    case "upToDate":
      // Sin atraso ni entrega por recibir: PENDING todavía está dentro de su hora límite.
      return row.status === "UP_TO_DATE" || row.status === "PENDING";
    case "withDebt":
      return row.carriedDebtMinor > 0;
  }
}

/** Nombre visible del cobrador: su nombre; si no, el correo; si no, el nombre de su caja. */
function collectorLabel(row: RemittanceBoardRow): string {
  return row.collectorName ?? row.collectorEmail ?? row.cashBoxName;
}

/**
 * Tablero de ENTREGAS de cobradores (ADMIN/COORDINATOR, acotado por zonas en el servidor): quién
 * no ha entregado y cuánto atraso lleva, el efectivo en la calle, las entregas por recibir (con
 * conteo) y la deuda arrastrada de cada cobrador. Los totales y los chips se calculan sobre lo
 * cargado (paginado) y lo dicen; los "por recibir" van primero. Solo el ADMIN cierra deuda.
 */
export function RemittancesBoardScreen() {
  const { t, tf } = useT();
  const { role } = useSession();
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [receiving, setReceiving] = useState<RemittanceBoardRow | null>(null);
  const [closing, setClosing] = useState<RemittanceBoardRow | null>(null);
  const [ordering, setOrdering] = useState<RemittanceBoardRow | null>(null);
  const board = useRemittanceBoard(false);
  const loaded = board.data?.pages.flatMap((p) => p.items) ?? [];
  const rows = [...loaded]
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
    .filter((row) => matchesFilter(row, filter));
  // Moneda del tenant (la del libro) y nombres de cobrador para encabezar el historial.
  const currency = useCashDashboard().data?.currency ?? loaded[0]?.currency ?? "";
  const collectorNames = new Map(loaded.map((r) => [r.collectorId, collectorLabel(r)]));
  const cashTotalMinor = loaded.reduce((sum, r) => sum + r.cashInHandMinor, 0);
  const debtTotalMinor = loaded.reduce((sum, r) => sum + r.carriedDebtMinor, 0);

  return (
    <Screen>
      <Stack gap="lg">
        {loaded.length > 0 ? (
          <Card>
            <Stack gap="xs">
              <Row className="items-center justify-between">
                <Text tone="muted">{t("remittance.board.totals.cash")}</Text>
                <MoneyText variant="label" amountMinor={cashTotalMinor} currency={currency} />
              </Row>
              <Row className="items-center justify-between">
                <Text tone={debtTotalMinor > 0 ? "danger" : "muted"}>{t("remittance.board.totals.debt")}</Text>
                <MoneyText
                  variant="label"
                  tone={debtTotalMinor > 0 ? "danger" : "default"}
                  amountMinor={debtTotalMinor}
                  currency={currency}
                />
              </Row>
              <Text variant="caption" tone="muted">
                {tf("remittance.board.totals.of", { n: loaded.length })}
              </Text>
            </Stack>
          </Card>
        ) : null}

        <Row gap="sm" className="flex-wrap">
          {BOARD_FILTERS.map((f) => {
            const active = f === filter;
            return (
              <Pressable
                key={f}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(f)}
                className={`min-h-[36px] justify-center rounded-full border px-3 ${
                  active ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <Text variant="caption" tone={active ? "primary" : "muted"}>
                  {t(FILTER_LABEL[f])}
                </Text>
              </Pressable>
            );
          })}
        </Row>

        {board.isPending ? <Spinner label={t("common.loading")} /> : null}
        {!board.isPending && loaded.length === 0 ? (
          <Text tone="muted">{t("remittance.board.empty")}</Text>
        ) : null}
        {!board.isPending && loaded.length > 0 && rows.length === 0 ? (
          <Text tone="muted">{t("remittance.board.filterEmpty")}</Text>
        ) : null}
        {rows.map((row) => (
          <BoardCard
            key={row.cashBoxId}
            row={row}
            canCloseDebt={role === "ADMIN"}
            onReceive={() => setReceiving(row)}
            onCloseDebt={() => setClosing(row)}
            onOrderDeposit={() => setOrdering(row)}
          />
        ))}
        {board.hasNextPage ? (
          <Button
            label={t("common.loadMore")}
            variant="ghost"
            loading={board.isFetchingNextPage}
            onPress={() => void board.fetchNextPage()}
          />
        ) : null}

        <Text variant="heading">{t("remittance.history")}</Text>
        <ScopeHistory currency={currency} collectorNames={collectorNames} />
      </Stack>

      {receiving ? <ReceiveModal row={receiving} onClose={() => setReceiving(null)} /> : null}
      {closing ? <CloseDebtModal row={closing} onClose={() => setClosing(null)} /> : null}
      {ordering ? <IssueDepositModal row={ordering} onClose={() => setOrdering(null)} /> : null}
    </Screen>
  );
}

function BoardCard({
  row,
  canCloseDebt,
  onReceive,
  onCloseDebt,
  onOrderDeposit,
}: {
  row: RemittanceBoardRow;
  canCloseDebt: boolean;
  onReceive: () => void;
  onCloseDebt: () => void;
  onOrderDeposit: () => void;
}) {
  const { t } = useT();
  const open = row.openRemittance;
  return (
    <Card>
      <Stack gap="xs">
        <Row className="items-center justify-between">
          <Stack gap="xs" className="flex-1 pr-2">
            <Text variant="label">{collectorLabel(row)}</Text>
            <Text variant="caption" tone="muted">
              {row.cashBoxName}
              {row.zoneName ? ` · ${row.zoneName}` : ""}
            </Text>
          </Stack>
          <ObligationBadge status={row.status} lateMinutes={row.lateMinutes} dueAt={row.dueAt} />
        </Row>
        <Row className="items-center justify-between">
          <Text tone="muted">{t("remittance.cashInHand")}</Text>
          <MoneyText amountMinor={row.cashInHandMinor} currency={row.currency} />
        </Row>
        {row.carriedDebtMinor > 0 ? (
          <Row className="items-center justify-between">
            <Text tone="danger">{t("remittance.carriedDebt")}</Text>
            <MoneyText amountMinor={row.carriedDebtMinor} currency={row.currency} />
          </Row>
        ) : null}
        {open ? (
          <Text variant="caption" tone="muted">
            {t("remittance.declared")}: {formatMoney(open.declaredMinor, row.currency)} ·{" "}
            {new Date(open.submittedAt).toLocaleString()}
            {open.collectorNote ? ` · ${open.collectorNote}` : ""}
          </Text>
        ) : null}
        <Row gap="sm" className="flex-wrap">
          {open ? <Button label={t("remittance.receive.action")} size="sm" onPress={onReceive} /> : null}
          {row.cashInHandMinor > 0 ? (
            <Button label={t("deposit.issue.action")} size="sm" variant="secondary" onPress={onOrderDeposit} />
          ) : null}
          {canCloseDebt && row.carriedDebtMinor > 0 && !open ? (
            <Button label={t("remittance.debt.action")} size="sm" variant="secondary" onPress={onCloseDebt} />
          ) : null}
        </Row>
      </Stack>
    </Card>
  );
}

/**
 * Recepción con conteo: lo contado entra a la caja de oficina elegida; si es menos de lo esperado,
 * el faltante queda como deuda del cobrador. Recibir con 0 o con faltante convierte efectivo del
 * cobrador en deuda y queda sellado: ambos casos exigen confirmación explícita antes de enviar.
 */
function ReceiveModal({ row, onClose }: { row: RemittanceBoardRow; onClose: () => void }) {
  const { t, tf } = useT();
  const receive = useReceiveRemittance();
  const boxes = useCashBoxes();
  const declared = row.openRemittance?.declaredMinor ?? 0;
  const [countedText, setCountedText] = useState(moneyInputText(declared));
  const [countedMinor, setCountedMinor] = useState<number | null>(declared);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cajas de oficina: efectivo, activas y sin cobrador. El servidor valida además la zona.
  const officeOptions: SelectOption<string>[] = (boxes.data?.items ?? [])
    .filter((b) => b.type === "CASH" && b.active && b.assignedTo === null)
    .map((b) => ({ value: b.id, label: b.name }));
  const shortfallMinor = countedMinor === null ? 0 : Math.max(0, row.cashInHandMinor - countedMinor);
  // El destino solo hace falta si entra efectivo; con 0 no hay nada que guardar en una caja.
  const needsDestination = countedMinor !== null && countedMinor > 0;
  const canSubmit = countedMinor !== null && (!needsDestination || destinationId !== null);
  const money = (minor: number) => formatMoney(minor, row.currency);

  const send = () => {
    if (!row.openRemittance || countedMinor === null) return;
    receive.mutate(
      {
        id: row.openRemittance.id,
        countedMinor,
        ...(destinationId ? { destinationCashBoxId: destinationId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: onClose,
        onError: (err) => {
          setConfirming(false);
          setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));
        },
      },
    );
  };

  const submit = () => {
    if (countedMinor === null) return;
    setError(null);
    // Con 0 o con faltante el efectivo pasa a deuda del cobrador: se confirma antes de sellar.
    if (countedMinor === 0 || shortfallMinor > 0) {
      setConfirming(true);
      return;
    }
    send();
  };

  return (
    <Modal visible onClose={onClose} title={t("remittance.receive.title")} closeLabel={t("common.close")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Row className="items-center justify-between">
          <Text tone="muted">{t("remittance.receive.expected")}</Text>
          <MoneyText variant="label" amountMinor={row.cashInHandMinor} currency={row.currency} />
        </Row>
        <Row className="items-center justify-between">
          <Text tone="muted">{t("remittance.declared")}</Text>
          <MoneyText amountMinor={declared} currency={row.currency} />
        </Row>
        <Field label={t("remittance.counted")} hint={t("money.hint")} required>
          <MoneyInput
            value={countedText}
            onChangeText={setCountedText}
            onChangeAmount={setCountedMinor}
            currency={row.currency}
            invalidLabel={t("money.invalid")}
          />
        </Field>
        {needsDestination ? (
          <Field label={t("remittance.receive.destination")} required>
            <Select
              value={destinationId}
              options={officeOptions}
              onChange={setDestinationId}
              placeholder={t("remittance.receive.destinationPlaceholder")}
            />
          </Field>
        ) : null}
        {shortfallMinor > 0 ? (
          <Banner
            tone="warning"
            title={t("remittance.receive.shortfallWarning")}
            description={money(shortfallMinor)}
          />
        ) : null}
        <Field label={t("remittance.receive.note")}>
          <Input value={note} onChangeText={setNote} multiline />
        </Field>
        <Button
          label={t("remittance.receive.confirm")}
          loading={receive.isPending}
          disabled={!canSubmit}
          block
          onPress={submit}
        />
      </Stack>
      <ConfirmModal
        visible={confirming}
        title={countedMinor === 0 ? t("remittance.receive.zeroTitle") : t("remittance.receive.shortfallTitle")}
        description={
          countedMinor === 0
            ? tf("remittance.receive.zeroBody", { expected: money(row.cashInHandMinor) })
            : tf("remittance.receive.shortfallBody", {
                counted: money(countedMinor ?? 0),
                expected: money(row.cashInHandMinor),
                shortfall: money(shortfallMinor),
              })
        }
        confirmLabel={t("remittance.receive.confirm")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        loading={receive.isPending}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
        closeLabel={t("common.close")}
      />
    </Modal>
  );
}

/**
 * Cierre de deuda (solo ADMIN): nómina (se recupera) o condonación (pérdida), con motivo. Condonar
 * borra deuda del cobrador y no se puede deshacer: exige confirmación explícita.
 */
function CloseDebtModal({ row, onClose }: { row: RemittanceBoardRow; onClose: () => void }) {
  const { t, tf } = useT();
  const close = useCloseDebt();
  const [type, setType] = useState<DebtClosureType>("PAYROLL");
  const [amountText, setAmountText] = useState(moneyInputText(row.carriedDebtMinor));
  const [amountMinor, setAmountMinor] = useState<number | null>(row.carriedDebtMinor);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typeOptions: SelectOption<DebtClosureType>[] = [
    { value: "PAYROLL", label: t("remittance.debt.PAYROLL"), hint: t("remittance.debt.PAYROLLHint") },
    { value: "WRITE_OFF", label: t("remittance.debt.WRITE_OFF"), hint: t("remittance.debt.WRITE_OFFHint") },
  ];

  const send = () => {
    if (amountMinor === null) return;
    close.mutate(
      {
        collectorId: row.collectorId,
        type,
        amountMinor,
        reason: reason.trim(),
      },
      {
        onSuccess: onClose,
        onError: (err) => {
          setConfirming(false);
          setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));
        },
      },
    );
  };

  const submit = () => {
    setError(null);
    // La nómina se recupera y va directo; la condonación es pérdida irreversible: se confirma.
    if (type === "WRITE_OFF") {
      setConfirming(true);
      return;
    }
    send();
  };

  return (
    <Modal visible onClose={onClose} title={t("remittance.debt.title")} closeLabel={t("common.close")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Row className="items-center justify-between">
          <Text tone="muted">{t("remittance.carriedDebt")}</Text>
          <MoneyText variant="label" amountMinor={row.carriedDebtMinor} currency={row.currency} />
        </Row>
        <Field label={t("remittance.debt.type")} required>
          <Select value={type} options={typeOptions} onChange={setType} />
        </Field>
        <Field label={t("common.amount")} hint={t("money.hint")} required>
          <MoneyInput
            value={amountText}
            onChangeText={setAmountText}
            onChangeAmount={setAmountMinor}
            currency={row.currency}
            invalidLabel={t("money.invalid")}
          />
        </Field>
        <Field label={t("remittance.debt.reason")} required>
          <Input value={reason} onChangeText={setReason} multiline />
        </Field>
        <Button
          label={t("remittance.debt.confirm")}
          loading={close.isPending}
          disabled={reason.trim().length < 3 || amountMinor === null || amountMinor <= 0}
          block
          onPress={submit}
        />
      </Stack>
      <ConfirmModal
        visible={confirming}
        title={t("remittance.forgive.confirmTitle")}
        description={tf("remittance.forgive.confirmBody", { amount: formatMoney(amountMinor ?? 0, row.currency) })}
        confirmLabel={t("remittance.debt.confirm")}
        cancelLabel={t("common.cancel")}
        tone="danger"
        loading={close.isPending}
        onConfirm={send}
        onCancel={() => setConfirming(false)}
        closeLabel={t("common.close")}
      />
    </Modal>
  );
}

function ScopeHistory({
  currency,
  collectorNames,
}: {
  currency: string;
  collectorNames: Map<string, string>;
}) {
  const { t } = useT();
  const history = useRemittanceHistory(null);
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];
  if (history.isPending) return <Spinner label={t("common.loading")} />;
  if (items.length === 0) return <Text tone="muted">{t("remittance.historyEmpty")}</Text>;
  return (
    <Stack gap="sm">
      {items.map((r) => (
        <RemittanceHistoryItem
          key={r.id}
          remittance={r}
          currency={currency}
          title={`${collectorNames.get(r.collectorId) ?? t("remittance.collector")} · ${r.businessDate}`}
        />
      ))}
      {history.hasNextPage ? (
        <Button
          label={t("common.loadMore")}
          variant="ghost"
          loading={history.isFetchingNextPage}
          onPress={() => void history.fetchNextPage()}
        />
      ) : null}
    </Stack>
  );
}
