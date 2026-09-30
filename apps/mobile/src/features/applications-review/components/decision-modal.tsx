import { useState } from "react";
import { View } from "react-native";
import {
  approveApplicationInput,
  rejectApplicationInput,
  type ApproveApplicationInput,
  type ExtractedIdentityView,
  type PlanOfferView,
  type RejectApplicationInput,
} from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Field,
  Input,
  Modal,
  Row,
  Select,
  Stack,
  Text,
  majorToMinor,
  minorToMajor,
} from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useFundingBoxes } from "@/features/cash/api/boxes-queries";
import { FundingBoxPicker, isFundingInsufficient } from "@/features/cash/components/funding-box-picker";
import { useInterestRules } from "@/features/credit/hooks/use-interest-rules";
import { BorrowerPicker } from "./borrower-picker";

// El dominio interpreta interestPct como base-mil (200 = 20%); la UI captura % y convierte.
const PERCENT_TO_BASE_THOUSAND = 10;

// Longitud mínima del motivo (espejo de `approveApplicationInput.reason.min(3)` del contrato):
// gatea el botón de aprobar/rechazar para que no se envíe una decisión sin justificación.
const MIN_REASON_LENGTH = 3;

// Valor centinela del selector de plan cuando los términos se escriben a mano (sin plan).
const CUSTOM_PLAN = "CUSTOM";

export type DecisionMode = "approve" | "reject" | null;

type Props = {
  mode: DecisionMode;
  applicantPhone: string;
  planOffer: PlanOfferView;
  /** Zona resuelta automáticamente desde la línea de WhatsApp (no editable). */
  zoneId: string | null;
  /** Datos del cliente extraídos por OCR (para crear el deudor con un clic). */
  extractedIdentity: ExtractedIdentityView | null;
  approving: boolean;
  rejecting: boolean;
  submitError: string | null;
  onClose: () => void;
  onApprove: (input: ApproveApplicationInput) => void;
  onReject: (input: RejectApplicationInput) => void;
};

/** Hay un plan negociado cuyos términos definirán el crédito (el server los aplica, no el body). */
function planTerms(planOffer: PlanOfferView) {
  if (
    planOffer.offeredPlanName == null ||
    planOffer.offeredPrincipalMinor == null ||
    planOffer.offeredPlanInstallments == null ||
    planOffer.offeredPlanInterestPct == null
  ) {
    return null;
  }
  return {
    name: planOffer.offeredPlanName,
    principalMinor: planOffer.offeredPrincipalMinor,
    installmentsCount: planOffer.offeredPlanInstallments,
    interestPct: planOffer.offeredPlanInterestPct,
  };
}

type ApproveErrors = Partial<Record<keyof ApproveApplicationInput, string>>;

/**
 * Modal de decisión manual del coordinador. En modo "approve": la zona se asigna automáticamente
 * (línea de WhatsApp → zona) y el deudor se crea desde el OCR o se elige de los existentes; el
 * botón de aprobar solo se habilita con un `Deudor (UUID)` válido (regla de negocio). Los términos
 * vienen del plan negociado si lo hubo; si no, se capturan a mano. En "reject" pide solo el motivo.
 */
