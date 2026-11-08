import { useState } from "react";
import type { UserSummary } from "@preztiaos/contracts";
import { updateUserInput } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  ConfirmModal,
  Field,
  Input,
  Modal,
  Row,
  Stack,
  Text,
  useToast,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useZonesList } from "@/features/zones/api/queries";
import { useUpdateUser, type UserPatch } from "../api/queries";
import { ROLE_KEY, userLabel } from "./user-presentation";
import { ZoneChecklist } from "./zone-checklist";

// Espejo del mínimo del contrato (`password: z.string().min(8)`).
const MIN_PASSWORD_LENGTH = 8;

type PendingAction = "toggle" | "password";

/**
 * Detalle de un usuario del alcance: activar/desactivar (confirmado), nombre visible, zonas por
 * casillas y restablecer la contraseña (confirmado: la anterior deja de servir al instante). Cada
 * bloque guarda por separado con su propio PATCH; el servidor valida jerarquía y alcance. El cuerpo
 * se remonta por usuario (`key`) para que los borradores no se crucen entre personas.
 */
export function UserDetailModal({ user, onClose }: { user: UserSummary | null; onClose: () => void }) {
  const { t } = useT();
  return (
    <Modal visible={user !== null} onClose={onClose} title={t("users.detail.title")} closeLabel={t("common.close")}>
      {user ? <DetailBody key={user.id} user={user} /> : null}
    </Modal>
  );
}

function DetailBody({ user }: { user: UserSummary }) {
  const { t, tf } = useT();
  const toast = useToast();
  const update = useUpdateUser();
  const zones = useZonesList();
  const [name, setName] = useState(user.displayName ?? "");
  const [zonePaths, setZonePaths] = useState<string[]>(user.zonePaths);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const nextDisplayName = trimmedName === "" ? null : trimmedName;
  const nameChanged = nextDisplayName !== user.displayName;
  const zonesChanged =
    zonePaths.length !== user.zonePaths.length || zonePaths.some((p) => !user.zonePaths.includes(p));
  const label = userLabel(user);

  // Qué bloque está guardando: así solo gira el botón que se pulsó.
  const saving = (field: keyof UserPatch) => update.isPending && update.variables?.[field] !== undefined;
  const fail = (err: unknown) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));
  const patch = (body: UserPatch, successTitle: string, onDone?: () => void) => {
    setError(null);
    const parsed = updateUserInput.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    update.mutate(
      { id: user.id, ...body },
      {
        onSuccess: () => {
          toast.show({ tone: "success", title: successTitle });
          onDone?.();
        },
        onError: fail,
        onSettled: () => setPending(null),
      },
    );
  };

  return (
    <>
      <Stack gap="md" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}

        <Stack gap="xs">
          <Text variant="heading">{label}</Text>
          {user.displayName ? (
            <Text variant="caption" tone="muted">
              {user.email}
            </Text>
          ) : null}
          <Row gap="sm" className="items-center">
            <Badge label={t(ROLE_KEY[user.role])} tone="info" />
            <Badge
              label={user.active ? t("users.active") : t("users.inactive")}
              tone={user.active ? "success" : "neutral"}
            />
          </Row>
        </Stack>
        <Button
          label={user.active ? t("tenants.admins.deactivate") : t("tenants.admins.activate")}
          variant={user.active ? "danger" : "secondary"}
          size="sm"
          loading={saving("active")}
          onPress={() => setPending("toggle")}
        />

        <Field label={t("users.detail.name")} hint={t("users.new.displayNameHint")}>
          <Input value={name} onChangeText={setName} autoCapitalize="words" accessibilityLabel={t("users.detail.name")} />
        </Field>
        <Button
          label={t("users.detail.saveName")}
          variant="secondary"
          size="sm"
          loading={saving("displayName")}
          disabled={!nameChanged}
          onPress={() => patch({ displayName: nextDisplayName }, t("users.detail.nameSaved"))}
        />

        <Field label={t("users.detail.zones")} hint={t("users.new.zonesHint")}>
          <ZoneChecklist
            zones={zones.data?.items ?? []}
            selectedPaths={zonePaths}
            onChange={setZonePaths}
            emptyLabel={zones.isPending ? t("common.loading") : t("users.new.zonesEmpty")}
          />
        </Field>
        <Button
          label={t("users.detail.saveZones")}
          variant="secondary"
          size="sm"
          loading={saving("zonePaths")}
          disabled={!zonesChanged}
          onPress={() => patch({ zonePaths }, t("users.detail.zonesSaved"))}
        />

        <Field label={t("users.detail.newPassword")} hint={t("password.newHint")}>
          <Input
            secureTextEntry
            autoComplete="new-password"
            autoCapitalize="none"
            value={password}
            onChangeText={setPassword}
            accessibilityLabel={t("users.detail.newPassword")}
          />
        </Field>
        <Button
          label={t("users.detail.resetPassword")}
          variant="secondary"
          size="sm"
          loading={saving("password")}
          disabled={password.length < MIN_PASSWORD_LENGTH}
          onPress={() => setPending("password")}
        />
      </Stack>

      <ConfirmModal
        visible={pending === "toggle"}
        title={user.active ? t("users.toggle.deactivateTitle") : t("users.toggle.activateTitle")}
        description={tf(user.active ? "users.toggle.deactivateBody" : "users.toggle.activateBody", { email: label })}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        tone={user.active ? "danger" : "primary"}
        loading={saving("active")}
        onConfirm={() => patch({ active: !user.active }, t("users.detail.statusSaved"))}
        onCancel={() => setPending(null)}
      />
      <ConfirmModal
        visible={pending === "password"}
        title={t("users.detail.resetConfirmTitle")}
        description={tf("users.detail.resetConfirmBody", { name: label })}
        confirmLabel={t("users.detail.resetPassword")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        tone="danger"
        loading={saving("password")}
        onConfirm={() => patch({ password }, t("users.detail.passwordReset"), () => setPassword(""))}
        onCancel={() => setPending(null)}
      />
    </>
  );
}
