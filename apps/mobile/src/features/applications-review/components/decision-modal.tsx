import { useState } from "react";
import { Pressable, View } from "react-native";
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
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
  majorToMinor,
  minorToMajor,
} from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useCashDashboard } from "@/features/cash/api/boxes-queries";
import { BorrowerPicker } from "./borrower-picker";

// El dominio interpreta interestPct como base-mil (200 = 20%); la UI captura % y convierte.
const PERCENT_TO_BASE_THOUSAND = 10;

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

  // Si hay un plan negociado, sus términos definen el crédito: no se piden a mano (se ocultan).
  const fromPlan = planTerms(planOffer);

  // Caja/cuenta de la que saldrá el dinero: solo CASH y BANK (la caja de tránsito no desembolsa).
  const dashboard = useCashDashboard();
  const fundableBoxes = (dashboard.data?.boxes ?? []).filter((b) => b.type !== "TRANSIT");
  const selectedBox = fundableBoxes.find((b) => b.id === fundingCashBoxId) ?? null;
  const principalMinor = fromPlan ? fromPlan.principalMinor : majorToMinor(Number(principal) || 0);
  // El servidor también valida el saldo (fail-fast), pero lo avisamos antes de enviar.
  const fundsInsufficient =
    selectedBox != null && principalMinor > 0 && principalMinor > selectedBox.balanceMinor;

  // Regla de negocio: aprobar requiere deudor, zona resuelta y una caja/cuenta origen con saldo.
  const canApprove =
    borrower != null && zoneId != null && fundingCashBoxId != null && !fundsInsufficient;

  const submitApprove = () => {
    if (!borrower || !zoneId || !fundingCashBoxId) return;
    const candidate = {
      borrowerId: borrower.id,
      zoneId,
      principalMinor: fromPlan ? fromPlan.principalMinor : majorToMinor(Number(principal)),
      interestPct: fromPlan ? fromPlan.interestPct : Number(interest) * PERCENT_TO_BASE_THOUSAND,
      installmentsCount: fromPlan ? fromPlan.installmentsCount : Math.trunc(Number(installments)),
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
                  <Field label={t("credit.new.interest")} error={errors.interestPct} hint="20 = 20%" required>
                    <Input keyboardType="numeric" value={interest} onChangeText={setInterest} invalid={!!errors.interestPct} />
                  </Field>
                  <Field label={t("credit.new.installments")} error={errors.installmentsCount} required>
                    <Input keyboardType="number-pad" value={installments} onChangeText={setInstallments} invalid={!!errors.installmentsCount} />
                  </Field>
                </>
              )}

              {/* Caja/cuenta de la que sale el dinero: el otorgamiento la debita (DISBURSEMENT). */}
              <Field label={t("review.approve.fundingSource")} hint={t("review.approve.fundingHint")} required>
                {dashboard.isPending ? (
                  <Spinner label={t("common.loading")} />
                ) : fundableBoxes.length === 0 ? (
                  <Banner tone="warning" title={t("review.approve.fundingEmpty")} />
                ) : (
                  <Stack gap="xs">
                    {fundableBoxes.map((b) => {
                      const isSelected = b.id === fundingCashBoxId;
                      return (
                        <Pressable
                          key={b.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: isSelected }}
                          onPress={() => setFundingCashBoxId(b.id)}
                          className={`min-h-[48px] flex-row items-center justify-between rounded-xl border px-3 ${
                            isSelected
                              ? "border-brand-600 bg-brand-50 dark:bg-zinc-800"
                              : "border-zinc-200 dark:border-zinc-700"
                          }`}
                        >
                          <Text variant="label" tone={isSelected ? "primary" : "muted"}>
                            {b.name}
                          </Text>
                          <MoneyText variant="label" amountMinor={b.balanceMinor} currency={b.currency} />
                        </Pressable>
                      );
                    })}
                  </Stack>
                )}
              </Field>
              {fundsInsufficient ? (
                <Banner tone="danger" title={t("review.approve.fundingInsufficient")} />
              ) : null}

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
                    : t("review.approve.needFunding")}
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
