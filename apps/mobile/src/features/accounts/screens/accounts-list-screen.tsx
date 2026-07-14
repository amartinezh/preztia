import { useMemo, useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import type { AccountRow } from "@preztiaos/contracts";
import {
  Badge,
  Button,
  Input,
  ListItem,
  minorToMajor,
  MoneyText,
  Row,
  Spinner,
  Stack,
  Switch,
  Text,
} from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { csvDownloadAvailable, downloadCsv } from "@/core/export/download-csv";
import { useT } from "@/core/i18n";
import { useExportAccounts } from "@/features/reporting/api/queries";
import { useAccountsList } from "../api/queries";

/** Listado de Cuentas: cada crédito con cliente, deuda, cuotas pagas y días de atraso. */
export function AccountsListScreen() {
  const { t } = useT();
  const router = useRouter();
  const { role } = useSession();
  const exportCsv = useExportAccounts();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  // Export disponible para gestores y solo donde el entorno permite descargar (web/RN-web).
  const canExport = can(role, "borrower:manage") && csvDownloadAvailable();
  const runExport = () =>
    exportCsv.mutate(undefined, {
      onSuccess: (res) => downloadCsv(res.filename, res.csv),
    });

  const query = useAccountsList({
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(phone.trim() ? { phone: phone.trim() } : {}),
    ...(onlyOverdue ? { onlyOverdue: true } : {}),
  });
  const items = useMemo<AccountRow[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(a) => a.creditId}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <Stack gap="sm" className="pb-2">
            <Row className="justify-between">
              <Text variant="subtitle">{t("accounts.list.title")}</Text>
              {canExport ? (
                <Button
                  label={t("accounts.export")}
                  variant="ghost"
                  size="sm"
                  loading={exportCsv.isPending}
                  onPress={runExport}
                />
              ) : null}
            </Row>
            <Input value={name} onChangeText={setName} placeholder={t("accounts.list.search")} />
            <Input
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder={t("accounts.list.searchPhone")}
            />
            <Switch
              value={onlyOverdue}
              onValueChange={setOnlyOverdue}
              label={t("accounts.list.onlyOverdue")}
            />
          </Stack>
        }
        ListEmptyComponent={
          query.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <Text tone="muted">{t("accounts.list.empty")}</Text>
          )
        }
        renderItem={({ item }) => (
          <ListItem
            title={item.borrowerName ?? item.nationalId ?? item.creditId.slice(0, 8)}
            subtitle={`${t("accounts.field.paid")}: ${item.paidCount}/${item.installmentsCount} · ${t("accounts.field.collectedToday")}: ${minorToMajor(item.collectedTodayMinor)} · ${t("accounts.field.dueToday")}: ${minorToMajor(item.dueTodayMinor)}`}
            onPress={() => router.push(`/account/${item.creditId}` as Href)}
            trailing={
              <Row className="items-center gap-2">
                {item.daysOverdue > 0 ? (
                  <Badge label={`${item.daysOverdue}d`} tone="danger" />
                ) : null}
                <MoneyText
                  variant="body"
                  amountMinor={item.outstandingMinor}
                  currency={item.currency}
                />
              </Row>
            }
          />
        )}
      />
    </SafeAreaView>
  );
}
