import { useState } from "react";
import { updatePaymentPlanInput, type PaymentPlanView, type PlanFrequency } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  ConfirmModal,
  Field,
  Input,
  Modal,
  Row,
  Select,
  Spinner,
  Stack,
  Switch,
  Text,
  useToast,
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
  const { t, tf } = useT();
  const toast = useToast();
  const query = usePaymentPlans();
  const update = useUpdatePaymentPlan();
  const setDefault = useSetDefaultPaymentPlan();
  const remove = useDeletePaymentPlan();
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PaymentPlanView | null>(null);
  const [editing, setEditing] = useState<PaymentPlanView | null>(null);

  const onError = (err: unknown) =>
    setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));

  // Eliminar solo tras confirmar; el error se avisa fuera del modal para que quede visible.
  const confirmDelete = () => {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, {
      onSettled: () => setPendingDelete(null),
      onError: (err) =>
        toast.show({
          tone: "danger",
          title: isApiError(err) ? t(err.messageKey) : t("errors.unknown"),
        }),
    });
  };

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
                setPendingDelete(plan);
              }}
              onEdit={() => {
                setError(null);
                setEditing(plan);
              }}
            />
          ))}
        </Stack>

        <NewPlanForm onError={onError} clearError={() => setError(null)} />
      </Stack>
      {editing ? <EditPlanModal plan={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmModal
        visible={pendingDelete !== null}
        title={t("plans.delete.confirmTitle")}
        description={tf("plans.delete.confirmBody", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        tone="danger"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </Screen>
  );
}

/** Una fila/tarjeta de plan: interruptor activo, editar, marca por defecto y eliminar. */
function PlanCard(props: {
  plan: PaymentPlanView;
  busy: boolean;
  onToggleActive: (active: boolean) => void;
  onSetDefault: () => void;
  onDelete: () => void;
  onEdit: () => void;
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
          <Button label={t("common.edit")} variant="ghost" size="sm" disabled={props.busy} onPress={props.onEdit} />
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

/** Entero tecleado por la persona; NaN (y no 0) si no es un número, para que zod lo rechace. */
function parseInteger(text: string): number {
  return Number.parseInt(text.trim(), 10);
}

/** Interés tecleado en % (acepta coma) → base-mil del contrato; NaN si no es un número. */
function parseInterestPercent(text: string): number {
  const percent = Number(text.trim().replace(",", "."));
  return Number.isFinite(percent) && text.trim() !== "" ? toBaseThousand(percent) : Number.NaN;
}

/**
 * Edición de un plan existente: nombre, cuotas, periodicidad e interés. Valida con el contrato
 * (`updatePaymentPlanInput`) y muestra cada error junto a su campo; nunca convierte un texto
 * inválido en 0 en silencio. Los créditos ya otorgados conservan sus condiciones (el plan es una
 * plantilla), por eso editarlo no necesita confirmación.
 */
function EditPlanModal({ plan, onClose }: { plan: PaymentPlanView; onClose: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const update = useUpdatePaymentPlan();
  const [name, setName] = useState(plan.name);
  const [installments, setInstallments] = useState(String(plan.installmentsCount));
  const [frequency, setFrequency] = useState<PlanFrequency>(plan.frequency);
  const [interestPercent, setInterestPercent] = useState(String(toPercent(plan.interestPct)));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const parsed = updatePaymentPlanInput.safeParse({
      name: name.trim(),
      installmentsCount: parseInteger(installments),
      frequency,
      interestPct: parseInterestPercent(interestPercent),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    update.mutate(
      { id: plan.id, patch: parsed.data },
      {
        onSuccess: () => {
          toast.show({ tone: "success", title: t("plans.updated") });
          onClose();
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={t("plans.edit.title")} closeLabel={t("common.close")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("plans.field.name")} error={errors.name} required>
          <Input value={name} onChangeText={setName} invalid={!!errors.name} />
        </Field>
        <Field label={t("plans.field.installments")} error={errors.installmentsCount} required>
          <Input
            keyboardType="numeric"
            value={installments}
            onChangeText={setInstallments}
            invalid={!!errors.installmentsCount}
          />
        </Field>
        <Field label={t("plans.field.frequency")} required>
          <Select
            value={frequency}
            options={FREQUENCY_OPTIONS}
            onChange={setFrequency}
            title={t("plans.field.frequency")}
          />
        </Field>
        <Field label={t("plans.field.interest")} error={errors.interestPct} required>
          <Input
            keyboardType="numeric"
            value={interestPercent}
            onChangeText={setInterestPercent}
            invalid={!!errors.interestPct}
          />
        </Field>
        <Button
          label={t("plans.saveChanges")}
          loading={update.isPending}
          disabled={!name.trim()}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
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
