import { useState } from "react";
import { View } from "react-native";
import {
  approveApplicationInput,
  rejectApplicationInput,
  type ApproveApplicationInput,
  type RejectApplicationInput,
} from "@preztiaos/contracts";
import { Banner, Button, Field, Input, Modal, Stack, Text, majorToMinor } from "@preztiaos/ui";

import { useT } from "@/core/i18n";

// El dominio interpreta interestPct como base-mil (200 = 20%); la UI captura % y convierte.
const PERCENT_TO_BASE_THOUSAND = 10;

export type DecisionMode = "approve" | "reject" | null;

type Props = {
  mode: DecisionMode;
  applicantPhone: string;
  approving: boolean;
  rejecting: boolean;
  submitError: string | null;
  onClose: () => void;
  onApprove: (input: ApproveApplicationInput) => void;
  onReject: (input: RejectApplicationInput) => void;
};

type ApproveErrors = Partial<Record<keyof ApproveApplicationInput, string>>;

/**
 * Modal de decisión manual del coordinador. En modo "approve" captura los términos del crédito
 * (mismo zod del contrato) + motivo y, al confirmar, aprueba el expediente y genera el crédito.
 * En modo "reject" pide solo el motivo. La validación de frontera vive en el contrato.
 */
export function DecisionModal({
  mode,
  applicantPhone,
  approving,
  rejecting,
  submitError,
  onClose,
  onApprove,
  onReject,
}: Props) {
  const { t } = useT();

  const [borrowerId, setBorrowerId] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const [installments, setInstallments] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<ApproveErrors>({});

  const submitApprove = () => {
    const candidate = {
      borrowerId: borrowerId.trim(),
      zoneId: zoneId.trim(),
      principalMinor: majorToMinor(Number(principal)),
      interestPct: Number(interest) * PERCENT_TO_BASE_THOUSAND,
      installmentsCount: Math.trunc(Number(installments)),
      borrowerPhone: applicantPhone,
      reason: reason.trim(),
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
              <Field label="Deudor (UUID)" error={errors.borrowerId} required>
                <Input autoCapitalize="none" value={borrowerId} onChangeText={setBorrowerId} invalid={!!errors.borrowerId} />
              </Field>
              <Field label="Zona (UUID)" error={errors.zoneId} required>
                <Input autoCapitalize="none" value={zoneId} onChangeText={setZoneId} invalid={!!errors.zoneId} />
              </Field>
              <Field label={t("credit.new.principal")} error={errors.principalMinor} hint="Monto en unidades mayores" required>
                <Input keyboardType="numeric" value={principal} onChangeText={setPrincipal} invalid={!!errors.principalMinor} />
              </Field>
              <Field label={t("credit.new.interest")} error={errors.interestPct} hint="20 = 20%" required>
                <Input keyboardType="numeric" value={interest} onChangeText={setInterest} invalid={!!errors.interestPct} />
              </Field>
              <Field label={t("credit.new.installments")} error={errors.installmentsCount} required>
                <Input keyboardType="number-pad" value={installments} onChangeText={setInstallments} invalid={!!errors.installmentsCount} />
              </Field>
              <Field label={t("review.approve.reason")} error={errors.reason} required>
                <Input value={reason} onChangeText={setReason} invalid={!!errors.reason} multiline />
              </Field>
              <Button label={t("review.approve.submit")} loading={approving} block onPress={submitApprove} />
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
