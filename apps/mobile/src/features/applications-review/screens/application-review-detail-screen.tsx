import { useState } from "react";
import { View } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { ApproveApplicationInput, RejectApplicationInput } from "@preztiaos/contracts";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
  formatDateTime,
  useBreakpoint,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { newIdempotencyKey } from "@/core/ids";
import { useTenantCurrency } from "@/features/cash/api/boxes-queries";
import { useOperationalSettings } from "@/features/settings/api/queries";
import { useZonesList } from "@/features/zones/api/queries";
import {
  useApplicationReview,
  useApproveApplication,
  useOfferPlans,
  usePlanOfferLive,
  useRejectApplication,
  type DocumentFileRef,
} from "../api/queries";
import { applicationStatusBadge, verdictBadge } from "../components/review-status";
import { DocumentsTable } from "../components/documents-table";
import { LocationCard } from "../components/location-card";
import { VerdictHistory } from "../components/verdict-history";
import { ConversationPanel } from "../components/conversation-panel";
import { DocumentViewer } from "../components/document-viewer";
import { DecisionModal, type DecisionMode } from "../components/decision-modal";
import { PlanOfferPanel } from "../components/plan-offer-panel";

/**
 * Expediente para el coordinador: un RESUMEN arriba (solicitante, monto, zona, veredicto vigente,
 * estado, antigüedad) con las decisiones a la mano, y debajo los documentos (con acceso al
 * original) y la conversación / oferta / historial antifraude; en escritorio, en dos columnas.
 * Las decisiones se repiten al pie para quien leyó todo. Solo orquesta hooks + componentes.
 */
