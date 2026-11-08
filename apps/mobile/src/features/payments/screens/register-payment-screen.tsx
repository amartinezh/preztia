import { useState } from "react";
import { Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import type { AccountDetail } from "@preztiaos/contracts";
import { registerCashPaymentInput } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  Field,
  formatMoney,
  minorToMajor,
  MoneyInput,
  MoneyText,
  Row,
  Skeleton,
  Stack,
  Text,
  useToast,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { newIdempotencyKey } from "@/core/ids";
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

/** Texto editable a partir de un monto en unidades menores (coma decimal, sin ceros inútiles). */
function amountText(amountMinor: number): string {
  const major = minorToMajor(amountMinor);
  return Number.isInteger(major) ? String(major) : major.toFixed(2).replace(".", ",");
}

export function RegisterPaymentScreen({ creditId }: { creditId: string }) {
  const { t, tf } = useT();
  const router = useRouter();
  const toast = useToast();
  const { role } = useSession();
  const register = useRegisterCashPayment();
  const account = useAccountDetail(creditId);
  // El cobrador recibe en SU caja de ruta; quien no es cobrador (ADMIN/COORDINATOR) registra lo
  // que se pagó en la oficina y elige la caja o cuenta que lo recibe (de la zona del crédito).
  const isCollector = role === "COLLECTOR";

  const [amount, setAmount] = useState("");
  const [amountMinor, setAmountMinor] = useState<number | null>(null);
  // Día del pago elegido a mano (solo quien puede); null = hoy.
  const [paidOn, setPaidOn] = useState<string | null>(null);
  const [cashBoxId, setCashBoxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Una clave por intento de formulario: el reintento del mismo abono no duplica (ver hook).
  const [idempotencyKey] = useState(() => newIdempotencyKey());

  // El efectivo del cobrador entra a su caja de ruta. Sin caja el servidor rechaza el cobro, y la
  // cola offline descarta los rechazos: por eso se bloquea aquí, ANTES de encolar. Si no se pudo
  // consultar (sin señal y sin caché) no se bloquea: el servidor sigue siendo la guarda.
  const myCashBox = useMyCashBox();
  const noRouteBox = isCollector && myCashBox.data?.box === null;
  const missingReceivingBox = !isCollector && !cashBoxId;
  const blocked = noRouteBox || missingReceivingBox || amountMinor === null || amountMinor <= 0;

  const currency = account.data?.currency ?? "COP";

  const onSubmit = () => {
    if (amountMinor === null) return;
    setError(null);
    const parsed = registerCashPaymentInput.safeParse({
      amountMinor,
      ...(paidOn ? { paidOn } : {}),
      ...(!isCollector && cashBoxId ? { cashBoxId } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    register.mutate(
      {
        creditId,
        idempotencyKey,
        amountMinor: parsed.data.amountMinor,
        ...(parsed.data.paidOn ? { paidOn: parsed.data.paidOn } : {}),
        ...(parsed.data.cashBoxId ? { cashBoxId: parsed.data.cashBoxId } : {}),
      },
      {
        // En ambos casos se sale de la pantalla: dejar el formulario lleno invita a un segundo
        // toque "por si acaso". El toast dice qué pasó y, si entró en línea, el saldo que queda.
        onSuccess: (res) => {
          if (res.queued) {
            toast.show({ tone: "warning", title: t("payments.queued"), description: t("payments.queuedHint") });
          } else {
            toast.show({
              tone: "success",
              title: t("payments.success"),
              description: tf("payments.successBalance", { amount: formatMoney(res.balanceMinor, currency) }),
            });
          }
          router.back();
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("payments.register")}</Text>

        <CreditContextCard account={account.data ?? null} loading={account.isPending} />

        {noRouteBox ? <Banner tone="danger" title={t("payments.noRouteBox")} /> : null}
        {error ? <Banner tone="danger" title={error} /> : null}

        <Field label={t("common.amount")} hint={t("money.hint")} required>
          <MoneyInput
            value={amount}
            onChangeText={setAmount}
            onChangeAmount={setAmountMinor}
            currency={currency}
            invalidLabel={t("money.invalid")}
            accessibilityLabel={t("common.amount")}
            autoFocus
            selectTextOnFocus
          />
        </Field>

        {account.data ? (
          <QuickAmountChips
            account={account.data}
            onPick={(minor) => setAmount(amountText(minor))}
          />
        ) : null}

        {isCollector ? null : <ReceivingBoxField creditId={creditId} value={cashBoxId} onChange={setCashBoxId} />}

        <PaymentDateField value={paidOn} onChange={setPaidOn} />

        <Button
          label={t("payments.register")}
          loading={register.isPending}
          disabled={blocked}
          block
          onPress={onSubmit}
        />
        <Button label={t("common.cancel")} variant="ghost" block onPress={() => router.back()} />
      </Stack>
    </Screen>
  );
}

/**
 * A quién se le abona y cuánto debe: sin este contexto el cobrador registra a ciegas (cliente
 * equivocado, monto equivocado) y no puede decirle al cliente cuánto le queda.
 */
function CreditContextCard({ account, loading }: { account: AccountDetail | null; loading: boolean }) {
  const { t } = useT();
  if (loading && !account) {
    return (
      <Card>
        <Stack gap="sm">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </Stack>
      </Card>
    );
  }
  if (!account) return null;
  return (
    <Card>
      <Stack gap="sm">
        <Text variant="caption" tone="muted">
          {t("payments.context.client")}
        </Text>
        <Text variant="heading">{account.borrowerName ?? account.nationalId ?? account.creditId.slice(0, 8)}</Text>
        <Row className="justify-between">
          <Text tone="muted">{t("payments.context.dueToday")}</Text>
          <MoneyText variant="label" amountMinor={account.installmentValueMinor} currency={account.currency} />
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("payments.context.outstanding")}</Text>
          <MoneyText variant="label" amountMinor={account.outstandingMinor} currency={account.currency} />
        </Row>
        {account.daysOverdue > 0 ? (
          <Row className="justify-between">
            <Text tone="muted">{t("payments.context.daysOverdue")}</Text>
            <Text variant="label" tone="danger">
              {String(account.daysOverdue)}
            </Text>
          </Row>
        ) : null}
      </Stack>
    </Card>
  );
}

/** Montos de un toque: la cuota del día y el saldo total (lo más frecuente en campo). */
function QuickAmountChips({ account, onPick }: { account: AccountDetail; onPick: (minor: number) => void }) {
  const { t } = useT();
  const options = [
    { key: "due", label: t("payments.useDue"), minor: account.installmentValueMinor },
    { key: "outstanding", label: t("payments.useOutstanding"), minor: account.outstandingMinor },
  ].filter((o) => o.minor > 0);
  if (options.length === 0) return null;
  return (
    <Row gap="sm" className="flex-wrap">
      {options.map((o) => (
        <Pressable
          key={o.key}
          accessibilityRole="button"
          accessibilityLabel={`${o.label}: ${formatMoney(o.minor, account.currency)}`}
          onPress={() => onPick(o.minor)}
          className="min-h-[44px] justify-center rounded-full border border-zinc-200 px-4 active:bg-zinc-100 dark:border-zinc-700 dark:active:bg-zinc-800"
        >
          <View className="flex-row items-center gap-2">
            <Text variant="label" tone="muted">
              {o.label}
            </Text>
            <MoneyText variant="label" amountMinor={o.minor} currency={account.currency} />
          </View>
        </Pressable>
      ))}
    </Row>
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
