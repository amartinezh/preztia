import type { BusinessPhotoVerdict } from "@preztiaos/contracts";
import { Badge, Row, Stack, Text, type BadgeTone } from "@preztiaos/ui";

const RISK_TONE: Record<BusinessPhotoVerdict["riskLevel"], BadgeTone> = {
  LOW: "success",
  MEDIUM: "warning",
  HIGH: "danger",
};
const RISK_LABEL: Record<BusinessPhotoVerdict["riskLevel"], string> = {
  LOW: "Riesgo bajo",
  MEDIUM: "Riesgo medio",
  HIGH: "Riesgo alto",
};

/**
 * Panel de "Análisis Antifraude" por VISIÓN de la foto del local: muestra qué piensa la IA, el
 * nivel de riesgo, la coherencia con el registro comercial, la veracidad estimada y las
 * inconsistencias detectadas. Presentacional: recibe el veredicto ya resuelto del detalle.
 */
export function AntifraudVisionPanel({ verdict }: { verdict: BusinessPhotoVerdict }) {
  return (
    <Stack gap="sm" className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <Row className="items-center justify-between">
        <Text variant="label">Análisis Antifraude (IA de visión)</Text>
        <Badge tone={RISK_TONE[verdict.riskLevel]} label={RISK_LABEL[verdict.riskLevel]} />
      </Row>

      <Row className="flex-wrap gap-2">
        <Badge tone="info" label={`Veracidad ${verdict.veracityScore}%`} />
        <Badge
          tone={verdict.matchesRegistry ? "success" : "danger"}
          label={verdict.matchesRegistry ? "Coincide con el registro" : "No coincide con el registro"}
        />
      </Row>

      {verdict.summary ? (
        <Text variant="caption" tone="muted">
          {verdict.summary}
        </Text>
      ) : null}

      {verdict.inconsistencies.length > 0 ? (
        <Stack gap="xs">
          <Text variant="caption" tone="muted">
            Inconsistencias detectadas:
          </Text>
          {verdict.inconsistencies.map((item, i) => (
            <Text key={i} variant="caption" tone="danger">
              • {item}
            </Text>
          ))}
        </Stack>
      ) : null}
    </Stack>
  );
}
