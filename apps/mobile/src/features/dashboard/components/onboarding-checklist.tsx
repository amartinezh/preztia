import { useRouter, type Href } from "expo-router";
import { Button, Card, Row, Stack, Text } from "@preztiaos/ui";

import { can } from "@/core/auth/authorization";
import type { UserRole } from "@/core/auth/jwt";
import { useSession } from "@/core/auth/session";
import { useT, type MessageKey } from "@/core/i18n";
import { useCashDashboard } from "@/features/cash/api/boxes-queries";
import { useActivePaymentPlans } from "@/features/payment-plans/api/queries";
import { useMessagingChannels } from "@/features/settings/api/queries";
import { useUsersList } from "@/features/users/api/queries";
import { useZonesList } from "@/features/zones/api/queries";

type Step = {
  key: string;
  label: MessageKey;
  done: boolean;
  /** false cuando la consulta falló (p. ej. 403 para el coordinador): el paso no se muestra. */
  known: boolean;
  href: Href;
  /** ¿Este rol puede resolverlo desde la app? Si no, se le indica que lo hace el administrador. */
  canResolve: boolean;
};

/**
 * Checklist de puesta en marcha del panel (ADMIN y COORDINATOR): lo mínimo para que la empresa pueda
 * prestar y cobrar. Solo aparece mientras falte algo; cada paso pendiente lleva a donde se resuelve.
 * Las consultas que usa ya existen en sus slices (zonas, cajas, planes, usuarios, canales).
 */
export function OnboardingChecklist() {
  const { role } = useSession();
  if (role !== "ADMIN" && role !== "COORDINATOR") return null;
  return <ChecklistCard role={role} />;
}

function ChecklistCard({ role }: { role: UserRole }) {
  const { t, tf } = useT();
  const router = useRouter();
  const zones = useZonesList();
  const cash = useCashDashboard();
  const plans = useActivePaymentPlans();
  const coordinators = useUsersList("COORDINATOR");
  const collectors = useUsersList("COLLECTOR");
  const channels = useMessagingChannels();

  // Mientras algo carga no se muestra nada: una lista a medias invitaría a "resolver" lo que ya está.
  const loading = [zones, cash, plans, coordinators, collectors, channels].some((q) => q.isPending);
  if (loading) return null;

  const isAdmin = role === "ADMIN";
  const boxes = cash.data?.boxes ?? [];
  const officeBoxes = boxes.filter((b) => b.type === "CASH" && b.assignedTo === null);
  const routeBoxes = boxes.filter((b) => b.type === "CASH" && b.assignedTo !== null);
  const hasActiveUser = (list: typeof coordinators) =>
    (list.data?.pages.flatMap((p) => p.items) ?? []).some((u) => u.active);
  const messaging = channels.data;

  const allSteps: Step[] = [
    {
      key: "zone",
      label: "onboarding.zone",
      done: (zones.data?.items.length ?? 0) > 0,
      known: zones.isSuccess,
      href: "/zones" as Href,
      canResolve: can(role, "zone:manage"),
    },
    {
      key: "officeBox",
      label: "onboarding.officeBox",
      done: officeBoxes.some((b) => b.balanceMinor > 0),
      known: cash.isSuccess,
      href: "/cash/config" as Href,
      canResolve: can(role, "cash:admin"),
    },
    {
      key: "routeBox",
      label: "onboarding.routeBox",
      done: routeBoxes.length > 0,
      known: cash.isSuccess,
      href: "/cash/config" as Href,
      canResolve: can(role, "cash:admin"),
    },
    {
      key: "plan",
      label: "onboarding.plan",
      done: (plans.data?.items.length ?? 0) > 0,
      known: plans.isSuccess,
      href: "/payment-plans" as Href,
      canResolve: isAdmin,
    },
    {
      key: "coordinator",
      label: "onboarding.coordinator",
      done: hasActiveUser(coordinators),
      known: coordinators.isSuccess,
      href: "/users" as Href,
      canResolve: can(role, "user:manage"),
    },
    {
      key: "collector",
      label: "onboarding.collector",
      done: hasActiveUser(collectors),
      known: collectors.isSuccess,
      href: "/users" as Href,
      // El coordinador también crea cobradores dentro de su alcance.
      canResolve: can(role, "collector:manage"),
    },
    {
      key: "channel",
      label: "onboarding.channel",
      done: !!messaging && (messaging.whatsappEnabled || messaging.telegramEnabled),
      known: channels.isSuccess,
      href: "/settings?tab=whatsapp" as Href,
      canResolve: isAdmin,
    },
  ];
  const steps = allSteps.filter((step) => step.known);

  const done = steps.filter((s) => s.done).length;
  if (steps.length === 0 || done === steps.length) return null;

  return (
    <Card>
      <Stack gap="sm">
        <Stack gap="xs">
          <Text variant="heading">{t("onboarding.title")}</Text>
          <Text variant="caption" tone="muted">
            {t("onboarding.subtitle")} · {tf("onboarding.progress", { done, total: steps.length })}
          </Text>
        </Stack>
        {steps.map((step) => (
          <Row key={step.key} className="items-center justify-between gap-2">
            <Row className="flex-1 items-center gap-2">
              <Text variant="label" tone={step.done ? "success" : "muted"} accessibilityElementsHidden>
                {step.done ? "✓" : "○"}
              </Text>
              <Text
                variant="body"
                tone={step.done ? "muted" : "default"}
                className="flex-1"
                accessibilityLabel={`${step.done ? t("payment.validations.confirmed") : t("payment.validations.pending")}: ${t(step.label)}`}
              >
                {t(step.label)}
              </Text>
            </Row>
            {step.done ? null : step.canResolve ? (
              <Button label={t("onboarding.go")} size="sm" variant="secondary" onPress={() => router.push(step.href)} />
            ) : (
              <Text variant="caption" tone="muted">
                {t("onboarding.askAdmin")}
              </Text>
            )}
          </Row>
        ))}
      </Stack>
    </Card>
  );
}
