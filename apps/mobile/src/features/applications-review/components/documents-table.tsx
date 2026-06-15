import { View } from "react-native";
import { Badge, Button, Card, Row, Stack, Text } from "@preztiaos/ui";
import type { ApplicationDocumentDetail } from "@preztiaos/contracts";

import { useT } from "@/core/i18n";
import { documentLabel, documentStatusBadge } from "./review-status";

type Props = {
  documents: ApplicationDocumentDetail[];
  onViewOriginal: (documentType: string) => void;
};

/**
 * Tabla responsiva de los documentos del expediente: tipo, estado (verde/ámbar/rojo), riesgo,
 * confianza de la IA, marca de revisión manual y acción para abrir el original. En una sola
 * columna de cards apilados se adapta de móvil a web sin scroll horizontal.
 */
export function DocumentsTable({ documents, onViewOriginal }: Props) {
  const { t } = useT();
  return (
    <Stack gap="sm">
      {documents.map((doc) => {
        const badge = documentStatusBadge(doc.status);
        return (
          <Card key={doc.documentType} className="gap-2">
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

            <View className="pt-1">
              <Button
                label={t("review.detail.viewOriginal")}
                size="sm"
                variant="secondary"
                disabled={!doc.hasOriginal}
                onPress={() => onViewOriginal(doc.documentType)}
              />
            </View>
          </Card>
        );
      })}
    </Stack>
  );
}
