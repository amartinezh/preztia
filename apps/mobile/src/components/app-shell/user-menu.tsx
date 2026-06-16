import { useState } from "react";
import { Pressable, View } from "react-native";
import { Modal, Row, Stack, Text } from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { useT } from "@/core/i18n";

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Administrador",
  COORDINATOR: "Coordinador",
  COLLECTOR: "Cobrador",
};

/**
 * Identidad del usuario logueado en la barra del shell. Al tocar abre un menú con el perfil
 * (rol/tenant/zonas, derivados del JWT), "Cambiar clave" (aún no desarrollado) y "Cerrar sesión".
 */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const { claims, role, signOut } = useSession();
  const [open, setOpen] = useState(false);

  const roleLabel = role ? ROLE_LABEL[role] ?? role : "—";
  const initials = roleLabel.slice(0, 1).toUpperCase();

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("user.menu.title")}
        onPress={() => setOpen(true)}
        className="min-h-[40px] flex-row items-center gap-2 rounded-full border border-zinc-200 px-2 pr-3 active:bg-zinc-100 dark:border-zinc-700 dark:active:bg-zinc-800"
      >
        <View className="h-7 w-7 items-center justify-center rounded-full bg-brand-600">
          <Text variant="label" tone="inverse">
            {initials}
          </Text>
        </View>
        {compact ? null : (
          <Text variant="label" className="text-[15px]">
            {roleLabel}
          </Text>
        )}
      </Pressable>

      <Modal visible={open} onClose={() => setOpen(false)} title={t("user.menu.title")}>
        <Stack gap="lg" className="p-4">
          <Stack gap="sm">
            <Row className="justify-between">
              <Text tone="muted">{t("user.role")}</Text>
              <Text variant="label">{roleLabel}</Text>
            </Row>
            <Row className="justify-between">
              <Text tone="muted">{t("user.tenant")}</Text>
              <Text variant="code">{claims?.tenantId.slice(0, 8) ?? "—"}</Text>
            </Row>
            <Row className="justify-between">
              <Text tone="muted">{t("user.zones")}</Text>
              <Text variant="label">{claims?.zonePaths.length ?? 0}</Text>
            </Row>
          </Stack>

          <View className="gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            {/* Cambiar clave: deshabilitado a propósito (pendiente de desarrollo). */}
            <View className="min-h-[48px] flex-row items-center justify-between rounded-xl px-3 opacity-50">
              <Text variant="label">{t("user.menu.changePassword")}</Text>
              <Text variant="caption" tone="muted">
                {t("user.menu.soon")}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
                void signOut();
              }}
              className="min-h-[48px] flex-row items-center rounded-xl px-3 active:bg-red-50 dark:active:bg-red-950"
            >
              <Text variant="label" tone="danger">
                {t("auth.signOut")}
              </Text>
            </Pressable>
          </View>
        </Stack>
      </Modal>
    </>
  );
}
