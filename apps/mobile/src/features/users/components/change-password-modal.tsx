import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { changeMyPasswordInput } from "@preztiaos/contracts";
import { Banner, Button, Field, Input, Modal, Stack, Text, useToast } from "@preztiaos/ui";

import { api, tenantHeader, unwrap } from "@/core/api/client";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";

/** Cambio de la PROPIA contraseña: exige la actual; el servidor la verifica y audita el cambio. */
function useChangeMyPassword() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) =>
      unwrap(await api.changeMyPassword({ headers: tenantHeader(), body: input })),
  });
}

/**
 * Modal "Cambiar contraseña" del menú de usuario. Tres campos (actual, nueva, repetir), validación
 * del contrato y confirmación visible al terminar. Hasta ahora el ítem estaba deshabilitado y nadie
 * dentro de la empresa podía cambiar su clave (hallazgo C3 del informe de usabilidad).
 */
export function ChangePasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const change = useChangeMyPassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCurrent("");
    setNext("");
    setRepeat("");
    setError(null);
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = () => {
    setError(null);
    if (next !== repeat) {
      setError(t("password.mismatch"));
      return;
    }
    const parsed = changeMyPasswordInput.safeParse({ currentPassword: current, newPassword: next });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    change.mutate(parsed.data, {
      onSuccess: () => {
        toast.show({ tone: "success", title: t("password.changed") });
        close();
      },
      onError: (err) =>
        setError(
          isApiError(err) && err.status === 401
            ? t("password.currentWrong")
            : isApiError(err)
              ? t(err.messageKey)
              : t("errors.unknown"),
        ),
    });
  };

  return (
    <Modal visible={visible} onClose={close} title={t("password.title")} closeLabel={t("common.close")}>
      <Stack gap="md" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Text variant="caption" tone="muted">
          {t("password.hint")}
        </Text>
        <Field label={t("password.current")} required>
          <Input
            secureTextEntry
            autoComplete="current-password"
            value={current}
            onChangeText={setCurrent}
            accessibilityLabel={t("password.current")}
          />
        </Field>
        <Field label={t("password.new")} required hint={t("password.newHint")}>
          <Input
            secureTextEntry
            autoComplete="new-password"
            value={next}
            onChangeText={setNext}
            accessibilityLabel={t("password.new")}
          />
        </Field>
        <Field label={t("password.repeat")} required>
          <Input
            secureTextEntry
            autoComplete="new-password"
            value={repeat}
            onChangeText={setRepeat}
            onSubmitEditing={submit}
            returnKeyType="done"
            accessibilityLabel={t("password.repeat")}
          />
        </Field>
        <Button
          label={t("password.submit")}
          loading={change.isPending}
          disabled={!current || next.length < 8 || !repeat}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
  );
}
