import { useState } from "react";
import { View } from "react-native";
import type { FraudAssessmentView, PaymentDetail } from "@preztiaos/contracts";
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
  type BadgeTone,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { can } from "@/core/auth/authorization";
import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import type { MessageKey } from "@/core/i18n";
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

        {/* Conciliación manual: un crédito REAL coincide y espera la aprobación humana. */}
        {isAwaitingReview(p) ? (
          <Banner
            tone="success"
            title={t("payment.pendingReview.title")}
            description={t("payment.pendingReview.body")}
          />
        ) : null}

        {/* Semáforo de validaciones: correcto ✓ / sospechoso ⚠ / fraudulento ✗, de un vistazo. */}
        <ValidationsCard payment={p} />

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

/** Una validación del semáforo: icono de veredicto + nombre + motivos. */
interface ValidationRowData {
  readonly key: string;
  readonly label: string;
  readonly verdict: { glyph: string; tone: BadgeTone; label: string };
  readonly reasons: readonly string[];
}

/**
 * Tarjeta "Validaciones del pago": muestra de forma GRÁFICA si el pago es correcto o
 * fraudulento y por qué, con una fila por validación (antifraude del comprobante, verificación
 * bancaria en línea, conciliación contra el crédito real y validación manual) más la barra de
 * riesgo de la Fase 1. Los datos salen de la bitácora `fraud_assessment` + el estado del pago.
 */
function ValidationsCard({ payment: p }: { payment: PaymentDetail }) {
  const { t } = useT();
  const rows = buildValidationRows(p, t);
  const structural = latestAssessment(p.assessments, "PHASE1_SCREEN");
  const score = structural?.score ?? null;

  return (
    <Card>
      <Stack gap="sm">
        <Text variant="heading">{t("payment.validations.title")}</Text>
        {rows.map((row) => (
          <Row key={row.key} className="items-start gap-3">
            <Badge tone={row.verdict.tone} label={row.verdict.glyph} />
            <Stack gap="xs" className="flex-1">
              <Row className="justify-between">
                <Text variant="label">{row.label}</Text>
                <Text variant="caption" tone="muted">{row.verdict.label}</Text>
              </Row>
              {row.reasons.map((reason, i) => (
                <Text key={i} variant="caption" tone="muted">• {reason}</Text>
              ))}
            </Stack>
          </Row>
        ))}
        {score !== null ? <RiskBar score={score} label={t("payment.validations.score")} /> : null}
      </Stack>
    </Card>
  );
}

/** Barra de riesgo [0,100] de la Fase 1: verde (bajo) → ámbar → rojo (alto). */
function RiskBar({ score, label }: { score: number; label: string }) {
  const pct = Math.max(0, Math.min(100, score));
  const color = pct >= 80 ? "bg-red-500" : pct >= 40 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <Stack gap="xs">
      <Row className="justify-between">
        <Text variant="caption" tone="muted">{label}</Text>
        <Text variant="caption" tone="muted">{pct}/100</Text>
      </Row>
      <View className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <View className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </View>
    </Stack>
  );
}

function latestAssessment(
  assessments: readonly FraudAssessmentView[],
  phase: FraudAssessmentView["phase"],
): FraudAssessmentView | null {
  const ofPhase = assessments.filter((a) => a.phase === phase);
  return ofPhase.length ? ofPhase[ofPhase.length - 1]! : null;
}

/** ¿Un crédito real quedó conciliado pero el pago sigue esperando aprobación humana? */
function isAwaitingReview(p: PaymentDetail): boolean {
  const settlement = latestAssessment(p.assessments, "PHASE2_SETTLEMENT");
  return p.status === "UNVERIFIED" && settlement?.status === "PENDING_REVIEW";
}

function buildValidationRows(
  p: PaymentDetail,
  tt: (key: MessageKey) => string,
): ValidationRowData[] {
  const ok = (label: string) => ({ glyph: "✓", tone: "success" as BadgeTone, label });
  const warn = (label: string) => ({ glyph: "⚠", tone: "warning" as BadgeTone, label });
  const bad = (label: string) => ({ glyph: "✗", tone: "danger" as BadgeTone, label });
  const pending = (label: string) => ({ glyph: "…", tone: "info" as BadgeTone, label });

  // 1) Antifraude estructural del comprobante (Fase 1: dedup, E2E/ISPB, recebedor, antigüedad).
  const structural = latestAssessment(p.assessments, "PHASE1_SCREEN");
  const structuralVerdict = !structural
    ? pending(tt("payment.validations.pending"))
    : structural.status === "rejected"
      ? bad(tt("payment.validations.rejected"))
      : structural.status === "suspicious"
        ? warn(tt("payment.validations.suspicious"))
        : ok(tt("payment.validations.approved"));

  // 2) Verificación bancaria en línea (Inter per-PIX; PicPay/MP degradan a conciliación).
  const bankVerdict =
    p.bankStatus === "CONFIRMED"
      ? ok(tt("payment.validations.confirmed"))
      : p.bankStatus === "NOT_FOUND"
        ? warn(tt("payment.validations.notFound"))
        : p.bankStatus === "UNAVAILABLE"
          ? pending(tt("payment.validations.unavailable"))
          : pending(tt("payment.validations.pending"));

  // 3) Conciliación contra el crédito real (webhook PicPay / reporte MP): la única
  //    confirmación fuerte cuando no hay verificación en línea. PENDING_REVIEW = crédito real
  //    reservado, esperando la aprobación humana (toggle de conciliación automática apagado).
  const settlement = latestAssessment(p.assessments, "PHASE2_SETTLEMENT");
  const settlementVerdict =
    settlement?.status === "PENDING_REVIEW"
      ? warn(tt("payment.validations.awaitingApproval"))
      : settlement?.status === "CONFIRMED"
        ? ok(tt("payment.validations.confirmed"))
        : p.status === "VERIFIED"
          ? ok(tt("payment.validations.confirmed"))
          : pending(tt("payment.validations.pending"));

  const rows: ValidationRowData[] = [
    {
      key: "structural",
      label: tt("payment.validations.structural"),
      verdict: structuralVerdict,
      reasons: structural?.reasons ?? [],
    },
    {
      key: "bank",
      label: tt("payment.validations.bank"),
      verdict: bankVerdict,
      reasons: [],
    },
    {
      key: "settlement",
      label: tt("payment.validations.settlement"),
      verdict: settlementVerdict,
      reasons: settlement?.reasons ?? [],
    },
  ];

  // 4) Validación manual: solo si un revisor intervino (evento `manual_verification`).
  const manual = p.events.find((e) => e.type === "manual_verification");
  if (manual) {
    rows.push({
      key: "manual",
      label: tt("payment.validations.manual"),
      verdict: ok(tt("payment.validations.confirmed")),
      reasons: [],
    });
  }
  return rows;
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
