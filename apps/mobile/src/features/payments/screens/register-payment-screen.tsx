import { useState } from "react";
import { useRouter } from "expo-router";
import { registerCashPaymentInput } from "@preztiaos/contracts";
import { Banner, Button, Field, Input, Stack, Text, majorToMinor } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useRegisterCashPayment } from "../api/queries";

export function RegisterPaymentScreen({ creditId }: { creditId: string }) {
  const { t } = useT();
  const router = useRouter();
  const register = useRegisterCashPayment();

  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  const onSubmit = () => {
    setError(null);
    setQueued(false);
    const candidate = { amountMinor: majorToMinor(Number(amount)) };
    const parsed = registerCashPaymentInput.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    register.mutate(
      { creditId, amountMinor: parsed.data.amountMinor },
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

        <Button label={t("payments.register")} loading={register.isPending} block onPress={onSubmit} />
      </Stack>
    </Screen>
  );
}
