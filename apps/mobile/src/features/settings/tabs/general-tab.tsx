import { useState, type ReactNode } from "react";
import type { OperationalSettings } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  majorToMinor,
  minorToMajor,
  Row,
  Select,
  Spinner,
  Stack,
  Switch,
  Text,
} from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { timeZoneOptions } from "../time-zones";
import {
  useOperationalSettings,
  useUpdateOperationalSettings,
} from "../api/queries";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  COORDINATOR: "Coordinador",
  COLLECTOR: "Cobrador",
};

/**
 * Tab GENERAL: identidad de la sesión + configuración de cobro del tenant. Es el tab COMPARTIDO
 * que ejemplifica el control lectura/escritura: con `canEdit=false` (Coordinador) todo se ve pero
 * los inputs/toggles van deshabilitados y no se muestra el botón Guardar.
 */
/** Hoy (YYYY-MM-DD) en la hora local del dispositivo del administrador. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const SETTLEMENT_FREQUENCIES: OperationalSettings["settlementFrequency"][] = ["WEEKLY", "BIWEEKLY", "MONTHLY"];
const COMMISSION_BASES: OperationalSettings["commissionBase"][] = ["COLLECTED", "REMITTED", "PRINCIPAL_RECOVERED"];

// Tope de días hacia atrás de la fecha de un pago (espejo del contrato: 0–30).
const MAX_BACKDATE_DAYS = 30;

// Los porcentajes de comisión viajan en base mil (50 = 5 %), como el interés.
const PER_MILLE_PER_PERCENT = 10;
const MAX_PER_MILLE = 1000;
function percentToPerMille(text: string): number {
  return Math.min(MAX_PER_MILLE, Math.max(0, Math.round((Number(text.replace(",", ".")) || 0) * PER_MILLE_PER_PERCENT)));
}

export function GeneralTab({ canEdit }: { canEdit: boolean }) {
  return (
    <Stack gap="lg">
      <SessionCard />
      <OperationalConfigCard canEdit={canEdit} />
    </Stack>
  );
}

function SessionCard() {
  const { t } = useT();
  const { claims, role } = useSession();
  return (
    <Card>
      <Stack gap="sm">
        <Row className="justify-between">
          <Text tone="muted">{t("user.role")}</Text>
          <Text variant="label">{role ? ROLE_LABEL[role] : "—"}</Text>
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("user.tenant")}</Text>
          <Text variant="code">{claims?.tenantId.slice(0, 8) ?? "—"}</Text>
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("user.zones")}</Text>
          <Text variant="label">{claims?.zonePaths.length ?? 0}</Text>
        </Row>
      </Stack>
    </Card>
  );
}

/** Configuración operativa del tenant, agrupada por tema (las opciones sin efecto, al final). */
function OperationalConfigCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  const query = useOperationalSettings();
  const update = useUpdateOperationalSettings();
  const [draft, setDraft] = useState<OperationalSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const form = draft ?? query.data ?? null;
  if (query.isPending || !form) return <Spinner label={t("common.loading")} />;

  const set = <K extends keyof OperationalSettings>(key: K, value: OperationalSettings[K]) => {
    if (!canEdit) return;
    setDraft({ ...form, [key]: value });
    setSaved(false);
  };

  const save = () => {
    setError(null);
    update.mutate(form, {
      onSuccess: () => setSaved(true),
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  const toggle = <K extends BooleanSettingKey>(key: K) => ({
    value: form[key],
    onChange: (v: boolean) => set(key, v),
    disabled: !canEdit,
  });
  const feedback = (
    <>
      {error ? <Banner tone="danger" title={error} /> : null}
      {saved ? <Banner tone="success" title={t("config.saved")} /> : null}
    </>
  );

  return (
    <Stack gap="md">
      <Stack gap="xs">
        <Text variant="heading">{t("config.title")}</Text>
        <Text variant="caption" tone="muted">{t("config.intro")}</Text>
      </Stack>
      {!canEdit ? <Banner tone="info" title="Solo lectura: tu rol no puede modificar esta configuración." /> : null}
      {feedback}

      <SettingsSection title={t("config.section.company")} description={t("config.section.companyHint")}>
        <Field label={t("config.timeZone")} hint={t("config.timeZoneHint")}>
          <Select
            value={form.timeZone}
            options={timeZoneOptions(form.timeZone)}
            onChange={(v) => set("timeZone", v)}
            title={t("config.timeZone")}
            disabled={!canEdit}
          />
        </Field>
      </SettingsSection>

      <SettingsSection title={t("config.section.credits")} description={t("config.section.creditsHint")}>
        <ToggleSetting label={t("config.blockInterest")} hint={t("config.blockInterestHint")} {...toggle("blockInterestChange")} />
        {form.blockInterestChange ? (
          <ToggleSetting
            label={t("config.adminCustomInterest")}
            hint={t("config.adminCustomInterestHint")}
            {...toggle("adminCustomInterestAllowed")}
          />
        ) : null}
        <ToggleSetting label={t("config.allowAdminOverride")} hint={t("config.allowAdminOverrideHint")} {...toggle("allowAdminOverride")} />
        <Field label={t("config.defaultLimit")} hint={t("config.defaultLimitHint")}>
          <Input
            keyboardType="numeric"
            editable={canEdit}
            value={String(minorToMajor(form.defaultCreditLimitMinor))}
            onChangeText={(text) => set("defaultCreditLimitMinor", majorToMinor(Number(text) || 0))}
          />
        </Field>
      </SettingsSection>

      <SettingsSection title={t("config.section.chatOffer")} description={t("config.section.chatOfferHint")}>
        <ToggleSetting label={t("config.clientChoosesPlan")} hint={t("config.clientChoosesPlanHint")} {...toggle("clientChoosesPlan")} />
        <Field label={t("config.planOfferTtl")} hint={t("config.planOfferTtlHint")}>
          <Input
            keyboardType="numeric"
            editable={canEdit}
            value={String(form.planOfferTtlHours)}
            onChangeText={(text) => set("planOfferTtlHours", Math.max(1, Math.round(Number(text) || 0)))}
          />
        </Field>
      </SettingsSection>

      <SettingsSection title={t("config.section.payments")} description={t("config.section.paymentsHint")}>
        <ToggleSetting label={t("config.autoConfirmSettlement")} hint={t("config.autoConfirmSettlementHint")} {...toggle("autoConfirmSettlement")} />
        <ToggleSetting label={t("config.relaxedPaymentDates")} hint={t("config.relaxedPaymentDatesHint")} {...toggle("relaxedPaymentDates")} />
        {form.relaxedPaymentDates ? (
          <Banner tone="warning" title={t("config.relaxedPaymentDatesActive")} />
        ) : (
          <>
            <ToggleSetting label={t("config.blockOverdue")} hint={t("config.blockOverdueHint")} {...toggle("blockOverdueDatesForSales")} />
            <Field label={t("config.backdateMaxDays")} hint={t("config.backdateMaxDaysHint")}>
              <Input
                keyboardType="number-pad"
                editable={canEdit}
                value={String(form.backdateMaxDays)}
                onChangeText={(text) =>
                  set("backdateMaxDays", Math.min(MAX_BACKDATE_DAYS, Math.max(0, Math.round(Number(text) || 0))))
                }
              />
            </Field>
          </>
        )}
      </SettingsSection>

      <SettingsSection title={t("config.section.field")} description={t("config.section.fieldHint")}>
        <Field label={t("config.visitThreshold")} hint={t("config.visitThresholdHint")}>
          <Input
            keyboardType="numeric"
            editable={canEdit}
            value={String(form.visitOverdueThreshold)}
            onChangeText={(text) => set("visitOverdueThreshold", Math.max(1, Math.round(Number(text) || 0)))}
          />
        </Field>
        <Field label={t("config.remittanceDeadline")} hint={t("config.remittanceDeadlineHint")}>
          <Input
            keyboardType="numeric"
            editable={canEdit}
            value={String(form.remittanceDeadlineHourLocal)}
            onChangeText={(text) =>
              set("remittanceDeadlineHourLocal", Math.min(23, Math.max(0, Math.round(Number(text) || 0))))
            }
          />
        </Field>
      </SettingsSection>

      {/* Liquidación por períodos (el día de inicio se valida contra la frecuencia al guardar). */}
      <SettingsSection title={t("config.section.settlement")} description={t("config.section.settlementHint")}>
        <Field label={t("config.settlement.frequency")}>
          <Select
            value={form.settlementFrequency}
            options={SETTLEMENT_FREQUENCIES.map((f) => ({ value: f, label: t(`config.settlement.frequency.${f}`) }))}
            onChange={(v) => set("settlementFrequency", v)}
          />
        </Field>
        {form.settlementFrequency !== "BIWEEKLY" ? (
          <Field label={t("config.settlement.anchor")} hint={t(`config.settlement.anchorHint.${form.settlementFrequency}`)}>
            <Input
              keyboardType="numeric"
              editable={canEdit}
              value={String(form.settlementAnchorDay)}
              onChangeText={(text) => set("settlementAnchorDay", Math.max(1, Math.round(Number(text) || 1)))}
            />
          </Field>
        ) : null}
        <Field label={t("config.settlement.startDate")} hint={t("config.settlement.startDateHint")}>
          <Row gap="sm" className="items-center">
            <Input
              editable={canEdit}
              value={form.settlementStartDate ?? ""}
              placeholder="AAAA-MM-DD"
              onChangeText={(text) => set("settlementStartDate", text.trim() || null)}
            />
            <Button
              label={t("config.settlement.today")}
              variant="secondary"
              size="sm"
              disabled={!canEdit}
              onPress={() => set("settlementStartDate", localToday())}
            />
          </Row>
        </Field>
        <ToggleSetting label={t("config.settlement.autoClose")} hint={t("config.settlement.autoCloseHint")} {...toggle("settlementAutoClose")} />
      </SettingsSection>

      <SettingsSection title={t("config.section.commissions")} description={t("config.section.commissionsHint")}>
        <ToggleSetting label={t("config.commissionsEnabled")} hint={t("config.commissionsEnabledHint")} {...toggle("commissionsEnabled")} />
        {form.commissionsEnabled ? (
          <>
            <Field label={t("config.commissionCap")} hint={t("config.commissionCapHint")}>
              <Input
                keyboardType="numeric"
                editable={canEdit}
                value={String(form.commissionMaxPctBaseThousand / PER_MILLE_PER_PERCENT)}
                onChangeText={(text) => set("commissionMaxPctBaseThousand", percentToPerMille(text))}
              />
            </Field>
            <Field label={t("config.commission")} hint={t("config.commissionDefaultHint")}>
              <Input
                keyboardType="numeric"
                editable={canEdit}
                value={String(form.commissionPctBaseThousand / PER_MILLE_PER_PERCENT)}
                onChangeText={(text) => set("commissionPctBaseThousand", percentToPerMille(text))}
              />
            </Field>
            <Field label={t("config.commissionBase")} hint={t("config.commissionBaseHint")}>
              <Select
                value={form.commissionBase}
                options={COMMISSION_BASES.map((b) => ({ value: b, label: t(`commission.base.${b}`) }))}
                onChange={(v) => set("commissionBase", v)}
              />
            </Field>
          </>
        ) : null}
      </SettingsSection>

      {/* Opciones heredadas del sistema anterior que todavía no hacen nada: al final, para decidir. */}
      <SettingsSection title={t("config.section.pending")} description={t("config.section.pendingHint")}>
        <ToggleSetting label={t("config.recharges")} hint={t("config.rechargesHint")} {...toggle("rechargesEnabled")} />
        <ToggleSetting label={t("config.manualRoute")} hint={t("config.manualRouteHint")} {...toggle("manualRoute")} />
        <ToggleSetting label={t("config.colorByOverdue")} hint={t("config.colorByOverdueHint")} {...toggle("applyColorByOverdue")} />
      </SettingsSection>

      {feedback}
      {canEdit ? <Button label={t("common.save")} loading={update.isPending} block onPress={save} /> : null}
    </Stack>
  );
}

/** Claves booleanas de los ajustes (las que se muestran como interruptor). */
type BooleanSettingKey = {
  [K in keyof OperationalSettings]: OperationalSettings[K] extends boolean ? K : never;
}[keyof OperationalSettings];

/** Grupo de ajustes de un mismo tema: título, para qué sirve y sus opciones. */
function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <Card>
      <Stack gap="sm">
        <Stack gap="xs">
          <Text variant="heading">{title}</Text>
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        </Stack>
        {children}
      </Stack>
    </Card>
  );
}

/** Interruptor con una ayuda breve debajo que explica qué hace. */
function ToggleSetting({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <Stack gap="xs">
      <Switch value={value} onValueChange={onChange} label={label} disabled={disabled} />
      <Text variant="caption" tone="muted">
        {hint}
      </Text>
    </Stack>
  );
}
