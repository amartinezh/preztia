import { useState } from "react";
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
  Spinner,
  Stack,
  Switch,
  Text,
} from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
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

/** Configuración de cobro del tenant: recargos, comisión, cupo por defecto, bloqueos. */
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

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("config.title")}</Text>
        {!canEdit ? <Banner tone="info" title="Solo lectura: tu rol no puede modificar esta configuración." /> : null}
        {error ? <Banner tone="danger" title={error} /> : null}
        {saved ? <Banner tone="success" title={t("config.saved")} /> : null}

        <Switch value={form.rechargesEnabled} onValueChange={(v) => set("rechargesEnabled", v)} label={t("config.recharges")} disabled={!canEdit} />
        <Switch value={form.manualRoute} onValueChange={(v) => set("manualRoute", v)} label={t("config.manualRoute")} disabled={!canEdit} />
        <Switch value={form.blockOverdueDatesForSales} onValueChange={(v) => set("blockOverdueDatesForSales", v)} label={t("config.blockOverdue")} disabled={!canEdit} />
        <Switch value={form.blockInterestChange} onValueChange={(v) => set("blockInterestChange", v)} label={t("config.blockInterest")} disabled={!canEdit} />
        <Switch value={form.applyColorByOverdue} onValueChange={(v) => set("applyColorByOverdue", v)} label={t("config.colorByOverdue")} disabled={!canEdit} />
        <Switch value={form.clientChoosesPlan} onValueChange={(v) => set("clientChoosesPlan", v)} label={t("config.clientChoosesPlan")} disabled={!canEdit} />
        <Switch value={form.allowAdminOverride} onValueChange={(v) => set("allowAdminOverride", v)} label={t("config.allowAdminOverride")} disabled={!canEdit} />
        <Switch value={form.autoConfirmSettlement} onValueChange={(v) => set("autoConfirmSettlement", v)} label={t("config.autoConfirmSettlement")} disabled={!canEdit} />
        <Text variant="caption" tone="muted">{t("config.autoConfirmSettlementHint")}</Text>

        <Field label={t("config.planOfferTtl")}>
          <Input
            keyboardType="numeric"
            editable={canEdit}
            value={String(form.planOfferTtlHours)}
            onChangeText={(text) => set("planOfferTtlHours", Math.max(1, Math.round(Number(text) || 0)))}
          />
        </Field>
        <Field label={t("config.commission")}>
          <Input
            keyboardType="numeric"
            editable={canEdit}
            value={String(form.commissionPctBaseThousand / 10)}
            onChangeText={(text) => set("commissionPctBaseThousand", Math.round((Number(text) || 0) * 10))}
          />
        </Field>
        <Field label={t("config.defaultLimit")}>
          <Input
            keyboardType="numeric"
            editable={canEdit}
            value={String(minorToMajor(form.defaultCreditLimitMinor))}
            onChangeText={(text) => set("defaultCreditLimitMinor", majorToMinor(Number(text) || 0))}
          />
        </Field>

        {canEdit ? (
          <Button label={t("common.save")} loading={update.isPending} block onPress={save} />
        ) : null}
      </Stack>
    </Card>
  );
}
