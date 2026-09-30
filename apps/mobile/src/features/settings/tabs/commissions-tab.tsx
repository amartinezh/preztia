import { useState } from "react";
import type { CommissionBase, ZoneCommissionView } from "@preztiaos/contracts";
import { Badge, Banner, Button, Card, Field, Input, Modal, Row, Select, Spinner, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { perMille } from "@/features/settlements/components/settlement-view";
import { useCommissionSettings, useSetZoneCommission } from "../api/queries";

const COMMISSION_BASES: CommissionBase[] = ["COLLECTED", "REMITTED", "PRINCIPAL_RECOVERED"];
// Los porcentajes viajan en base mil (50 = 5 %), como el interés.
const PER_MILLE_PER_PERCENT = 10;
// Sangría por nivel del árbol de zonas.
const INDENT_PER_LEVEL = 16;

/**
 * Tab COMISIONES: el coordinador (y el ADMIN) define por zona el porcentaje y la base de la comisión
 * de sus cobradores. Una zona sin configuración propia hereda de su zona superior o del valor por
 * defecto; nadie supera el tope del ADMIN. El servidor recorta las zonas al alcance de quien mira.
 */
export function CommissionsTab({ canEdit }: { canEdit: boolean }) {
  const { t } = useT();
  const query = useCommissionSettings();
  const [editing, setEditing] = useState<ZoneCommissionView | null>(null);
  const settings = query.data;
  if (query.isPending || !settings) return <Spinner label={t("common.loading")} />;

  return (
    <Stack gap="lg">
      <Card>
        <Stack gap="sm">
          <Text variant="heading">{t("commission.settings.title")}</Text>
          <Text variant="caption" tone="muted">{t("commission.settings.intro")}</Text>
          <Row className="justify-between">
            <Text tone="muted">{t("commission.settings.default")}</Text>
            <Text variant="label">
              {perMille(settings.tenantDefault.ratePerMille)} · {t(`commission.base.${settings.tenantDefault.base}`)}
            </Text>
          </Row>
          <Row className="justify-between">
            <Text tone="muted">{t("commission.settings.cap")}</Text>
            <Text variant="label">{perMille(settings.capPerMille)}</Text>
          </Row>
          {settings.capPerMille === 0 ? <Banner tone="warning" title={t("commission.settings.capZero")} /> : null}
        </Stack>
      </Card>

      <Card>
        <Stack gap="sm">
          {settings.zones.length === 0 ? <Text tone="muted">{t("commission.settings.empty")}</Text> : null}
          {settings.zones.map((zone) => (
            <Row
              key={zone.zoneId}
              className="flex-wrap items-center justify-between gap-2 border-b border-zinc-100 py-2 dark:border-zinc-800"
              style={{ paddingLeft: (zone.path.split(".").length - 1) * INDENT_PER_LEVEL }}
            >
              <Stack gap="xs" className="flex-1">
                <Text variant="label">{zone.name}</Text>
                <Text variant="caption" tone="muted">
                  {zone.own
                    ? t("commission.settings.own")
                    : zone.effective.sourceZoneId
                      ? `${t("commission.settings.inherited")} ${zone.effective.sourceZoneName ?? "—"}`
                      : t("commission.settings.fromDefault")}
                </Text>
              </Stack>
              <Text variant="label">
                {perMille(zone.effective.ratePerMille)} · {t(`commission.base.short.${zone.effective.base}`)}
              </Text>
              {zone.effective.cappedByLimit ? <Badge label={t("settlement.commissions.capped")} tone="warning" /> : null}
              {canEdit ? (
                <Button label={t("commission.settings.edit")} variant="secondary" size="sm" onPress={() => setEditing(zone)} />
              ) : null}
            </Row>
          ))}
        </Stack>
      </Card>

      {editing ? (
        <ZoneCommissionModal zone={editing} capPerMille={settings.capPerMille} onClose={() => setEditing(null)} />
      ) : null}
    </Stack>
  );
}

function ZoneCommissionModal({
  zone,
  capPerMille,
  onClose,
}: {
  zone: ZoneCommissionView;
  capPerMille: number;
  onClose: () => void;
}) {
  const { t } = useT();
  const save = useSetZoneCommission();
  const initial = zone.own ?? zone.effective;
  const [percent, setPercent] = useState(String(initial.ratePerMille / PER_MILLE_PER_PERCENT));
  const [base, setBase] = useState<CommissionBase>(initial.base);
  const [error, setError] = useState<string | null>(null);
  const ratePerMille = Math.round((Number(percent.replace(",", ".")) || 0) * PER_MILLE_PER_PERCENT);
  const aboveCap = ratePerMille > capPerMille;

  const submit = (policy: { ratePerMille: number; base: CommissionBase } | null) => {
    setError(null);
    save.mutate(
      { zoneId: zone.zoneId, policy },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible onClose={onClose} title={zone.name}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("commission.settings.rate")} hint={`${t("commission.settings.rateHint")} ${perMille(capPerMille)}`}>
          <Input keyboardType="numeric" value={percent} onChangeText={setPercent} />
        </Field>
        <Field label={t("commission.settings.base")}>
          <Select
            value={base}
            options={COMMISSION_BASES.map((b) => ({ value: b, label: t(`commission.base.${b}`) }))}
            onChange={(v) => setBase(v)}
          />
        </Field>
        {aboveCap ? <Banner tone="danger" title={t("errors.commission.aboveCap")} /> : null}
        <Button
          label={t("commission.settings.save")}
          loading={save.isPending}
          disabled={aboveCap || ratePerMille < 0}
          block
          onPress={() => submit({ ratePerMille, base })}
        />
        {zone.own ? (
          <Button
            label={t("commission.settings.inherit")}
            variant="ghost"
            loading={save.isPending}
            block
            onPress={() => submit(null)}
          />
        ) : null}
      </Stack>
    </Modal>
  );
}
