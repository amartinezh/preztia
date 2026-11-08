import { useState } from "react";
import { View } from "react-native";
import type { PlanOfferStatus, PlanOfferView } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Field,
  Modal,
  MoneyInput,
  MoneyText,
  Row,
  Stack,
  Text,
  formatDateTime,
  type BadgeTone,
} from "@preztiaos/ui";

import { moneyInputText } from "@/components/money-input-text";
import { useT } from "@/core/i18n";
import { useTenantCurrency } from "@/features/cash/api/boxes-queries";
import { useOperationalSettings } from "@/features/settings/api/queries";
import { isOfferAwaitingClient } from "./review-status";

// Presentación del sub-estado de la oferta (espejo del enum del contrato).
const OFFER_LABEL: Record<PlanOfferStatus, string> = {
  NOT_OFFERED: "Sin ofertar",
  AWAITING_SELECTION: "Esperando que el cliente elija",
  AWAITING_ACCEPTANCE: "Esperando aceptación del cliente",
  ACCEPTED: "Aceptado por el cliente",
  DECLINED: "Rechazado por el cliente",
};

const OFFER_TONE: Record<PlanOfferStatus, BadgeTone> = {
  NOT_OFFERED: "neutral",
  AWAITING_SELECTION: "warning",
  AWAITING_ACCEPTANCE: "warning",
  ACCEPTED: "success",
  DECLINED: "danger",
};

type Props = {
  planOffer: PlanOfferView;
  offering: boolean;
  offerError: string | null;
  /** Monto que el cliente solicitó por WhatsApp (unidades menores): prellena el campo Capital. */
  requestedAmountMinor: number | null;
  /** Lanza la oferta; resuelve en éxito (cierra el modal) o rechaza (lo deja abierto con el error). */
  onOffer: (principalMinor: number) => Promise<void>;
};

/**
 * Panel de NEGOCIACIÓN del plan (Fase 10): muestra el sub-estado de la oferta + la bandera de
 * aceptación del cliente y ofrece el "botón azul" para ofertar planes por WhatsApp. El monto del
 * préstamo se captura en un modal (prellenado con lo que el cliente pidió por WhatsApp); el resto
 * de términos los aporta el plan (en el servidor).
 */
export function PlanOfferPanel({
  planOffer,
  offering,
  offerError,
  requestedAmountMinor,
  onOffer,
}: Props) {
  const { t, locale } = useT();
  const currency = useTenantCurrency();
  const settings = useOperationalSettings();
  // Capital prellenado con el monto que el cliente declaró por WhatsApp (editable por el coordinador).
  // Texto tecleado + lectura en unidades menores (`null` = vacío o ilegible): nunca se convierte en silencio.
  const requestedText = requestedAmountMinor != null ? moneyInputText(requestedAmountMinor) : "";
  const [modalOpen, setModalOpen] = useState(false);
  const [principal, setPrincipal] = useState(requestedText);
  const [principalMinor, setPrincipalMinor] = useState<number | null>(requestedAmountMinor);
  const principalValid = principalMinor !== null && principalMinor > 0;

  const offered = planOffer.status !== "NOT_OFFERED";

  const submit = async () => {
    if (principalMinor === null || principalMinor <= 0) return;
    try {
      await onOffer(principalMinor);
      setModalOpen(false);
    } catch {
      // El error se muestra vía `offerError`; el modal permanece abierto para reintentar.
    }
  };

  // Abre el modal reponiendo el monto solicitado por el cliente (prellenado editable).
  const openModal = () => {
    setPrincipal(requestedText);
    setPrincipalMinor(requestedAmountMinor);
    setModalOpen(true);
  };

  return (
    <Stack gap="sm">
      <Row className="items-center justify-between">
        <Text variant="heading">{t("offer.title")}</Text>
        <Badge tone={OFFER_TONE[planOffer.status]} label={OFFER_LABEL[planOffer.status]} />
      </Row>

      {planOffer.status === "ACCEPTED" ? (
        <Banner tone="success" title={t("offer.acceptedFlag")} />
      ) : null}

      {/* Mientras se espera al cliente, el sondeo en vivo refresca el expediente solo. */}
      {isOfferAwaitingClient(planOffer.status) ? (
        <Text variant="caption" tone="muted">
          {t("offer.liveHint")}
        </Text>
      ) : null}

      {offered ? (
        <Stack gap="xs">
          {planOffer.offeredPlanName ? (
            <Row className="justify-between">
              <Text tone="muted">{t("offer.plan")}</Text>
              <Text variant="label">{planOffer.offeredPlanName}</Text>
            </Row>
          ) : null}
          {planOffer.offeredPrincipalMinor != null ? (
            <Row className="justify-between">
              <Text tone="muted">{t("offer.principal")}</Text>
              <MoneyText variant="label" amountMinor={planOffer.offeredPrincipalMinor} currency={currency} />
            </Row>
          ) : null}
          {planOffer.offerExpiresAt ? (
            <Row className="justify-between">
              <Text tone="muted">{t("offer.expires")}</Text>
              <Text variant="label">{formatDateTime(planOffer.offerExpiresAt, locale, settings.data?.timeZone)}</Text>
            </Row>
          ) : null}
        </Stack>
      ) : null}

      {offerError ? <Banner tone="danger" title={offerError} /> : null}

      {/* Botón azul: ofertar (o re-ofertar). No se muestra si el cliente ya aceptó. */}
      {planOffer.status !== "ACCEPTED" ? (
        <Button
          label={offered ? t("offer.reoffer") : t("offer.offer")}
          loading={offering}
          onPress={openModal}
        />
      ) : null}

      <Modal visible={modalOpen} onClose={() => setModalOpen(false)} title={t("offer.modalTitle")}>
        <View className="p-4">
          <Stack gap="md">
            <Text variant="caption" tone="muted">
              {t("offer.modalHint")}
            </Text>
            <Field label={t("credit.new.principal")} hint={t("money.hint")} required>
              <MoneyInput
                value={principal}
                onChangeText={setPrincipal}
                onChangeAmount={setPrincipalMinor}
                currency={currency}
                invalidLabel={t("money.invalid")}
              />
            </Field>
            <Button
              label={t("offer.send")}
              loading={offering}
              disabled={!principalValid}
              block
              onPress={submit}
            />
          </Stack>
        </View>
      </Modal>
    </Stack>
  );
}
