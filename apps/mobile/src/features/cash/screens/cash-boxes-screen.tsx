import { useState } from "react";
import { useRouter, type Href } from "expo-router";
import type { CashDashboardOutput } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Text,
  type BadgeTone,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCashDashboard, useSyncBankBalance } from "../api/boxes-queries";
import { CashCountModal } from "../components/cash-count-modal";

type Box = CashDashboardOutput["boxes"][number];

const SYNC_TONE: Record<"MATCHED" | "MISMATCH" | "UNAVAILABLE", BadgeTone> = {
  MATCHED: "success",
  MISMATCH: "danger",
  UNAVAILABLE: "warning",
};

/** Dashboard financiero de cajas: saldo total + por caja, arqueo y conciliación (Req 5 y 7). */
export function CashBoxesScreen() {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const canManage = can(role, "cash:manage");
  const canAdmin = can(role, "cash:admin");
  const query = useCashDashboard();
  const [arqueoBox, setArqueoBox] = useState<Box | null>(null);

  return (
    <Screen>
      <Stack gap="lg">
        <Row className="justify-between items-center">
          <Text variant="subtitle">{t("cash.boxes.title")}</Text>
          <Row className="gap-2">
            <Button
              label={t("cash.movements.link")}
              variant="secondary"
              size="sm"
              onPress={() => router.push("/cash/movements" as Href)}
            />
            {canAdmin ? (
              <Button
                label={t("cash.config.link")}
                variant="secondary"
                size="sm"
                onPress={() => router.push("/cash/config" as Href)}
              />
            ) : null}
          </Row>
        </Row>

        {query.isPending ? <Spinner label={t("common.loading")} /> : null}
        {query.isError ? <Banner tone="danger" title={t("errors.network")} /> : null}

        {query.data ? (
          <Stack gap="md">
            <Card>
              <Stack gap="sm">
                <Stack gap="xs">
                  <Text tone="muted">{t("cash.boxes.liquidity")}</Text>
                  <MoneyText variant="heading" amountMinor={query.data.liquidityTotalMinor} currency={query.data.currency} />
                </Stack>
                <Row className="justify-between">
                  <Text tone="muted">{t("cash.boxes.cashCustody")}</Text>
                  <MoneyText variant="label" amountMinor={query.data.cashTotalMinor} currency={query.data.currency} />
                </Row>
                <Row className="justify-between">
                  <Text tone="muted">{t("cash.boxes.bankTotal")}</Text>
                  <MoneyText variant="label" amountMinor={query.data.bankTotalMinor} currency={query.data.currency} />
                </Row>
              </Stack>
            </Card>

            {query.data.unidentifiedMinor > 0 ? (
              <Banner
                tone="warning"
                title={t("cash.boxes.unidentified")}
                description={`${query.data.unidentifiedMinor / 100} ${query.data.currency}`}
              />
            ) : null}

            {query.data.boxes.length ? (
              query.data.boxes.map((box) => (
                <BoxCard
                  key={box.id}
                  box={box}
                  canManage={canManage}
                  canAdmin={canAdmin}
                  onArqueo={() => setArqueoBox(box)}
                />
              ))
            ) : (
              <EmptyState title={t("cash.boxes.empty")} />
            )}
          </Stack>
        ) : null}
      </Stack>

      <CashCountModal box={arqueoBox} visible={arqueoBox !== null} onClose={() => setArqueoBox(null)} />
    </Screen>
  );
}

function BoxCard({
  box,
  canManage,
  canAdmin,
  onArqueo,
}: {
  box: Box;
  canManage: boolean;
  canAdmin: boolean;
  onArqueo: () => void;
}) {
  const { t } = useT();
  const sync = useSyncBankBalance();
  const [error, setError] = useState<string | null>(null);
  const last = box.lastReconciliation;

  const onSync = () => {
    setError(null);
    sync.mutate(box.id, {
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Card>
      <Stack gap="sm">
        <Row className="justify-between items-center">
          <Stack gap="xs">
            <Text variant="label">{box.name}</Text>
            <Row className="items-center gap-2">
              <Badge label={t(`cash.boxes.type.${box.type}`)} tone={box.type === "TRANSIT" ? "warning" : "neutral"} />
              {box.needsClose ? <Badge label={t("cash.boxes.needsClose")} tone="danger" /> : null}
            </Row>
            {box.bankName ? (
              <Text variant="caption" tone="muted">
                {box.accountNumberMasked ? `${box.bankName} · ${box.accountNumberMasked}` : box.bankName}
              </Text>
            ) : null}
            {box.assignedToEmail ? (
              <Text variant="caption" tone="muted">
                {t("cash.boxes.collector")}: {box.assignedToEmail}
              </Text>
            ) : null}
          </Stack>
          <MoneyText variant="heading" amountMinor={box.balanceMinor} currency={box.currency} />
        </Row>

        {last ? (
          <Stack gap="xs">
            <Row className="justify-between items-center">
              <Badge label={t(`cash.sync.${syncKey(last.status)}`)} tone={SYNC_TONE[last.status]} />
              {last.status === "MISMATCH" && last.differenceMinor !== null ? (
                <MoneyText variant="label" tone="danger" amountMinor={last.differenceMinor} currency={box.currency} />
              ) : null}
            </Row>
            <Text variant="caption" tone="muted">
              {t("cash.boxes.lastSync")}: {new Date(last.syncedAt).toLocaleString()}
            </Text>
          </Stack>
        ) : null}

        {error ? <Banner tone="danger" title={error} /> : null}

        <Row className="gap-2">
          {canManage ? (
            <Button label={t("cash.boxes.arqueo")} variant="secondary" size="sm" onPress={onArqueo} />
          ) : null}
          {canAdmin && box.type === "BANK" ? (
            <Button label={t("cash.boxes.sync")} size="sm" loading={sync.isPending} onPress={onSync} />
          ) : null}
        </Row>
      </Stack>
    </Card>
  );
}

function syncKey(status: "MATCHED" | "MISMATCH" | "UNAVAILABLE"): "matched" | "mismatch" | "unavailable" {
  if (status === "MATCHED") return "matched";
  if (status === "MISMATCH") return "mismatch";
  return "unavailable";
}
