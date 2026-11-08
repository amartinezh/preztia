import { useState } from "react";
import { Pressable } from "react-native";
import type { MyRouteStop, StopOutcome } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  DateField,
  Field,
  Input,
  Modal,
  MoneyInput,
  Row,
  Stack,
  Text,
  addDaysIso,
  nextWeekdayIso,
  todayIso,
} from "@preztiaos/ui";

import { moneyInputText } from "@/components/money-input-text";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { newIdempotencyKey } from "@/core/ids";
import { useResolveRouteStop } from "../api/queries";

const OUTCOMES: StopOutcome[] = ["PAID", "NOT_PAID", "PROMISE", "NOT_FOUND"];
// Día de la semana (0 = domingo) del chip "Lunes" en la promesa de pago.
const MONDAY = 1;

/**
 * Liquidar la visita: pagó (con el monto cobrado en efectivo, que entra a tu caja de ruta), no pagó
 * (con motivo), promesa de pago (con fecha) o no encontrado. Las reglas las valida el servidor.
 */
export function ResolveStopModal({ stop, onClose }: { stop: MyRouteStop; onClose: () => void }) {
  const { t } = useT();
  const resolve = useResolveRouteStop();
  const [outcome, setOutcome] = useState<StopOutcome>("PAID");
  const [amountText, setAmountText] = useState(moneyInputText(stop.amountToCollectMinor));
  const [amountMinor, setAmountMinor] = useState<number | null>(stop.amountToCollectMinor);
  const [reason, setReason] = useState("");
  const [promiseDate, setPromiseDate] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Clave estable por intento: un reintento manual tras perder la respuesta no abona dos veces.
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const paidAmountMissing = outcome === "PAID" && (amountMinor === null || amountMinor <= 0);
  const promiseDateMissing = outcome === "PROMISE" && promiseDate === null;
  // Fechas habituales de una promesa de pago (desde hoy; "Lunes" es el próximo).
  const today = todayIso();
  const promiseQuickOptions = [
    { label: t("common.today"), value: today },
    { label: t("date.tomorrow"), value: addDaysIso(today, 1) },
    { label: t("date.inTwoDays"), value: addDaysIso(today, 2) },
    { label: t("date.monday"), value: nextWeekdayIso(today, MONDAY) },
  ];

  const submit = () => {
    if (paidAmountMissing || promiseDateMissing) return;
    setError(null);
    resolve.mutate(
      {
        id: stop.id,
        idempotencyKey,
        outcome,
        ...(outcome === "PAID" && amountMinor !== null ? { collectedMinor: amountMinor } : {}),
        ...(outcome === "NOT_PAID" && reason.trim() ? { reason: reason.trim() } : {}),
        ...(outcome === "PROMISE" && promiseDate !== null ? { promiseDate } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          setIdempotencyKey(newIdempotencyKey());
          onClose();
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={stop.clientName} closeLabel={t("common.close")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Row gap="sm" className="flex-wrap">
          {OUTCOMES.map((o) => {
            const active = o === outcome;
            return (
              <Pressable
                key={o}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setOutcome(o)}
                className={`min-h-[40px] justify-center rounded-full border px-4 ${
                  active ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
                }`}
              >
                <Text variant="label" tone={active ? "primary" : "muted"}>
                  {t(`route.outcome.${o}`)}
                </Text>
              </Pressable>
            );
          })}
        </Row>
        {outcome === "PAID" ? (
          <Field label={t("route.resolve.collected")} hint={t("route.resolve.collectedHint")} required>
            <MoneyInput
              value={amountText}
              onChangeText={setAmountText}
              onChangeAmount={setAmountMinor}
              currency={stop.currency}
              invalidLabel={t("money.invalid")}
            />
          </Field>
        ) : null}
        {outcome === "NOT_PAID" ? (
          <Field label={t("route.resolve.reason")} required>
            <Input value={reason} onChangeText={setReason} multiline />
          </Field>
        ) : null}
        {outcome === "PROMISE" ? (
          <Field label={t("route.resolve.promiseDate")} required>
            <DateField
              value={promiseDate}
              onChange={setPromiseDate}
              min={today}
              quickOptions={promiseQuickOptions}
              invalidLabel={t("date.invalid")}
              accessibilityLabel={t("route.resolve.promiseDate")}
            />
          </Field>
        ) : null}
        <Field label={t("route.resolve.note")}>
          <Input value={note} onChangeText={setNote} multiline />
        </Field>
        <Button
          label={t("route.resolve.submit")}
          loading={resolve.isPending}
          disabled={paidAmountMissing || promiseDateMissing}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
  );
}
