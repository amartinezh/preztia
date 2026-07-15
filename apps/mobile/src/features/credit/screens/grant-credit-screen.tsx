import { useState } from "react";
import { Pressable } from "react-native";
import { useRouter, type Href } from "expo-router";
import {
  createBorrowerInput,
  grantCreditInput,
  type BorrowerSummary,
  type GrantCreditInput,
  type PlanFrequency,
} from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Field,
  Input,
  ListItem,
  majorToMinor,
  Modal,
  Select,
  Spinner,
  Stack,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useBorrowersList, useCreateBorrower } from "@/features/borrowers/api/queries";
import { usePaymentPlans } from "@/features/payment-plans/api/queries";
import { useZonesList } from "@/features/zones/api/queries";
import { useGrantCredit } from "../api/queries";

type FieldErrors = Partial<Record<keyof GrantCreditInput, string>>;

// Datos mínimos del deudor que la pantalla necesita para mostrar y validar cupo/bloqueo.
type SelectedBorrower = Pick<
  BorrowerSummary,
  "id" | "nationalId" | "firstName" | "lastName" | "business" | "phone" | "creditBlocked" | "creditLimitMinor"
>;

// El dominio interpreta interestPct como base-mil (200 = 20%); la UI captura % simple y convierte.
const PERCENT_TO_BASE_THOUSAND = 10;
const toPercent = (baseThousand: number) => baseThousand / 10;

// Valor centinela del selector de plan cuando el otorgamiento es libre (sin plantilla).
const CUSTOM_PLAN = "CUSTOM";

const FREQUENCY_OPTIONS: SelectOption<PlanFrequency>[] = [
  { value: "DAILY", label: "Diario" },
  { value: "WEEKLY", label: "Semanal" },
  { value: "BIWEEKLY", label: "Quincenal" },
  { value: "MONTHLY", label: "Mensual" },
];
const FREQUENCY_SHORT: Record<PlanFrequency, string> = {
  DAILY: "diario",
  WEEKLY: "semanal",
  BIWEEKLY: "quincenal",
  MONTHLY: "mensual",
};

