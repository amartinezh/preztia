import { useState } from "react";
import { useRouter } from "expo-router";
import { registerCashPaymentInput } from "@preztiaos/contracts";
import { Banner, Button, Field, Input, Stack, Text, majorToMinor } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useAccountDetail } from "@/features/accounts/api/queries";
import { useMyCashBox } from "@/features/cash/api/boxes-queries";
import { FundingBoxPicker } from "@/features/cash/components/funding-box-picker";
import { useRegisterCashPayment } from "../api/queries";
import { PaymentDateField } from "../components/payment-date-field";

/** Textos del selector cuando elige la caja que RECIBE el pago (no de la que sale un préstamo). */
const RECEIVING_BOX_KEYS = {
  label: "payments.receivingBox",
  hint: "payments.receivingBoxHint",
  empty: "payments.receivingBoxEmpty",
} as const;

export function RegisterPaymentScreen({ creditId }: { creditId: string }) {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const register = useRegisterCashPayment();
  // El cobrador recibe en SU caja de ruta; quien no es cobrador (ADMIN/COORDINATOR) registra lo
  // que se pagó en la oficina y elige la caja o cuenta que lo recibe (de la zona del crédito).
  const isCollector = role === "COLLECTOR";

  const [amount, setAmount] = useState("");
  // Día del pago elegido a mano (solo quien puede); null = hoy.
  const [paidOn, setPaidOn] = useState<string | null>(null);
  const [cashBoxId, setCashBoxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  // El efectivo del cobrador entra a su caja de ruta. Sin caja el servidor rechaza el cobro, y la
  // cola offline descarta los rechazos: por eso se bloquea aquí, ANTES de encolar. Si no se pudo
  // consultar (sin señal y sin caché) no se bloquea: el servidor sigue siendo la guarda.
  const myCashBox = useMyCashBox();
  const noRouteBox = isCollector && myCashBox.data?.box === null;
  const blocked = isCollector ? noRouteBox : !cashBoxId;

  const onSubmit = () => {
    setError(null);
    setQueued(false);
    const candidate = {
      amountMinor: majorToMinor(Number(amount)),
      ...(paidOn ? { paidOn } : {}),
      ...(!isCollector && cashBoxId ? { cashBoxId } : {}),
    };
    const parsed = registerCashPaymentInput.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    register.mutate(
      {
        creditId,
        amountMinor: parsed.data.amountMinor,
        ...(parsed.data.paidOn ? { paidOn: parsed.data.paidOn } : {}),
        ...(parsed.data.cashBoxId ? { cashBoxId: parsed.data.cashBoxId } : {}),
      },
      {
        onSuccess: (res) => {
          if (res.queued) setQueued(true);
          else router.back();
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("payments.register")}</Text>

        {noRouteBox ? <Banner tone="danger" title={t("payments.noRouteBox")} /> : null}
        {queued ? <Banner tone="warning" title={t("common.offlineBanner")} /> : null}
        {error ? <Banner tone="danger" title={error} /> : null}

        <Field label={t("common.amount")} hint="Monto en unidades mayores" required>
          <Input
            keyboardType="numeric"
            value={amount}
            onChangeText={setAmount}
            invalid={!!error}
            accessibilityLabel={t("common.amount")}
          />
        </Field>

        {isCollector ? null : <ReceivingBoxField creditId={creditId} value={cashBoxId} onChange={setCashBoxId} />}

        <PaymentDateField value={paidOn} onChange={setPaidOn} />

        <Button
          label={t("payments.register")}
          loading={register.isPending}
          disabled={blocked}
          block
          onPress={onSubmit}
        />
      </Stack>
    </Screen>
  );
}

/** Caja de oficina o cuenta que recibe el pago: las que la zona del crédito puede usar. */
function ReceivingBoxField({
  creditId,
  value,
  onChange,
}: {
  creditId: string;
  value: string | null;
  onChange: (boxId: string) => void;
}) {
  const account = useAccountDetail(creditId);
  return (
    <FundingBoxPicker
      zoneId={account.data?.zoneId ?? null}
      value={value}
      onChange={onChange}
      amountMinor={0}
      keys={RECEIVING_BOX_KEYS}
    />
  );
}
