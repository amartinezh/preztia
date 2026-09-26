import { useState } from "react";
import { Pressable } from "react-native";
import type { MyRouteStop, StopOutcome } from "@preztiaos/contracts";
import { Banner, Button, Field, Input, majorToMinor, minorToMajor, Modal, Row, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useResolveRouteStop } from "../api/queries";

const OUTCOMES: StopOutcome[] = ["PAID", "NOT_PAID", "PROMISE", "NOT_FOUND"];

/**
 * Liquidar la visita: pagó (con el monto cobrado en efectivo, que entra a tu caja de ruta), no pagó
 * (con motivo), promesa de pago (con fecha) o no encontrado. Las reglas las valida el servidor.
 */
export function ResolveStopModal({ stop, onClose }: { stop: MyRouteStop; onClose: () => void }) {
  const { t } = useT();
  const resolve = useResolveRouteStop();
  const [outcome, setOutcome] = useState<StopOutcome>("PAID");
  const [amount, setAmount] = useState(String(minorToMajor(stop.amountToCollectMinor)));
  const [reason, setReason] = useState("");
  const [promiseDate, setPromiseDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    resolve.mutate(
      {
        id: stop.id,
        outcome,
        ...(outcome === "PAID" ? { collectedMinor: majorToMinor(Number(amount) || 0) } : {}),
        ...(outcome === "NOT_PAID" && reason.trim() ? { reason: reason.trim() } : {}),
        ...(outcome === "PROMISE" && promiseDate.trim() ? { promiseDate: promiseDate.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={stop.clientName}>
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
            <Input keyboardType="numeric" value={amount} onChangeText={setAmount} />
          </Field>
        ) : null}
        {outcome === "NOT_PAID" ? (
          <Field label={t("route.resolve.reason")} required>
            <Input value={reason} onChangeText={setReason} multiline />
          </Field>
        ) : null}
        {outcome === "PROMISE" ? (
          <Field label={t("route.resolve.promiseDate")} hint="AAAA-MM-DD" required>
            <Input value={promiseDate} onChangeText={setPromiseDate} />
          </Field>
        ) : null}
        <Field label={t("route.resolve.note")}>
          <Input value={note} onChangeText={setNote} multiline />
        </Field>
        <Button label={t("route.resolve.submit")} loading={resolve.isPending} block onPress={submit} />
      </Stack>
    </Modal>
  );
}
