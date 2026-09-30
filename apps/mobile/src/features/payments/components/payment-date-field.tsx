import { Button, Field, Input, Row, Text } from "@preztiaos/ui";

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
  return (
    <Field label={t("payments.paidOn")} hint={hint}>
      <Row gap="sm" className="items-center">
        <Input value={value ?? ""} placeholder={t("payments.paidOnToday")} onChangeText={(v) => onChange(v.trim() || null)} />
        {value ? <Button label={t("config.settlement.today")} variant="secondary" size="sm" onPress={() => onChange(null)} /> : null}
      </Row>
      {value ? (
        <Text variant="caption" tone="muted">
          {t("payments.paidOnAudited")}
        </Text>
      ) : null}
    </Field>
  );
}