export function GrantCreditScreen() {
  const { t } = useT();
  const router = useRouter();
  const grant = useGrantCredit();
  const zones = useZonesList();
  const plans = usePaymentPlans();

  const [borrower, setBorrower] = useState<SelectedBorrower | null>(null);
  const [zoneId, setZoneId] = useState("");
  // `null` significa "aún no elegí": cae al plan por defecto del tenant hasta que el usuario elija.
  const [planChoice, setPlanChoice] = useState<string | null>(null);
  const [principal, setPrincipal] = useState("");
  // `null` en cada override significa "usa lo que dicta el plan"; cualquier edición lo fija.
  const [interestOverride, setInterestOverride] = useState<string | null>(null);
  const [installmentsOverride, setInstallmentsOverride] = useState<string | null>(null);
  const [frequencyOverride, setFrequencyOverride] = useState<PlanFrequency | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const activePlans = (plans.data?.items ?? []).filter((p) => p.isActive);

  // Plan efectivo: el elegido por el usuario o, mientras no elija, el "por defecto" del tenant.
  const defaultPlan = activePlans.find((p) => p.isDefault) ?? null;
  const planId = planChoice ?? defaultPlan?.id ?? CUSTOM_PLAN;
  const selectedPlan = activePlans.find((p) => p.id === planId) ?? null;

  // Los términos se derivan del plan y se sobrescriben en cuanto el usuario edita el campo. Así el
  // plan por defecto pre-llena sin un efecto (patrón "you might not need an effect").
  const interest =
    interestOverride ?? (selectedPlan ? String(toPercent(selectedPlan.interestPct)) : "");
  const installments =
    installmentsOverride ?? (selectedPlan ? String(selectedPlan.installmentsCount) : "");
  const frequency = frequencyOverride ?? selectedPlan?.frequency ?? "DAILY";

  // Cambiar de plan descarta los overrides: los términos vuelven a salir del plan (o quedan en
  // blanco para "Personalizado", donde el usuario los captura a mano).
  const onChangePlan = (nextId: string) => {
    setPlanChoice(nextId);
    setInterestOverride(null);
    setInstallmentsOverride(null);
    setFrequencyOverride(null);
  };

  const planOptions: SelectOption<string>[] = [
    ...activePlans.map((p) => ({
      value: p.id,
      label: p.name,
      hint: `${p.installmentsCount} cuotas · ${FREQUENCY_SHORT[p.frequency]} · ${toPercent(p.interestPct)}%`,
    })),
    { value: CUSTOM_PLAN, label: t("credit.new.plan.custom") },
  ];

  const zoneOptions: SelectOption<string>[] = (zones.data?.items ?? []).map((z) => ({
    value: z.id,
    label: z.name,
    hint: z.path,
  }));

  const principalNum = Number(principal);
  const principalMinor = Number.isFinite(principalNum) ? majorToMinor(principalNum) : 0;
  const overLimit =
    !!borrower && borrower.creditLimitMinor > 0 && principalMinor > borrower.creditLimitMinor;
  const blocked = !!borrower?.creditBlocked;

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!borrower) next.borrowerId = t("credit.new.borrower.required");
    if (!zoneId) next.zoneId = t("credit.new.zone.required");
    if (!Number.isFinite(principalNum) || principalNum <= 0)
      next.principalMinor = t("credit.new.principal.invalid");
    const installmentsNum = Math.trunc(Number(installments));
    if (!Number.isFinite(Number(installments)) || installmentsNum < 1)
      next.installmentsCount = t("credit.new.installments.invalid");
    return next;
  };

  // El backend manda el motivo de dominio en `message` (p. ej. "excede el cupo"). Lo preferimos
  // sobre el texto i18n genérico del código de estado; si no vino, caemos al genérico.
  const describeError = (err: unknown): string => {
    if (!isApiError(err)) return t("errors.unknown");
    return err.message && err.message !== err.messageKey ? err.message : t(err.messageKey);
  };

  const onSubmit = () => {
    setSubmitError(null);
    const clientErrors = validate();
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    // Candidato con conversión a unidades menores y base-mil del interés. `paymentPlanId` solo
    // viaja cuando se eligió un plan real (no "Personalizado").
    const candidate = {
      borrowerId: borrower!.id,
      zoneId,
      principalMinor,
      interestPct: Number(interest) * PERCENT_TO_BASE_THOUSAND,
      installmentsCount: Math.trunc(Number(installments)),
      frequency,
      ...(planId && planId !== CUSTOM_PLAN ? { paymentPlanId: planId } : {}),
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
      onError: (err) => setSubmitError(describeError(err)),
    });
  };

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("credit.new.title")}</Text>

        {submitError ? <Banner tone="danger" title={submitError} /> : null}

        <BorrowerPickerField
          selected={borrower}
          error={errors.borrowerId}
          onSelect={(b) => {
            setBorrower(b);
            setErrors((e) => ({ ...e, borrowerId: undefined }));
          }}
        />
        {blocked ? <Banner tone="danger" title={t("credit.new.borrower.blocked")} /> : null}

        <Field label={t("credit.new.zone")} error={errors.zoneId} required>
          <Select
            value={zoneId || null}
            options={zoneOptions}
            onChange={(v) => {
              setZoneId(v);
              setErrors((e) => ({ ...e, zoneId: undefined }));
            }}
            placeholder={t("credit.new.zone.placeholder")}
            title={t("credit.new.zone")}
            invalid={!!errors.zoneId}
          />
        </Field>

        <Field label={t("credit.new.plan")} hint={t("credit.new.plan.hint")}>
          <Select
            value={planId}
            options={planOptions}
            onChange={onChangePlan}
            placeholder={t("credit.new.plan.placeholder")}
            title={t("credit.new.plan")}
          />
        </Field>

        <Field
          label={t("credit.new.principal")}
          error={errors.principalMinor}
          hint={t("credit.new.principal.hint")}
          required
        >
          <Input
            keyboardType="numeric"
            value={principal}
            onChangeText={setPrincipal}
            invalid={!!errors.principalMinor}
          />
        </Field>
        {overLimit ? <Banner tone="warning" title={t("credit.new.borrower.overLimit")} /> : null}

        <Field label={t("credit.new.interest")} error={errors.interestPct} hint="20 = 20%" required>
          <Input
            keyboardType="numeric"
            value={interest}
            onChangeText={setInterestOverride}
            invalid={!!errors.interestPct}
          />
        </Field>
        <Field label={t("credit.new.installments")} error={errors.installmentsCount} required>
          <Input
            keyboardType="number-pad"
            value={installments}
            onChangeText={setInstallmentsOverride}
            invalid={!!errors.installmentsCount}
          />
        </Field>
        <Field label={t("credit.new.frequency")}>
          <Select
            value={frequency}
            options={FREQUENCY_OPTIONS}
            onChange={setFrequencyOverride}
            title={t("credit.new.frequency")}
          />
        </Field>

        <Button
          label={t("credit.new.submit")}
          loading={grant.isPending}
          disabled={blocked}
          block
          onPress={onSubmit}
        />
      </Stack>
    </Screen>
  );
}

