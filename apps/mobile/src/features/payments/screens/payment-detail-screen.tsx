import { useState } from "react";
import { View } from "react-native";
import type { PaymentDetail } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { can } from "@/core/auth/authorization";
import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { paymentBadge } from "../components/payment-status";
import { ReceiptViewer } from "../components/receipt-viewer";
import { usePaymentDetail, useManualVerifyPayment } from "../api/queries";

const MIN_REASON = 5;

/**
 * Detalle/auditoría de un intento de pago: datos del pagador, metadata íntegra de la IA, respuesta
 * del banco, proceso completo (eventos append-only) y comprobante con zoom. El coordinador/admin
 * puede VALIDAR MANUALMENTE el abono escribiendo un motivo obligatorio.
 */
export function PaymentDetailScreen({ paymentId }: { paymentId: string }) {
  const { t } = useT();
  const { role } = useSession();
  const query = usePaymentDetail(paymentId);
  const verify = useManualVerifyPayment(paymentId);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  if (query.isError) {
    return (
      <ErrorState
        title={t("payment.detail.title")}
        description={t("errors.network")}
        onRetry={() => query.refetch()}
      />
    );
  }

  const p = query.data;
  const badge = paymentBadge(p.status);
  const canVerify = can(role, "application:review") && p.status !== "VERIFIED";

  const submitVerify = () => {
    setError(null);
    if (reason.trim().length < MIN_REASON) {
      setError(t("payment.verify.reasonRequired"));
      return;
    }
    verify.mutate(
      { reason: reason.trim() },
      {
        onSuccess: () => setReason(""),
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Screen>
      <Stack gap="lg">
        <Row className="justify-between">
          <Stack gap="xs">
            <Text variant="subtitle">{p.payerName ?? t("payment.detail.title")}</Text>
            {p.amountMinor !== null ? (
              <MoneyText variant="heading" amountMinor={p.amountMinor} currency={p.currency} />
            ) : (
              <Text tone="muted">{t("payment.amountIllegible")}</Text>
            )}
          </Stack>
          <Badge tone={badge.tone} label={badge.label} />
        </Row>

        {/* Motivo destacado por el que el intento fue marcado/no verificado. */}
        {p.flagReasons && p.flagReasons.length > 0 ? (
          <Banner
            tone={p.status === "REJECTED_FRAUD" ? "danger" : "warning"}
            title={t("payment.flag.title")}
            description={p.flagReasons.join("\n")}
          />
        ) : null}

        {p.hasReceipt ? (
          <Button
            label={t("payment.receipt.view")}
            variant="secondary"
            onPress={() => setViewerOpen(true)}
          />
        ) : null}

        {/* Datos del pagador (PII completa: el revisor está autorizado). */}
        <Card>
          <Stack gap="xs">
            <Text variant="heading">{t("payment.section.payer")}</Text>
            <KV label="CPF/CNPJ" value={p.payerTaxId} />
            <KV label={t("payment.bank")} value={p.payerBankName} />
            <KV label="Pix" value={p.receiverPixKey} />
            <KV label="End-to-end" value={p.endToEndId} />
            <KV label="TXID" value={p.txid} />
            <KV label={t("payment.paidAt")} value={p.paidAt} />
            <KV label={t("payment.phone")} value={p.payerPhone} />
          </Stack>
        </Card>

        {/* Verificación bancaria: qué respondió el banco y por qué. */}
        <Card>
          <Stack gap="xs">
            <Text variant="heading">{t("payment.section.bank")}</Text>
            <KV label={t("payment.bankStatus")} value={p.bankStatus} />
            <KV label={t("payment.attempts")} value={String(p.reconciliationAttempts)} />
            <KV label={t("payment.lastReconcile")} value={p.lastReconciliationAt} />
            {p.bankResponse != null ? <JsonBlock value={p.bankResponse} /> : null}
          </Stack>
        </Card>

        {/* Metadata íntegra extraída por la IA del comprobante. */}
        <Card>
          <Stack gap="xs">
            <Text variant="heading">{t("payment.section.extraction")}</Text>
            {p.extraction ? <JsonBlock value={p.extraction} /> : <Text tone="muted">—</Text>}
          </Stack>
        </Card>

        {/* Proceso completo: antifraude → banco → decisión → validación manual. */}
        <Stack gap="sm">
          <Text variant="heading">{t("payment.section.process")}</Text>
          {p.events.length === 0 ? (
            <Text tone="muted">—</Text>
          ) : (
            p.events.map((e, i) => (
              <Card key={`${e.type}-${i}`}>
                <Stack gap="xs">
                  <Row className="justify-between">
                    <Text variant="label">{e.type}</Text>
                    <Text variant="caption" tone="muted">
                      {new Date(e.createdAt).toLocaleString()}
                    </Text>
                  </Row>
                  {e.payload != null ? <JsonBlock value={e.payload} /> : null}
                </Stack>
              </Card>
            ))
          )}
        </Stack>

        {/* Validación manual (ADMIN/COORDINATOR): motivo OBLIGATORIO. */}
        {canVerify ? (
          <Card>
            <Stack gap="sm">
              <Text variant="heading">{t("payment.verify.title")}</Text>
              <Text variant="caption" tone="muted">
                {t("payment.verify.hint")}
              </Text>
              {error ? <Banner tone="danger" title={error} /> : null}
              <Field label={t("payment.verify.reason")} required>
                <Input value={reason} onChangeText={setReason} multiline />
              </Field>
              <Button
                label={t("payment.verify.submit")}
                loading={verify.isPending}
                disabled={reason.trim().length < MIN_REASON}
                block
                onPress={submitVerify}
              />
            </Stack>
          </Card>
        ) : null}
      </Stack>

      <ReceiptViewer paymentId={viewerOpen ? paymentId : null} onClose={() => setViewerOpen(false)} />
    </Screen>
  );
}

function KV({ label, value }: { label: string; value: string | null }) {
  return (
    <Row className="justify-between">
      <Text tone="muted">{label}</Text>
      <Text variant="label">{value ?? "—"}</Text>
    </Row>
  );
}

/** Render legible de un objeto JSON arbitrario (metadata IA, respuesta del banco, payload). */
function JsonBlock({ value }: { value: PaymentDetail["bankResponse"] }) {
  return (
    <View className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
      <Text variant="code">{JSON.stringify(value, null, 2)}</Text>
    </View>
  );
}
