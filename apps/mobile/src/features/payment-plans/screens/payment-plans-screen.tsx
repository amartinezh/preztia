import { useState } from "react";
import type { PaymentPlanView, PlanFrequency } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  Input,
  Row,
  Select,
  Spinner,
  Stack,
  Switch,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useCreatePaymentPlan,
  useDeletePaymentPlan,
  usePaymentPlans,
  useSetDefaultPaymentPlan,
  useUpdatePaymentPlan,
} from "../api/queries";

const FREQUENCY_OPTIONS: SelectOption<PlanFrequency>[] = [
  { value: "DAILY", label: "Diario" },
  { value: "WEEKLY", label: "Semanal" },
  { value: "BIWEEKLY", label: "Quincenal" },
  { value: "MONTHLY", label: "Mensual" },
];

const FREQUENCY_LABEL: Record<PlanFrequency, string> = {
  DAILY: "diario",
  WEEKLY: "semanal",
  BIWEEKLY: "quincenal",
  MONTHLY: "mensual",
};

/** El interés se guarda en base-mil (200 = 20%); en la UI se edita y muestra como porcentaje. */
const toPercent = (baseThousand: number) => baseThousand / 10;
const toBaseThousand = (percent: number) => Math.round(percent * 10);

/**
 * Administración de PLANES DE PAGO (ADMIN). Lista de planes con interruptor activo/inactivo y
 * marca de "por defecto" exclusiva (el server garantiza uno y solo uno). Debajo, el alta de un
 * plan nuevo. La autonomía del cliente para elegir plan vía WhatsApp es un toggle aparte
 * (Configuración de cobro) que se cablea en la Fase 10.
 */
export function PaymentPlansScreen() {
  const { t } = useT();
  const query = usePaymentPlans();
  const update = useUpdatePaymentPlan();
  const setDefault = useSetDefaultPaymentPlan();
  const remove = useDeletePaymentPlan();
  const [error, setError] = useState<string | null>(null);

  const onError = (err: unknown) =>
    setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));

  if (query.isPending || !query.data) return <Spinner label={t("common.loading")} />;
  const plans = query.data.items;
  const busy = update.isPending || setDefault.isPending || remove.isPending;

  return (
    <Screen>
      <Stack gap="lg">
        <Stack gap="xs">
          <Text variant="subtitle">{t("plans.title")}</Text>
          <Text variant="caption" tone="muted">
            {t("plans.hint")}
          </Text>
        </Stack>

        {error ? <Banner tone="danger" title={error} /> : null}
        {plans.length === 0 ? <Banner tone="warning" title={t("plans.empty")} /> : null}

        <Stack gap="sm">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              busy={busy}
              onToggleActive={(isActive) => {
                setError(null);
                update.mutate({ id: plan.id, patch: { isActive } }, { onError });
              }}
              onSetDefault={() => {
                setError(null);
                setDefault.mutate(plan.id, { onError });
              }}
              onDelete={() => {
                setError(null);
                remove.mutate(plan.id, { onError });
              }}
            />
          ))}
        </Stack>

        <NewPlanForm onError={onError} clearError={() => setError(null)} />
      </Stack>
    </Screen>
  );
}

/** Una fila/tarjeta de plan: interruptor activo, marca por defecto y eliminar. */
function PlanCard(props: {
  plan: PaymentPlanView;
  busy: boolean;
  onToggleActive: (active: boolean) => void;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const { plan } = props;
  return (
    <Card>
      <Stack gap="sm">
        <Row className="items-center justify-between">
          <Text variant="heading">{plan.name}</Text>
          {plan.isDefault ? <Badge label={t("plans.default")} tone="info" /> : null}
        </Row>
        <Text tone="muted">
          {`${plan.installmentsCount} ${t("plans.installmentsWord")} · ${FREQUENCY_LABEL[plan.frequency]} · ${toPercent(plan.interestPct)}%`}
        </Text>

        <Switch
          value={plan.isActive}
          onValueChange={props.onToggleActive}
          disabled={props.busy}
          label={t("plans.active")}
        />

        <Row className="justify-end gap-2">
          {!plan.isDefault ? (
            <Button
              label={t("plans.setDefault")}
              variant="ghost"
              size="sm"
              disabled={props.busy || !plan.isActive}
              onPress={props.onSetDefault}
            />
          ) : null}
          {!plan.isDefault ? (
            <Button
              label={t("common.delete")}
              variant="ghost"
              size="sm"
              disabled={props.busy}
              onPress={props.onDelete}
            />
          ) : null}
        </Row>
      </Stack>
    </Card>
  );
}

/** Alta de un plan nuevo. La marca por defecto es opcional; el server fuerza default al primero. */
function NewPlanForm(props: { onError: (err: unknown) => void; clearError: () => void }) {
  const { t } = useT();
  const create = useCreatePaymentPlan();
  const [name, setName] = useState("");
  const [installments, setInstallments] = useState("20");
  const [frequency, setFrequency] = useState<PlanFrequency>("DAILY");
  const [interestPercent, setInterestPercent] = useState("20");
  const [isDefault, setIsDefault] = useState(false);
  const [saved, setSaved] = useState(false);

  const reset = () => {
    setName("");
    setInstallments("20");
    setFrequency("DAILY");
    setInterestPercent("20");
    setIsDefault(false);
  };

  const submit = () => {
    props.clearError();
    setSaved(false);
    create.mutate(
      {
        name: name.trim(),
        installmentsCount: Number(installments) || 0,
        frequency,
        interestPct: toBaseThousand(Number(interestPercent) || 0),
        isActive: true,
        isDefault,
      },
      {
        onSuccess: () => {
          setSaved(true);
          reset();
        },
        onError: props.onError,
      },
    );
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("plans.new")}</Text>
        {saved ? <Banner tone="success" title={t("plans.saved")} /> : null}

        <Field label={t("plans.field.name")}>
          <Input value={name} onChangeText={setName} placeholder={t("plans.field.name.placeholder")} />
        </Field>
        <Field label={t("plans.field.installments")}>
          <Input keyboardType="numeric" value={installments} onChangeText={setInstallments} />
        </Field>
        <Field label={t("plans.field.frequency")}>
          <Select
            value={frequency}
            options={FREQUENCY_OPTIONS}
            onChange={setFrequency}
            title={t("plans.field.frequency")}
          />
        </Field>
        <Field label={t("plans.field.interest")}>
          <Input keyboardType="numeric" value={interestPercent} onChangeText={setInterestPercent} />
        </Field>
        <Switch value={isDefault} onValueChange={setIsDefault} label={t("plans.field.default")} />

        <Button
          label={t("plans.create")}
          loading={create.isPending}
          disabled={!name.trim()}
          block
          onPress={submit}
        />
      </Stack>
    </Card>
  );
}
