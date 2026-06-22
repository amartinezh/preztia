import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import type { ApproveApplicationInput, RejectApplicationInput } from "@preztiaos/contracts";
import { Badge, Button, Card, ErrorState, Row, Spinner, Stack, Text, minorToMajor } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useApplicationReview,
  useApproveApplication,
  useOfferPlans,
  useRejectApplication,
} from "../api/queries";
import { applicationStatusBadge } from "../components/review-status";
import { DocumentsTable } from "../components/documents-table";
import { LocationCard } from "../components/location-card";
import { VerdictHistory } from "../components/verdict-history";
import { ConversationPanel } from "../components/conversation-panel";
import { DocumentViewer } from "../components/document-viewer";
import { DecisionModal, type DecisionMode } from "../components/decision-modal";
import { PlanOfferPanel } from "../components/plan-offer-panel";

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
  const offer = useOfferPlans(applicationId);

  const [conversationOpen, setConversationOpen] = useState(false);
  const [viewerDocument, setViewerDocument] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionMode>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);

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

  // Oferta de planes (botón azul). Resuelve para que el panel cierre el modal; rechaza para dejarlo
  // abierto mostrando el error.
  const onOffer = async (principalMinor: number) => {
    setOfferError(null);
    try {
      await offer.mutateAsync({ principalMinor });
    } catch (err) {
      setOfferError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));
      throw err;
    }
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

        {/* Precarga: monto solicitado por WhatsApp + datos del cliente extraídos del OCR. */}
        <Card>
          <Stack gap="xs">
            <Text variant="heading">{t("review.detail.applicant")}</Text>
            <Row className="justify-between">
              <Text tone="muted">{t("review.detail.requestedAmount")}</Text>
              <Text variant="label">
                {detail.requestedAmountMinor != null ? String(minorToMajor(detail.requestedAmountMinor)) : "—"}
              </Text>
            </Row>
            <Row className="justify-between">
              <Text tone="muted">{t("borrower.nationalId")}</Text>
              <Text variant="label">{detail.extractedIdentity?.nationalId ?? "—"}</Text>
            </Row>
            <Row className="justify-between">
              <Text tone="muted">{t("borrower.name")}</Text>
              <Text variant="label">{detail.extractedIdentity?.fullName ?? "—"}</Text>
            </Row>
          </Stack>
        </Card>

        <Stack gap="sm">
          <Text variant="heading">{t("review.detail.documents")}</Text>
          <DocumentsTable
            applicationId={applicationId}
            documents={detail.documents}
            onViewOriginal={setViewerDocument}
          />
        </Stack>

        {detail.location ? <LocationCard location={detail.location} /> : null}

        <Stack gap="sm">
          <Text variant="heading">{t("review.detail.history")}</Text>
          <VerdictHistory history={detail.verdictHistory} />
        </Stack>

        {!decided ? (
          <PlanOfferPanel
            planOffer={detail.planOffer}
            offering={offer.isPending}
            offerError={offerError}
            requestedAmountMinor={detail.requestedAmountMinor}
            onOffer={onOffer}
          />
        ) : null}

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
      <DocumentViewer
        applicationId={applicationId}
        documentType={viewerDocument}
        visionVerdict={
          detail.documents.find((d) => d.documentType === viewerDocument)?.visionVerdict ?? null
        }
        onClose={() => setViewerDocument(null)}
      />
      <DecisionModal
        mode={decision}
        applicantPhone={detail.applicantPhone}
        planOffer={detail.planOffer}
        zoneId={detail.zoneId}
        extractedIdentity={detail.extractedIdentity}
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
