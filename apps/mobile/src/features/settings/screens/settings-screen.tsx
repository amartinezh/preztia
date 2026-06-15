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

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useOperationalSettings, useUpdateOperationalSettings } from "../api/queries";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador",
  COORDINATOR: "Coordinador",
  COLLECTOR: "Cobrador",
};

export function SettingsScreen() {
  const { t } = useT();
  const { claims, role, signOut } = useSession();

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">Ajustes</Text>

        <Card>
          <Stack gap="sm">
            <Row className="justify-between">
              <Text tone="muted">Rol</Text>
              <Text variant="label">{role ? ROLE_LABEL[role] : "—"}</Text>
            </Row>
            <Row className="justify-between">
              <Text tone="muted">Tenant</Text>
              <Text variant="code">{claims?.tenantId.slice(0, 8) ?? "—"}</Text>
            </Row>
            <Row className="justify-between">
              <Text tone="muted">Zonas</Text>
              <Text variant="label">{claims?.zonePaths.length ?? 0}</Text>
            </Row>
          </Stack>
        </Card>

        {role === "ADMIN" ? <OperationalConfigCard /> : null}

        <Button label={t("auth.signOut")} variant="secondary" onPress={() => void signOut()} />
      </Stack>
    </Screen>
  );
}

/** Configuración de cobro del tenant (ADMIN): recargos, comisión, cupo por defecto, bloqueos. */
function OperationalConfigCard() {
  const { t } = useT();
  const query = useOperationalSettings();
  const update = useUpdateOperationalSettings();
  // `draft` solo existe cuando el usuario edita; mientras tanto, el formulario refleja el server.
  const [draft, setDraft] = useState<OperationalSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const form = draft ?? query.data ?? null;
  if (query.isPending || !form) return <Spinner label={t("common.loading")} />;

  const set = <K extends keyof OperationalSettings>(key: K, value: OperationalSettings[K]) => {
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
        {error ? <Banner tone="danger" title={error} /> : null}
        {saved ? <Banner tone="success" title={t("config.saved")} /> : null}

        <Switch value={form.rechargesEnabled} onValueChange={(v) => set("rechargesEnabled", v)} label={t("config.recharges")} />
        <Switch value={form.manualRoute} onValueChange={(v) => set("manualRoute", v)} label={t("config.manualRoute")} />
        <Switch value={form.blockOverdueDatesForSales} onValueChange={(v) => set("blockOverdueDatesForSales", v)} label={t("config.blockOverdue")} />
        <Switch value={form.blockInterestChange} onValueChange={(v) => set("blockInterestChange", v)} label={t("config.blockInterest")} />
        <Switch value={form.applyColorByOverdue} onValueChange={(v) => set("applyColorByOverdue", v)} label={t("config.colorByOverdue")} />

        <Field label={t("config.commission")}>
          <Input
            keyboardType="numeric"
            value={String(form.commissionPctBaseThousand / 10)}
            onChangeText={(text) => set("commissionPctBaseThousand", Math.round((Number(text) || 0) * 10))}
          />
        </Field>
        <Field label={t("config.defaultLimit")}>
          <Input
            keyboardType="numeric"
            value={String(minorToMajor(form.defaultCreditLimitMinor))}
            onChangeText={(text) => set("defaultCreditLimitMinor", majorToMinor(Number(text) || 0))}
          />
        </Field>

        <Button label={t("common.save")} loading={update.isPending} block onPress={save} />
      </Stack>
    </Card>
  );
}