/** Etiqueta legible del deudor: "Nombre Apellido · Cédula". */
function borrowerLabel(b: SelectedBorrower): string {
  return `${`${b.firstName} ${b.lastName}`.trim()} · ${b.nationalId}`;
}

function borrowerSubtitle(b: BorrowerSummary): string {
  return [b.nationalId, b.business, b.phone].filter(Boolean).join(" · ");
}

/**
 * Campo de selección del DEUDOR: abre un buscador (por nombre/cédula) con la cartera de clientes
 * y permite crear uno nuevo sin salir de la pantalla (alta rápida). El elegido queda seleccionado.
 */
function BorrowerPickerField({
  selected,
  error,
  onSelect,
}: {
  selected: SelectedBorrower | null;
  error?: string;
  onSelect: (borrower: SelectedBorrower) => void;
}) {
  const { t } = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [search, setSearch] = useState("");
  const list = useBorrowersList(search.trim() ? { name: search.trim() } : {});
  const items = list.data?.items ?? [];

  const borderTone = error ? "border-red-500" : "border-zinc-200 dark:border-zinc-700";

  return (
    <Field label={t("credit.new.borrower")} error={error} required>
      <Pressable
        accessibilityRole="button"
        onPress={() => setPickerOpen(true)}
        className={`min-h-[48px] flex-row items-center justify-between rounded-xl border px-4 ${borderTone} bg-white dark:bg-zinc-900`}
      >
        <Text variant="body" tone={selected ? "default" : "muted"}>
          {selected ? borrowerLabel(selected) : t("credit.new.borrower.placeholder")}
        </Text>
        <Text variant="body" tone="muted">
          ▾
        </Text>
      </Pressable>

      <Modal visible={pickerOpen} onClose={() => setPickerOpen(false)} title={t("credit.new.borrower")}>
        <Stack gap="sm" className="p-4">
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder={t("credit.new.borrower.search")}
            autoCapitalize="none"
          />
          <Button
            label={`+ ${t("credit.new.borrower.create")}`}
            variant="ghost"
            block
            onPress={() => {
              setPickerOpen(false);
              setCreatingOpen(true);
            }}
          />
          {list.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : items.length === 0 ? (
            <Text tone="muted">{t("credit.new.borrower.empty")}</Text>
          ) : (
            items.map((b) => (
              <ListItem
                key={b.id}
                title={`${b.firstName} ${b.lastName}`.trim()}
                subtitle={borrowerSubtitle(b)}
                onPress={() => {
                  onSelect(b);
                  setPickerOpen(false);
                }}
              />
            ))
          )}
        </Stack>
      </Modal>

      <QuickCreateBorrowerModal
        visible={creatingOpen}
        onClose={() => setCreatingOpen(false)}
        onCreated={(b) => {
          onSelect(b);
          setCreatingOpen(false);
        }}
      />
    </Field>
  );
}

/** Alta rápida de un cliente desde el otorgamiento: solo los campos esenciales; el resto usa los
 * valores por defecto del contrato. Al crear, devuelve el cliente para seleccionarlo al instante. */
function QuickCreateBorrowerModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (borrower: SelectedBorrower) => void;
}) {
  const { t } = useT();
  const create = useCreateBorrower();
  const [nationalId, setNationalId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const parsed = createBorrowerInput.safeParse({
      nationalId: nationalId.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: ({ id }) =>
        onCreated({
          id,
          nationalId: parsed.data.nationalId,
          firstName: parsed.data.firstName,
          lastName: parsed.data.lastName,
          business: parsed.data.business,
          phone: parsed.data.phone,
          creditBlocked: parsed.data.creditBlocked,
          creditLimitMinor: parsed.data.creditLimitMinor,
        }),
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Modal visible={visible} onClose={onClose} title={t("credit.new.quickCreate.title")}>
      <Stack gap="md" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("borrowers.field.nationalId")} required>
          <Input value={nationalId} onChangeText={setNationalId} autoCapitalize="none" />
        </Field>
        <Field label={t("borrowers.field.firstName")} required>
          <Input value={firstName} onChangeText={setFirstName} />
        </Field>
        <Field label={t("borrowers.field.lastName")}>
          <Input value={lastName} onChangeText={setLastName} />
        </Field>
        <Field label={t("borrowers.field.phone")}>
          <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        </Field>
        <Button
          label={t("credit.new.quickCreate.submit")}
          loading={create.isPending}
          disabled={!nationalId.trim() || !firstName.trim()}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
  );
}
