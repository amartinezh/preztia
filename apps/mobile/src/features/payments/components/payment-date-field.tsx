import { DateField, Field, Text, addDaysIso, todayIso } from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { useT } from "@/core/i18n";
import { useOperationalSettings } from "@/features/settings/api/queries";

/**
 * "Fecha del pago" para registrar un cobro de otro día. Solo lo ve quien puede elegirla: el ADMIN
 * siempre; el coordinador si las fechas atrasadas no están bloqueadas o si está el modo flexible; el cobrador nunca (su cobro
 * sin señal ya viaja con la hora real de captura). El servidor valida el límite y el período sellado.
 */
export function PaymentDateField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const { role } = useSession();
  // Solo ADMIN/COORDINATOR leen los ajustes; el cobrador no llega a montar el componente interno.
  if (role !== "ADMIN" && role !== "COORDINATOR") return null;
  return <ReviewerPaymentDateField isAdmin={role === "ADMIN"} value={value} onChange={onChange} />;
}

function ReviewerPaymentDateField({
  isAdmin,
  value,
  onChange,
}: {
  isAdmin: boolean;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const { t } = useT();
  const settings = useOperationalSettings();
  const locked = settings.data?.blockBackdatedPayments ?? true;
  const relaxed = settings.data?.relaxedPaymentDates ?? false;
  if (!isAdmin && locked && !relaxed) return null;
  const maxDaysBack = settings.data?.backdateMaxDays;
  const hint = relaxed
    ? t("payments.paidOnRelaxedHint")
    : maxDaysBack != null
      ? `${t("payments.paidOnHint")} ${maxDaysBack}`
      : t("payments.paidOnHint");
  // `null` = hoy (el servidor usa la hora de captura); solo OTRO día viaja como fecha explícita.
  const today = todayIso();
  // Nunca una fecha futura; con ventana de días hacia atrás, tampoco antes de ella (el servidor revalida).
  const min = !relaxed && maxDaysBack != null ? addDaysIso(today, -maxDaysBack) : undefined;
  const quickOptions = [
    { label: t("payments.paidOnToday"), value: today },
    { label: t("common.yesterday"), value: addDaysIso(today, -1) },
  ];
  return (
    <Field label={t("payments.paidOn")} hint={hint}>
      <DateField
        value={value}
        onChange={(v) => onChange(v !== null && v !== today ? v : null)}
        min={min}
        max={today}
        quickOptions={quickOptions}
        placeholder={t("payments.paidOnToday")}
        invalidLabel={t("date.invalid")}
        accessibilityLabel={t("payments.paidOn")}
      />
      {value ? (
        <Text variant="caption" tone="muted">
          {t("payments.paidOnAudited")}
        </Text>
      ) : null}
    </Field>
  );
}