export function ApplicationReviewDetailScreen({ applicationId }: { applicationId: string }) {
  const { t, locale } = useT();
  const router = useRouter();
  const { isDesktop } = useBreakpoint();
  const currency = useTenantCurrency();
  const zones = useZonesList();
  const settings = useOperationalSettings();
  const query = useApplicationReview(applicationId);
  const approve = useApproveApplication(applicationId);
  const reject = useRejectApplication(applicationId);
  const offer = useOfferPlans(applicationId);
  // Respuesta del cliente en vivo: mientras la oferta espera respuesta por WhatsApp, el
  // detalle se refresca solo apenas el cliente conteste (sin recargar la pantalla).
  usePlanOfferLive(applicationId, query.data?.planOffer.status);

  const [conversationOpen, setConversationOpen] = useState(false);
  const [viewerFile, setViewerFile] = useState<DocumentFileRef | null>(null);
  const [decision, setDecision] = useState<DecisionMode>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [offerError, setOfferError] = useState<string | null>(null);
  // Aprobar desembolsa: la clave es estable por intento (un reintento tras un timeout no otorga dos
  // veces) y se renueva solo tras el éxito.
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError) {
    return (
      <ErrorState
        title={t("review.detail.title")}
        description={t("errors.network")}
        retryLabel={t("common.retry")}
        onRetry={() => query.refetch()}
      />
    );
  }

  const detail = query.data;
  const status = applicationStatusBadge(detail.status);
  const currentRun = detail.verdictHistory[0];
  const verdict = verdictBadge(currentRun?.status ?? null);
  const decided = detail.status === "APPROVED" || detail.status === "REJECTED";
  const applicantName = detail.extractedIdentity?.fullName ?? null;
  const zoneName = detail.zoneId
    ? ((zones.data?.items ?? []).find((z) => z.id === detail.zoneId)?.name ?? null)
    : null;

  const openDecision = (mode: Exclude<DecisionMode, null>) => {
    setSubmitError(null);
    setDecision(mode);
  };

  const onApprove = (input: ApproveApplicationInput) => {
    setSubmitError(null);
    approve.mutate({ ...input, idempotencyKey }, {
      onSuccess: (res) => {
        setIdempotencyKey(newIdempotencyKey());
        setDecision(null);
        // El detalle del crédito anuncia "Crédito otorgado · cuota $X" con la cuota real del servidor.
        router.replace(`/credit/${res.creditId}?granted=1` as Href);
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

  // Decisiones: arriba (en el resumen) y al pie. Resuelto el expediente, solo se informa.
  const decisionButtons = !decided ? (
    <Row gap="sm" className="flex-wrap">
      <View className="min-w-[160px] flex-1">
        <Button label={t("review.approve.submit")} block onPress={() => openDecision("approve")} />
      </View>
      <View className="min-w-[160px] flex-1">
        <Button label={t("review.reject.submit")} variant="danger" block onPress={() => openDecision("reject")} />
      </View>
    </Row>
  ) : (
    <Text tone="muted">{t("review.detail.resolved")}</Text>
  );

  const summary = (
    <Card>
      <Stack gap="sm">
        <Row className="items-start justify-between">
          <Stack gap="xs" className="flex-1">
            <Text variant="subtitle">{applicantName ?? detail.applicantPhone}</Text>
            {applicantName ? <Text tone="muted">{detail.applicantPhone}</Text> : null}
          </Stack>
          <Badge tone={status.tone} label={status.label} />
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("review.detail.requestedAmount")}</Text>
          {detail.requestedAmountMinor != null ? (
            <MoneyText variant="label" amountMinor={detail.requestedAmountMinor} currency={currency} />
          ) : (
            <Text variant="label">—</Text>
          )}
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("review.detail.zone")}</Text>
          <Text variant="label">{zoneName ?? "—"}</Text>
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("review.detail.verdict")}</Text>
          <Badge
            tone={verdict.tone}
            label={currentRun ? `${verdict.label} ${currentRun.score}` : verdict.label}
          />
        </Row>
        <Row className="justify-between">
          <Text tone="muted">{t("review.detail.received")}</Text>
          <Text variant="label">{formatDateTime(detail.createdAt, locale, settings.data?.timeZone)}</Text>
        </Row>
        {decisionButtons}
      </Stack>
    </Card>
  );

  const documentsColumn = (
    <Stack gap="lg">
      <Stack gap="sm">
        <Text variant="heading">{t("review.detail.documents")}</Text>
        <DocumentsTable
          applicationId={applicationId}
          documents={detail.documents}
          onViewOriginal={setViewerFile}
        />
      </Stack>
      {detail.location ? <LocationCard location={detail.location} /> : null}
    </Stack>
  );

  const historyColumn = (
    <Stack gap="lg">
      <Button label={t("review.detail.viewConversation")} variant="secondary" onPress={() => setConversationOpen(true)} />

      {/* Datos del cliente extraídos del OCR (precarga del alta al aprobar). */}
      <Card>
        <Stack gap="xs">
          <Text variant="heading">{t("review.detail.applicant")}</Text>
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

      {!decided ? (
        <PlanOfferPanel
          planOffer={detail.planOffer}
          offering={offer.isPending}
          offerError={offerError}
          requestedAmountMinor={detail.requestedAmountMinor}
          onOffer={onOffer}
        />
      ) : null}

      <Stack gap="sm">
        <Text variant="heading">{t("review.detail.history")}</Text>
        <VerdictHistory history={detail.verdictHistory} />
      </Stack>
    </Stack>
  );

  return (
    <Screen>
      <Stack gap="lg">
        {summary}

        {isDesktop ? (
          <Row gap="lg" className="items-start">
            <View className="flex-1">{documentsColumn}</View>
            <View className="flex-1">{historyColumn}</View>
          </Row>
        ) : (
          <>
            {documentsColumn}
            {historyColumn}
          </>
        )}

        {decisionButtons}
      </Stack>

      <ConversationPanel applicationId={applicationId} visible={conversationOpen} onClose={() => setConversationOpen(false)} />
      <DocumentViewer
        applicationId={applicationId}
        file={viewerFile}
        visionVerdict={
          detail.documents.find((d) => d.documentType === viewerFile?.documentType)
            ?.visionVerdict ?? null
        }
        onClose={() => setViewerFile(null)}
      />
      {/* `key={mode}`: cada decisión arranca limpia (el motivo no se arrastra entre rechazar y aprobar). */}
      <DecisionModal
        key={decision ?? "idle"}
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
