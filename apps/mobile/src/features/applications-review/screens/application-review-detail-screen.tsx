import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import type { ApproveApplicationInput, RejectApplicationInput } from "@preztiaos/contracts";
import { Badge, Button, ErrorState, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useApplicationReview,
  useApproveApplication,
  useRejectApplication,
} from "../api/queries";
import { applicationStatusBadge } from "../components/review-status";
import { DocumentsTable } from "../components/documents-table";
import { VerdictHistory } from "../components/verdict-history";
import { ConversationPanel } from "../components/conversation-panel";
import { DocumentViewer } from "../components/document-viewer";
import { DecisionModal, type DecisionMode } from "../components/decision-modal";

/**
 * Detalle del expediente para el coordinador: toda la información disponible para aprobar.
 * Tabla de documentos (con su estado y acceso al original), historial antifraude completo,
 * panel de conversación con el cliente y, al pie, las decisiones manuales (aprobar y generar
 * crédito / rechazar). Solo orquesta hooks + componentes; sin transporte ni reglas.
 */
export function ApplicationReviewDetailScreen({ applicationId }: { applicationId: string }) {
  const { t } = useT();
  const router = useRouter();
  const query = useApplicationReview(applicationId);
  const approve = useApproveApplication(applicationId);
  const reject = useRejectApplication(applicationId);

  const [conversationOpen, setConversationOpen] = useState(false);
  const [viewerDocument, setViewerDocument] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionMode>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError) {
    return <ErrorState title={t("review.detail.title")} description={t("errors.network")} onRetry={() => query.refetch()} />;
  }

  const detail = query.data;
  const status = applicationStatusBadge(detail.status);
  const decided = detail.status === "APPROVED" || detail.status === "REJECTED";

  const onApprove = (input: ApproveApplicationInput) => {
    setSubmitError(null);
    approve.mutate(input, {
      onSuccess: (res) => {
        setDecision(null);
        router.replace(`/credit/${res.creditId}` as Href);
      },
      onError: (err) => setSubmitError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  const onReject = (input: RejectApplicationInput) => {
    setSubmitError(null);
    reject.mutate(input, {
      onSuccess: () => setDecision(null),
      onError: (err) => setSubmitError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Screen>
      <Stack gap="lg">
        <Row className="justify-between">
          <Stack gap="xs">
            <Text variant="subtitle">{t("review.detail.title")}</Text>
            <Text tone="muted">{detail.applicantPhone}</Text>
          </Stack>
          <Badge tone={status.tone} label={status.label} />
        </Row>

        <Button label={t("review.detail.viewConversation")} variant="secondary" onPress={() => setConversationOpen(true)} />

        <Stack gap="sm">
          <Text variant="heading">{t("review.detail.documents")}</Text>
          <DocumentsTable documents={detail.documents} onViewOriginal={setViewerDocument} />
        </Stack>

        <Stack gap="sm">
          <Text variant="heading">{t("review.detail.history")}</Text>
          <VerdictHistory history={detail.verdictHistory} />
        </Stack>

        {!decided ? (
          <Stack gap="sm">
            <Button label={t("review.approve.submit")} onPress={() => { setSubmitError(null); setDecision("approve"); }} />
            <Button label={t("review.reject.submit")} variant="danger" onPress={() => { setSubmitError(null); setDecision("reject"); }} />
          </Stack>
        ) : (
          <Text tone="muted">Este expediente ya fue resuelto.</Text>
        )}
      </Stack>

      <ConversationPanel applicationId={applicationId} visible={conversationOpen} onClose={() => setConversationOpen(false)} />
      <DocumentViewer applicationId={applicationId} documentType={viewerDocument} onClose={() => setViewerDocument(null)} />
      <DecisionModal
        mode={decision}
        applicantPhone={detail.applicantPhone}
        approving={approve.isPending}
        rejecting={reject.isPending}
        submitError={submitError}
        onClose={() => setDecision(null)}
        onApprove={onApprove}
        onReject={onReject}
      />
    </Screen>
  );
}
