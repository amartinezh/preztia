import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import { grantCreditInput, type GrantCreditInput } from "@preztiaos/contracts";
import { Banner, Button, Field, Input, Stack, Text, majorToMinor } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useGrantCredit } from "../api/queries";

type FieldErrors = Partial<Record<keyof GrantCreditInput, string>>;

// El dominio interpreta interestPct como base-mil (200 = 20%); la UI captura % simple y convierte.
const PERCENT_TO_BASE_THOUSAND = 10;

export function GrantCreditScreen() {
  const { t } = useT();
  const router = useRouter();
  const grant = useGrantCredit();

  const [borrowerId, setBorrowerId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const [installments, setInstallments] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = () => {
    setSubmitError(null);
    // Construir el candidato con conversión a unidades menores y base-mil del interés.
    const candidate = {
      borrowerId: borrowerId.trim(),
      zoneId: zoneId.trim(),
      principalMinor: majorToMinor(Number(principal)),
      interestPct: Number(interest) * PERCENT_TO_BASE_THOUSAND,
      installmentsCount: Math.trunc(Number(installments)),
    };
    const parsed = grantCreditInput.safeParse(candidate);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof GrantCreditInput | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    grant.mutate(parsed.data, {
      onSuccess: (res) => router.replace(`/credit/${res.id}` as Href),
      onError: (err) => setSubmitError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("credit.new.title")}</Text>

        {submitError ? <Banner tone="danger" title={submitError} /> : null}

        <Field label="Deudor (UUID)" error={errors.borrowerId} required>
          <Input autoCapitalize="none" value={borrowerId} onChangeText={setBorrowerId} invalid={!!errors.borrowerId} />
        </Field>
        <Field label="Zona (UUID)" error={errors.zoneId} required>
          <Input autoCapitalize="none" value={zoneId} onChangeText={setZoneId} invalid={!!errors.zoneId} />
        </Field>
        <Field label={t("credit.new.principal")} error={errors.principalMinor} hint="Monto en unidades mayores" required>
          <Input keyboardType="numeric" value={principal} onChangeText={setPrincipal} invalid={!!errors.principalMinor} />
        </Field>
        <Field label={t("credit.new.interest")} error={errors.interestPct} hint="20 = 20%" required>
          <Input keyboardType="numeric" value={interest} onChangeText={setInterest} invalid={!!errors.interestPct} />
        </Field>
        <Field label={t("credit.new.installments")} error={errors.installmentsCount} required>
          <Input keyboardType="number-pad" value={installments} onChangeText={setInstallments} invalid={!!errors.installmentsCount} />
        </Field>

        <Button label={t("credit.new.submit")} loading={grant.isPending} block onPress={onSubmit} />
      </Stack>
    </Screen>
  );
}
