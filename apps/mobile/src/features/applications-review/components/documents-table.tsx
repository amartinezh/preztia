import { Alert, View } from "react-native";
import { Badge, Button, Card, Row, Stack, Text } from "@preztiaos/ui";
import type { ApplicationDocumentDetail } from "@preztiaos/contracts";

import { useT } from "@/core/i18n";
import { useReExtractDocument } from "../api/queries";
import { AntifraudVisionPanel } from "./antifraud-vision-panel";
import { documentLabel, documentStatusBadge } from "./review-status";

type Props = {
  applicationId: string;
  documents: ApplicationDocumentDetail[];
  onViewOriginal: (documentType: string) => void;
};

/**
 * Tabla responsiva de los documentos del expediente: tipo, estado (verde/ámbar/rojo), riesgo,
 * confianza de la IA, marca de revisión manual y acciones (ver original + reintentar lectura con
 * IA). En una sola columna de cards apilados se adapta de móvil a web sin scroll horizontal.
 */
export function DocumentsTable({ applicationId, documents, onViewOriginal }: Props) {
  return (
    <Stack gap="sm">
      {documents.map((doc) => (
        <DocumentCard
          key={doc.documentType}
          applicationId={applicationId}
          doc={doc}
          onViewOriginal={onViewOriginal}
        />
      ))}
    </Stack>
  );
}

/**
 * Card de un documento. Cada uno gestiona su propia mutación de re-extracción, de modo que el
 * estado de carga del botón "Reintentar lectura con IA" es independiente por documento.
 */
function DocumentCard({
  applicationId,
  doc,
  onViewOriginal,
}: {
  applicationId: string;
  doc: ApplicationDocumentDetail;
  onViewOriginal: (documentType: string) => void;
}) {
  const { t } = useT();
  const badge = documentStatusBadge(doc.status);
  const reExtract = useReExtractDocument(applicationId);

  const onReExtract = () => {
    reExtract.mutate(doc.documentType, {
      onSuccess: (result) =>
        Alert.alert(
          result.extracted ? "Lectura completada" : "No se pudo leer",
          result.extracted
            ? `IA identificó: ${result.identifiedType ?? "—"} · Confianza ${result.confidence ?? 0}%`
            : (result.reason ?? "Inténtalo de nuevo."),
        ),
      onError: () => Alert.alert("Error", "No se pudo reintentar la lectura con IA."),
    });
  };

  return (
    <Card className="gap-2">
      <Row className="items-start justify-between">
        <Stack gap="xs" className="flex-1 pr-2">
          <Text variant="label">{documentLabel(doc.documentType)}</Text>
          {doc.identifiedType ? (
            <Text variant="caption" tone="muted">
              IA: {doc.identifiedType}
              {doc.matchesExpected === false ? " · no coincide" : ""}
            </Text>
          ) : null}
        </Stack>
        <Badge tone={badge.tone} label={badge.label} />
      </Row>

      <Row className="flex-wrap gap-2">
        {doc.fraudScore != null ? (
          <Badge
            tone={doc.fraudScore > 0 ? "warning" : "success"}
            label={`${t("review.detail.score")} ${doc.fraudScore}`}
          />
        ) : null}
        {doc.confidence != null ? (
          <Badge tone="info" label={`${t("review.detail.confidence")} ${doc.confidence}%`} />
        ) : null}
        {doc.manualReview ? <Badge tone="warning" label={t("review.detail.manualReview")} /> : null}
      </Row>

      {doc.fraudReasons && doc.fraudReasons.length > 0 ? (
        <Stack gap="xs">
          {doc.fraudReasons.map((reason, i) => (
            <Text key={i} variant="caption" tone="danger">
              • {reason}
            </Text>
          ))}
        </Stack>
      ) : null}

      {doc.visionVerdict ? <AntifraudVisionPanel verdict={doc.visionVerdict} /> : null}

      <Row className="flex-wrap gap-2 pt-1">
        <Button
          label={t("review.detail.viewOriginal")}
          size="sm"
          variant="secondary"
          disabled={!doc.hasOriginal}
          onPress={() => onViewOriginal(doc.documentType)}
        />
        <Button
          label={doc.documentType === "BUSINESS_PHOTO" ? "Re-estudiar con IA" : "Reintentar lectura con IA"}
          size="sm"
          loading={reExtract.isPending}
          disabled={!doc.hasOriginal}
          onPress={onReExtract}
        />
      </Row>
    </Card>
  );
}
