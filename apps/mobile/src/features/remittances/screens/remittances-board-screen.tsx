import { useState } from "react";
import type { DebtClosureType, RemittanceBoardRow } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  majorToMinor,
  minorToMajor,
  Modal,
  MoneyText,
  Row,
  Select,
  Spinner,
  Stack,
  Switch,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCashBoxes, useCashDashboard } from "@/features/cash/api/boxes-queries";
import {
  useCloseDebt,
  useReceiveRemittance,
  useRemittanceBoard,
  useRemittanceHistory,
} from "../api/queries";
import { ObligationBadge, RemittanceHistoryItem } from "../components/remittance-parts";
import { IssueDepositModal } from "@/features/deposit-orders/components/issue-deposit-modal";

/**
 * Tablero de RENDICIONES (ADMIN/COORDINATOR, acotado por zonas en el servidor): quién no ha
 * rendido y cuánto atraso lleva, el efectivo en la calle, las rendiciones por recibir (con conteo)
 * y la deuda arrastrada de cada cobrador. Solo el ADMIN cierra deuda (nómina o condonación).
 */
export function RemittancesBoardScreen() {
  const { t } = useT();
  const { role } = useSession();
  const [withDebt, setWithDebt] = useState(false);
  const [receiving, setReceiving] = useState<RemittanceBoardRow | null>(null);
  const [closing, setClosing] = useState<RemittanceBoardRow | null>(null);
  const [ordering, setOrdering] = useState<RemittanceBoardRow | null>(null);
  const board = useRemittanceBoard(withDebt);
  const rows = board.data?.pages.flatMap((p) => p.items) ?? [];
  // Moneda del tenant (la del libro) y nombres de cobrador para encabezar el historial.
  const currency = useCashDashboard().data?.currency ?? rows[0]?.currency ?? "";
  const collectorNames = new Map(rows.map((r) => [r.collectorId, r.collectorEmail ?? r.cashBoxName]));

  return (
    <Screen>
      <Stack gap="lg">
        <Switch value={withDebt} onValueChange={setWithDebt} label={t("remittance.board.withDebt")} />

        {board.isPending ? <Spinner label={t("common.loading")} /> : null}
        {!board.isPending && rows.length === 0 ? (
          <Text tone="muted">{t("remittance.board.empty")}</Text>
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
            <Text variant="label">{row.collectorEmail ?? row.cashBoxName}</Text>
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
            {t("remittance.declared")}: {minorToMajor(open.declaredMinor)} {row.currency} ·{" "}
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
 * el faltante queda como deuda del cobrador (se muestra antes de confirmar).
 */
function ReceiveModal({ row, onClose }: { row: RemittanceBoardRow; onClose: () => void }) {
  const { t } = useT();
  const receive = useReceiveRemittance();
  const boxes = useCashBoxes();
  const declared = row.openRemittance?.declaredMinor ?? 0;
  const [counted, setCounted] = useState(String(minorToMajor(declared)));
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Cajas de oficina: efectivo, activas y sin cobrador. El servidor valida además la zona.
  const officeOptions: SelectOption<string>[] = (boxes.data?.items ?? [])
    .filter((b) => b.type === "CASH" && b.active && b.assignedTo === null)
    .map((b) => ({ value: b.id, label: b.name }));
  const countedMinor = majorToMinor(Number(counted) || 0);
  const shortfallMinor = Math.max(0, row.cashInHandMinor - countedMinor);

  const submit = () => {
    if (!row.openRemittance) return;
    setError(null);
    receive.mutate(
      {
        id: row.openRemittance.id,
        countedMinor,
        ...(destinationId ? { destinationCashBoxId: destinationId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={t("remittance.receive.title")}>
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
        <Field label={t("remittance.counted")} required>
          <Input keyboardType="numeric" value={counted} onChangeText={setCounted} />
        </Field>
        {countedMinor > 0 ? (
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
            description={`${minorToMajor(shortfallMinor)} ${row.currency}`}
          />
        ) : null}
        <Field label={t("remittance.receive.note")}>
          <Input value={note} onChangeText={setNote} multiline />
        </Field>
        <Button
          label={t("remittance.receive.confirm")}
          loading={receive.isPending}
          disabled={countedMinor > 0 && !destinationId}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
  );
}

/** Cierre de deuda (solo ADMIN): nómina (se recupera) o condonación (pérdida), con motivo. */
function CloseDebtModal({ row, onClose }: { row: RemittanceBoardRow; onClose: () => void }) {
  const { t } = useT();
  const close = useCloseDebt();
  const [type, setType] = useState<DebtClosureType>("PAYROLL");
  const [amount, setAmount] = useState(String(minorToMajor(row.carriedDebtMinor)));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const typeOptions: SelectOption<DebtClosureType>[] = [
    { value: "PAYROLL", label: t("remittance.debt.PAYROLL"), hint: t("remittance.debt.PAYROLLHint") },
    { value: "WRITE_OFF", label: t("remittance.debt.WRITE_OFF"), hint: t("remittance.debt.WRITE_OFFHint") },
  ];

  const submit = () => {
    setError(null);
    close.mutate(
      {
        collectorId: row.collectorId,
        type,
        amountMinor: majorToMinor(Number(amount) || 0),
        reason: reason.trim(),
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={t("remittance.debt.title")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Row className="items-center justify-between">
          <Text tone="muted">{t("remittance.carriedDebt")}</Text>
          <MoneyText variant="label" amountMinor={row.carriedDebtMinor} currency={row.currency} />
        </Row>
        <Field label={t("remittance.debt.type")} required>
          <Select value={type} options={typeOptions} onChange={setType} />
        </Field>
        <Field label={t("common.amount")} required>
          <Input keyboardType="numeric" value={amount} onChangeText={setAmount} />
        </Field>
        <Field label={t("remittance.debt.reason")} required>
          <Input value={reason} onChangeText={setReason} multiline />
        </Field>
        <Button
          label={t("remittance.debt.confirm")}
          loading={close.isPending}
          disabled={reason.trim().length < 3}
          block
          onPress={submit}
        />
      </Stack>
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
