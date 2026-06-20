import { useState } from "react";
import type { CollectionReminderSettings } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Card,
  Field,
  Input,
  Select,
  Spinner,
  Stack,
  Switch,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useCollectionReminderSettings,
  useUpdateCollectionReminderSettings,
} from "../api/queries";

// Zonas horarias frecuentes de la operación (LatAm + Brasil por el contexto PIX).
const TIMEZONE_OPTIONS: SelectOption<string>[] = [
  { value: "America/Bogota", label: "Colombia (America/Bogota)" },
  { value: "America/Sao_Paulo", label: "Brasil (America/Sao_Paulo)" },
  { value: "America/Mexico_City", label: "México (America/Mexico_City)" },
  { value: "America/Lima", label: "Perú (America/Lima)" },
  { value: "America/Argentina/Buenos_Aires", label: "Argentina (Buenos Aires)" },
];

/**
 * Tab COBRANZA: cron de recordatorios por WhatsApp (hora local + zona + llave PIX). Compartido:
 * con `canEdit=false` (Coordinador) se muestra en solo lectura.
 */
export function CollectionReminderTab({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  const query = useCollectionReminderSettings();
  const update = useUpdateCollectionReminderSettings();
  const [draft, setDraft] = useState<CollectionReminderSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const form = draft ?? query.data ?? null;
  if (query.isPending || !form) return <Spinner label={t("common.loading")} />;

  const set = <K extends keyof CollectionReminderSettings>(
    key: K,
    value: CollectionReminderSettings[K],
  ) => {
    if (!canEdit) return;
    setDraft({ ...form, [key]: value });
    setSaved(false);
  };

  const save = () => {
    setError(null);
    const pixKey = form.pixKey && form.pixKey.trim() ? form.pixKey.trim() : null;
    update.mutate(
      { ...form, pixKey },
      {
        onSuccess: (result) => {
          setSaved(true);
          setDraft(result);
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">Cobranza automática (WhatsApp)</Text>
        <Text variant="caption" tone="muted">
          Envía cada día un recordatorio de pago con la cuota del día e invitación a pagar por PIX.
        </Text>
        {!canEdit ? <Banner tone="info" title="Solo lectura: tu rol no puede modificar esta configuración." /> : null}
        {error ? <Banner tone="danger" title={error} /> : null}
        {saved ? <Banner tone="success" title={t("config.saved")} /> : null}
        {canEdit && form.enabled && !(form.pixKey && form.pixKey.trim()) ? (
          <Banner tone="warning" title="Falta la llave PIX: el cron no podrá cobrar." />
        ) : null}

        <Switch
          value={form.enabled}
          onValueChange={(v) => set("enabled", v)}
          label="Activar envío automático"
          disabled={!canEdit}
        />
        <Field label="Hora de envío (0–23, hora local)">
          <Input
            keyboardType="numeric"
            editable={canEdit}
            value={String(form.sendHourLocal)}
            onChangeText={(text) =>
              set("sendHourLocal", Math.min(23, Math.max(0, Math.round(Number(text) || 0))))
            }
          />
        </Field>
        <Field label="Zona horaria">
          <Select
            value={form.timezone}
            options={TIMEZONE_OPTIONS}
            onChange={(v) => set("timezone", v)}
            title="Zona horaria"
            disabled={!canEdit}
          />
        </Field>
        <Field label="Llave PIX (para recibir el pago)">
          <Input
            value={form.pixKey ?? ""}
            editable={canEdit}
            onChangeText={(text) => set("pixKey", text)}
            autoCapitalize="none"
            placeholder="CPF/CNPJ, email, teléfono o llave aleatoria"
          />
        </Field>

        {canEdit ? (
          <Button label={t("common.save")} loading={update.isPending} block onPress={save} />
        ) : null}
      </Stack>
    </Card>
  );
}