export function DecisionModal({
  mode,
  applicantPhone,
  planOffer,
  zoneId,
  extractedIdentity,
  approving,
  rejecting,
  submitError,
  onClose,
  onApprove,
  onReject,
}: Props) {
  const { t } = useT();

  const [borrower, setBorrower] = useState<{ id: string; label: string } | null>(null);
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const [installments, setInstallments] = useState("");
  const [reason, setReason] = useState("");
  const [fundingCashBoxId, setFundingCashBoxId] = useState<string | null>(null);
  const [errors, setErrors] = useState<ApproveErrors>({});
  // Plan elegido cuando no hubo oferta negociada (`null` = aún no elige: cae al por defecto).
  const [planChoice, setPlanChoice] = useState<string | null>(null);
  const rules = useInterestRules();

  // Si hay un plan negociado, sus términos definen el crédito: no se piden a mano (se ocultan).
  const fromPlan = planTerms(planOffer);

  // Sin plan negociado se elige un plan activo (o "Personalizado", si está permitido). Con el interés
  // bloqueado, el del plan no se puede cambiar: el servidor rechaza cualquier diferencia (antifraude).
  const planId = planChoice ?? rules.defaultPlan?.id ?? (rules.customAllowed ? CUSTOM_PLAN : (rules.activePlans[0]?.id ?? CUSTOM_PLAN));
  const selectedPlan = rules.activePlans.find((p) => p.id === planId) ?? null;
  const interestLocked = rules.locked && selectedPlan !== null;
  const noPlanAvailable = !fromPlan && !rules.customAllowed && selectedPlan === null;
  // Mientras no se elija ni edite nada, el plan por defecto pre-llena los términos.
  const prefilled = planChoice === null && selectedPlan !== null;
  const typedInterest = interestLocked || prefilled ? String(selectedPlan!.interestPct / 10) : interest;
  const typedInstallments = prefilled ? String(selectedPlan!.installmentsCount) : installments;
  // Editar un término fija la elección actual (deja de pre-llenarse desde el plan por defecto).
  const editTerm = (setter: (v: string) => void) => (v: string) => {
    if (planChoice === null && selectedPlan) {
      setInterest(String(selectedPlan.interestPct / 10));
      setInstallments(String(selectedPlan.installmentsCount));
    }
    setPlanChoice(planId);
    setter(v);
  };
  const planOptions = [
    ...rules.activePlans.map((p) => ({ value: p.id, label: p.name, hint: `${p.installmentsCount} cuotas · ${p.interestPct / 10}%` })),
    ...(rules.customAllowed ? [{ value: CUSTOM_PLAN, label: t("credit.new.plan.custom") }] : []),
  ];
  const onChangePlan = (id: string) => {
    setPlanChoice(id);
    const plan = rules.activePlans.find((p) => p.id === id);
    if (plan) {
      setInterest(String(plan.interestPct / 10));
      setInstallments(String(plan.installmentsCount));
    }
  };

  // Caja/cuenta de la que saldrá el dinero: solo las que la zona del crédito puede usar.
  const fundingBoxes = useFundingBoxes(zoneId);
  const selectedBox = (fundingBoxes.data?.items ?? []).find((b) => b.id === fundingCashBoxId) ?? null;
  const principalMinor = fromPlan ? fromPlan.principalMinor : majorToMinor(Number(principal) || 0);
  // El servidor también valida el saldo (fail-fast), pero lo avisamos antes de enviar.
  const fundsInsufficient = isFundingInsufficient(selectedBox, principalMinor);

  // El motivo es obligatorio (min 3 según el contrato): gatea el envío para no aprobar sin justificar.
  const reasonValid = reason.trim().length >= MIN_REASON_LENGTH;

  // Regla de negocio: aprobar requiere deudor, zona resuelta, una caja/cuenta origen con saldo y motivo.
  const canApprove =
    borrower != null &&
    zoneId != null &&
    fundingCashBoxId != null &&
    !fundsInsufficient &&
    !noPlanAvailable &&
    reasonValid;

  const submitApprove = () => {
    if (!borrower || !zoneId || !fundingCashBoxId) return;
    const candidate = {
      borrowerId: borrower.id,
      zoneId,
      principalMinor: fromPlan ? fromPlan.principalMinor : majorToMinor(Number(principal)),
      interestPct: fromPlan ? fromPlan.interestPct : Number(typedInterest) * PERCENT_TO_BASE_THOUSAND,
      installmentsCount: fromPlan ? fromPlan.installmentsCount : Math.trunc(Number(typedInstallments)),
      // Sin oferta negociada, el plan elegido es la fuente del interés y de la periodicidad.
      ...(!fromPlan && selectedPlan ? { paymentPlanId: selectedPlan.id, frequency: selectedPlan.frequency } : {}),
      borrowerPhone: applicantPhone,
      reason: reason.trim(),
      fundingCashBoxId,
    };
    const parsed = approveApplicationInput.safeParse(candidate);
    if (!parsed.success) {
      const next: ApproveErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof ApproveApplicationInput | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    onApprove(parsed.data);
  };

  const submitReject = () => {
    const parsed = rejectApplicationInput.safeParse({ reason: reason.trim() });
    if (!parsed.success) {
      setErrors({ reason: parsed.error.issues[0]?.message });
      return;
    }
    setErrors({});
    onReject(parsed.data);
  };

  return (
    <Modal
      visible={mode != null}
      onClose={onClose}
      title={mode === "approve" ? t("review.approve.title") : t("review.reject.title")}
    >
      <View className="p-4">
        <Stack gap="md">
          {submitError ? <Banner tone="danger" title={submitError} /> : null}

          {mode === "approve" ? (
            <>
              <Text variant="caption" tone="muted">
                Generarás el crédito para {applicantPhone}.
              </Text>

              {/* Zona: asignada automáticamente desde la línea de WhatsApp (no editable). */}
              <Field label={t("review.approve.zone")}>
                {zoneId ? (
                  <Text variant="code">{zoneId}</Text>
                ) : (
                  <Banner tone="warning" title={t("review.approve.zoneMissing")} />
                )}
              </Field>

              {/* Deudor: crear desde OCR o elegir existente. Habilita el botón de aprobar. */}
              <Field label={t("review.approve.borrower")}>
                <BorrowerPicker
                  extractedIdentity={extractedIdentity}
                  applicantPhone={applicantPhone}
                  selected={borrower}
                  onSelect={setBorrower}
                />
              </Field>

              {fromPlan ? (
                // Términos definidos por el plan negociado: se muestran como informativos.
                <Stack gap="xs" className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
                  <Text variant="label">{t("review.approve.planTerms")}</Text>
                  <Row className="justify-between">
                    <Text tone="muted">{t("offer.plan")}</Text>
                    <Text variant="label">{fromPlan.name}</Text>
                  </Row>
                  <Row className="justify-between">
                    <Text tone="muted">{t("credit.new.principal")}</Text>
                    <Text variant="label">{String(minorToMajor(fromPlan.principalMinor))}</Text>
                  </Row>
                  <Row className="justify-between">
                    <Text tone="muted">{t("credit.new.installments")}</Text>
                    <Text variant="label">{String(fromPlan.installmentsCount)}</Text>
                  </Row>
                  <Row className="justify-between">
                    <Text tone="muted">{t("credit.new.interest")}</Text>
                    <Text variant="label">{`${(fromPlan.interestPct / 10).toFixed(1)}%`}</Text>
                  </Row>
                </Stack>
              ) : (
                <>
                  <Field label={t("credit.new.principal")} error={errors.principalMinor} hint="Monto en unidades mayores" required>
                    <Input keyboardType="numeric" value={principal} onChangeText={setPrincipal} invalid={!!errors.principalMinor} />
                  </Field>
                  {rules.locked ? (
                    <Banner
                      tone="info"
                      title={t(rules.customAllowed ? "credit.new.interestLocked.admin" : "credit.new.interestLocked")}
                    />
                  ) : null}
                  {noPlanAvailable && !rules.loading ? <Banner tone="warning" title={t("credit.new.noActivePlans")} /> : null}
                  <Field label={t("credit.new.plan")}>
                    <Select value={planId} options={planOptions} onChange={onChangePlan} title={t("credit.new.plan")} />
                  </Field>
                  <Field
                    label={t("credit.new.interest")}
                    error={errors.interestPct}
                    hint={interestLocked ? t("credit.new.interest.fromPlan") : "20 = 20%"}
                    required
                  >
                    <Input
                      keyboardType="numeric"
                      editable={!interestLocked}
                      value={typedInterest}
                      onChangeText={editTerm(setInterest)}
                      invalid={!!errors.interestPct}
                    />
                  </Field>
                  <Field label={t("credit.new.installments")} error={errors.installmentsCount} required>
                    <Input
                      keyboardType="number-pad"
                      value={typedInstallments}
                      onChangeText={editTerm(setInstallments)}
                      invalid={!!errors.installmentsCount}
                    />
                  </Field>
                </>
              )}

              {/* Caja/cuenta de la que sale el dinero: el otorgamiento la debita (DISBURSEMENT). */}
              <FundingBoxPicker
                zoneId={zoneId}
                value={fundingCashBoxId}
                onChange={setFundingCashBoxId}
                amountMinor={principalMinor}
              />

              <Field label={t("review.approve.reason")} error={errors.reason} required>
                <Input value={reason} onChangeText={setReason} invalid={!!errors.reason} multiline />
              </Field>
              <Button
                label={t("review.approve.submit")}
                loading={approving}
                disabled={!canApprove}
                block
                onPress={submitApprove}
              />
              {!canApprove ? (
                <Text variant="caption" tone="muted">
                  {borrower == null || zoneId == null
                    ? t("review.approve.needBorrower")
                    : fundingCashBoxId == null || fundsInsufficient
                      ? t("review.approve.needFunding")
                      : t("review.approve.needReason")}
                </Text>
              ) : null}
            </>
          ) : null}

          {mode === "reject" ? (
            <>
              <Field label={t("review.reject.reason")} error={errors.reason} required>
                <Input value={reason} onChangeText={setReason} invalid={!!errors.reason} multiline />
              </Field>
              <Button label={t("review.reject.submit")} variant="danger" loading={rejecting} block onPress={submitReject} />
            </>
          ) : null}
        </Stack>
      </View>
    </Modal>
  );
}
