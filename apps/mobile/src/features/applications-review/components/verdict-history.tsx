import { Badge, Card, EmptyState, Row, Stack, Text, formatDateTime } from "@preztiaos/ui";
import type { ValidationRunView } from "@preztiaos/contracts";

import { useT } from "@/core/i18n";
import { useOperationalSettings } from "@/features/settings/api/queries";
import { documentLabel, severityTone, verdictBadge } from "./review-status";

type Props = { history: ValidationRunView[] };

/**
 * Historial APPEND-ONLY del análisis antifraude: cada corrida del pipeline con su veredicto,
 * score, alertas (por documento + severidad + detalle) y fuentes consultadas. La primera es la
 * vigente; las demás conservan, sin borrarse, por qué se marcó cada documento. Es la
 * trazabilidad que el coordinador revisa antes de decidir.
 */
export function VerdictHistory({ history }: Props) {
  const { t, locale } = useT();
  const settings = useOperationalSettings();
  if (history.length === 0) {
    return <EmptyState title={t("review.detail.noHistory")} />;
  }
  return (
    <Stack gap="md">
      {history.map((run, index) => {
        const badge = verdictBadge(run.status);
        return (
          <Card key={run.id} className="gap-3">
            <Row className="justify-between">
              <Row gap="sm">
                <Badge tone={badge.tone} label={badge.label} />
                <Badge tone={run.score > 0 ? "warning" : "success"} label={`${t("review.detail.score")} ${run.score}`} />
                {index === 0 ? <Badge tone="info" label={t("review.verdict.current")} /> : null}
              </Row>
              <Text variant="caption" tone="muted">
                {formatDateTime(run.createdAt, locale, settings.data?.timeZone)}
              </Text>
            </Row>

            {run.alerts.length > 0 ? (
              <Stack gap="sm">
                {run.alerts.map((alert, i) => (
                  <Stack key={i} gap="xs">
                    <Row gap="sm">
                      <Badge tone={severityTone(alert.severidad)} label={alert.severidad} />
                      <Text variant="caption" tone="muted">
                        {alert.documento === "CRUCE" ? "Cruce de documentos" : documentLabel(alert.documento)} · {alert.campo}
                      </Text>
                    </Row>
                    <Text variant="caption">{alert.detalle}</Text>
                  </Stack>
                ))}
              </Stack>
            ) : (
              <Text variant="caption" tone="muted">
                Sin alertas en esta corrida.
              </Text>
            )}

            {run.consultedSources.length > 0 ? (
              <Text variant="caption" tone="muted">
                {t("review.detail.sources")}: {run.consultedSources.join(", ")}
              </Text>
            ) : null}
          </Card>
        );
      })}
    </Stack>
  );
}
