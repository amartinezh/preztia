import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import { registerMigratedCreditInput, type PlanFrequency } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  Row,
  Select,
  Stack,
  Text,
  majorToMinor,
  minorToMajor,
  type SelectOption,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useZonesList } from "@/features/zones/api/queries";
import { useRegisterMigratedCredit } from "../api/queries";
import { BorrowerPickerField, type SelectedBorrower } from "./grant-credit-screen";

// El interés viaja en base mil (200 = 20 %); la pantalla captura % simple.
const PERCENT_TO_BASE_THOUSAND = 10;

const FREQUENCIES: PlanFrequency[] = ["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"];

interface PaymentRow {
  key: number;
  paidOn: string;
  amount: string;
}

/**
 * CARGAR UN CRÉDITO MIGRADO del sistema anterior (solo ADMIN): deuda que ya existe, con su fecha de
 * inicio y los abonos que ya recibió. No sale dinero de ninguna caja ni entran hoy esos abonos; el
 * servidor calcula el cronograma desde la fecha de inicio y reparte los abonos en cascada.
 */
export function MigrateCreditScreen() {
  const { t } = useT();
  const router = useRouter();
  const migrate = useRegisterMigratedCredit();
  const zones = useZonesList();

  const [borrower, setBorrower] = useState<SelectedBorrower | null>(null);
  const [zoneId, setZoneId] = useState("");
  const [legacyReference, setLegacyReference] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const [installments, setInstallments] = useState("");
  const [frequency, setFrequency] = useState<PlanFrequency>("DAILY");
  const [startDate, setStartDate] = useState("");
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const zoneOptions: SelectOption<string>[] = (zones.data?.items ?? []).map((z) => ({ value: z.id, label: z.name, hint: z.path }));
  const frequencyOptions = FREQUENCIES.map((f) => ({ value: f, label: t(`migrate.frequency.${f}`) }));
  const paidTotalMinor = payments.reduce((acc, p) => acc + majorToMinor(Number(p.amount) || 0), 0);

  const addPayment = () => {
    setPayments((rows) => [...rows, { key: nextKey, paidOn: "", amount: "" }]);
    setNextKey((k) => k + 1);
  };
  const updatePayment = (key: number, patch: Partial<PaymentRow>) =>
    setPayments((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removePayment = (key: number) => setPayments((rows) => rows.filter((r) => r.key !== key));

  const submit = () => {
    setError(null);
    const parsed = registerMigratedCreditInput.safeParse({
      borrowerId: borrower?.id,
      zoneId,
      principalMinor: majorToMinor(Number(principal) || 0),
      interestPct: Math.round((Number(interest.replace(",", ".")) || 0) * PERCENT_TO_BASE_THOUSAND),
      installmentsCount: Math.trunc(Number(installments)),
      frequency,
      startDate: startDate.trim(),
      ...(legacyReference.trim() ? { legacyReference: legacyReference.trim() } : {}),
      payments: payments.map((p) => ({ paidOn: p.paidOn.trim(), amountMinor: majorToMinor(Number(p.amount) || 0) })),
    });
    if (!parsed.success) {
      setError(t("migrate.invalid"));
      return;
    }
    migrate.mutate(parsed.data, {
      onSuccess: (res) => router.replace(`/credit/${res.id}` as Href),
      onError: (err) =>
        setError(isApiError(err) ? (err.message && err.message !== err.messageKey ? err.message : t(err.messageKey)) : t("errors.unknown")),
    });
  };

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("migrate.title")}</Text>
        <Banner tone="info" title={t("migrate.intro")} />
        {error ? <Banner tone="danger" title={error} /> : null}

        <BorrowerPickerField selected={borrower} onSelect={setBorrower} />
        <Field label={t("credit.new.zone")} required>
          <Select value={zoneId || null} options={zoneOptions} onChange={setZoneId} placeholder={t("credit.new.zone.placeholder")} />
        </Field>
        <Field label={t("migrate.legacyReference")} hint={t("migrate.legacyReferenceHint")}>
          <Input value={legacyReference} onChangeText={setLegacyReference} />
        </Field>

        <Field label={t("credit.new.principal")} required>
          <Input keyboardType="numeric" value={principal} onChangeText={setPrincipal} />
        </Field>
        <Field label={t("credit.new.interest")} hint={t("migrate.interestHint")} required>
          <Input keyboardType="numeric" value={interest} onChangeText={setInterest} />
        </Field>
        <Row gap="sm">
          <Stack className="flex-1">
            <Field label={t("credit.new.installments")} required>
              <Input keyboardType="number-pad" value={installments} onChangeText={setInstallments} />
            </Field>
          </Stack>
          <Stack className="flex-1">
            <Field label={t("credit.new.frequency")} required>
              <Select value={frequency} options={frequencyOptions} onChange={setFrequency} />
            </Field>
          </Stack>
        </Row>
        <Field label={t("migrate.startDate")} hint={t("migrate.startDateHint")} required>
          <Input value={startDate} placeholder="AAAA-MM-DD" onChangeText={setStartDate} />
        </Field>

        <Card>
          <Stack gap="sm">
            <Text variant="heading">{t("migrate.payments")}</Text>
            <Text variant="caption" tone="muted">{t("migrate.paymentsHint")}</Text>
            {payments.map((p) => (
              <Row key={p.key} gap="sm" className="items-center">
                <Stack className="flex-1">
                  <Input value={p.paidOn} placeholder="AAAA-MM-DD" onChangeText={(v) => updatePayment(p.key, { paidOn: v })} />
                </Stack>
                <Stack className="flex-1">
                  <Input keyboardType="numeric" value={p.amount} placeholder={t("common.amount")} onChangeText={(v) => updatePayment(p.key, { amount: v })} />
                </Stack>
                <Button label="✕" variant="ghost" size="sm" onPress={() => removePayment(p.key)} />
              </Row>
            ))}
            <Button label={t("migrate.addPayment")} variant="secondary" size="sm" onPress={addPayment} />
            <Row className="justify-between">
              <Text tone="muted">{t("migrate.paidTotal")}</Text>
              <Text variant="label">{minorToMajor(paidTotalMinor).toLocaleString()}</Text>
            </Row>
          </Stack>
        </Card>

        <Button label={t("migrate.submit")} loading={migrate.isPending} disabled={!borrower || !zoneId} block onPress={submit} />
      </Stack>
    </Screen>
  );
}
