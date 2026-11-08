import { useState } from "react";
import { Pressable, View } from "react-native";
import { Modal, Row, Stack, Text } from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { type MessageKey, SUPPORTED_LOCALES, setLocale, useT } from "@/core/i18n";
import { ChangePasswordModal } from "@/features/users/components/change-password-modal";

const ROLE_KEY: Record<string, MessageKey> = {
  SUPER_ADMIN: "users.role.superAdmin",
  ADMIN: "users.role.admin",
  COORDINATOR: "users.role.coordinator",
  COLLECTOR: "users.role.collector",
};

/**
 * Identidad del usuario logueado en la barra del shell. Al tocar abre un menú con el perfil
 * (rol/tenant/zonas, derivados del JWT), el idioma de la interfaz (Español / Português), "Cambiar
 * contraseña" y "Cerrar sesión".
 */
export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { t, locale } = useT();
  const { claims, role, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const roleKey = role ? ROLE_KEY[role] : undefined;
  const roleLabel = roleKey ? t(roleKey) : role ?? "—";
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

      <Modal visible={open} onClose={() => setOpen(false)} title={t("user.menu.title")} closeLabel={t("common.close")}>
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

          {/* Idioma de la interfaz del operador: cambia al instante y se recuerda en el dispositivo. */}
          <Stack gap="xs" className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <Text tone="muted">{t("user.menu.language")}</Text>
            <Row gap="sm">
              {SUPPORTED_LOCALES.map((option) => {
                const selected = option === locale;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setLocale(option)}
                    className={`min-h-[40px] justify-center rounded-full border px-4 ${
                      selected ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
                    }`}
                  >
                    <Text variant="label" tone={selected ? "primary" : "muted"}>
                      {t(`language.${option}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </Row>
          </Stack>

          <View className="gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
                setChangingPassword(true);
              }}
              className="min-h-[48px] flex-row items-center rounded-xl px-3 active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <Text variant="label">{t("user.menu.changePassword")}</Text>
            </Pressable>
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

      <ChangePasswordModal visible={changingPassword} onClose={() => setChangingPassword(false)} />
    </>
  );
}
