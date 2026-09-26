import { Pressable } from "react-native";
import type { FundingBox } from "@preztiaos/contracts";
import { Banner, Field, MoneyText, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { useFundingBoxes } from "../api/boxes-queries";

/**
 * Selector "Desembolsar desde": lista las cajas/cuentas que la ZONA del crédito puede usar (las
 * del tenant, las de la zona y las de sus zonas superiores; la regla la aplica el servidor) con
 * su saldo, y avisa si el monto no alcanza. El servidor vuelve a validar saldo y zona al postear.
 */
export function FundingBoxPicker({
  zoneId,
  value,
  onChange,
  amountMinor,
}: {
  zoneId: string | null;
  value: string | null;
  onChange: (boxId: string) => void;
  amountMinor: number;
}) {
  const { t } = useT();
  const boxes = useFundingBoxes(zoneId);
  const items = boxes.data?.items ?? [];
  const selected = items.find((b) => b.id === value) ?? null;

  return (
    <>
      <Field label={t("review.approve.fundingSource")} hint={t("review.approve.fundingHint")} required>
        {!zoneId ? (
          <Text variant="caption" tone="muted">
            {t("cash.funding.needZone")}
          </Text>
        ) : boxes.isPending ? (
          <Spinner label={t("common.loading")} />
        ) : items.length === 0 ? (
          <Banner tone="warning" title={t("review.approve.fundingEmpty")} />
        ) : (
          <Stack gap="xs">
            {items.map((b) => (
              <FundingBoxOption key={b.id} box={b} selected={b.id === value} onPress={() => onChange(b.id)} />
            ))}
          </Stack>
        )}
      </Field>
      {isFundingInsufficient(selected, amountMinor) ? (
        <Banner tone="danger" title={t("review.approve.fundingInsufficient")} />
      ) : null}
    </>
  );
}

/** ¿El saldo de la caja elegida no alcanza para el monto? (aviso previo; el servidor decide). */
export function isFundingInsufficient(box: FundingBox | null, amountMinor: number): boolean {
  return box != null && amountMinor > 0 && amountMinor > box.balanceMinor;
}

function FundingBoxOption({
  box,
  selected,
  onPress,
}: {
  box: FundingBox;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`min-h-[48px] flex-row items-center justify-between rounded-xl border px-3 ${
        selected ? "border-brand-600 bg-brand-50 dark:bg-zinc-800" : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <Text variant="label" tone={selected ? "primary" : "muted"}>
        {box.name}
      </Text>
      <MoneyText variant="label" amountMinor={box.balanceMinor} currency={box.currency} />
    </Pressable>
  );
}
