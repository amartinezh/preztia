import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { AssignableClient } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  EmptyState,
  ListItem,
  Row,
  Spinner,
  Switch,
  Text,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useAssignableClients, useAssignClients } from "@/features/clients/api/queries";

/**
 * Coordinador: selecciona, de entre los clientes de su alcance, los que gestionará un cobrador.
 * La selección efectiva = override explícito del usuario ?? estado `assigned` que trae el backend
 * (sin `useEffect`: se deriva en render). Al guardar se REEMPLAZA la cartera con lo seleccionado
 * de las páginas cargadas.
 */
export function AssignClientsScreen({ collectorId }: { collectorId: string }) {
  const { t } = useT();
  const router = useRouter();
  const query = useAssignableClients(collectorId);
  const save = useAssignClients(collectorId);
  // Solo los cambios EXPLÍCITOS del usuario; lo demás cae al `assigned` del backend.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  const items = useMemo<AssignableClient[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isPending) return <Spinner label={t("common.loading")} />;

  const isSelected = (client: AssignableClient) =>
    overrides[client.borrowerId] ?? client.assigned;

  const toggle = (borrowerId: string, value: boolean) =>
    setOverrides((prev) => ({ ...prev, [borrowerId]: value }));

  const submit = () => {
    setError(null);
    const borrowerIds = items.filter(isSelected).map((c) => c.borrowerId);
    save.mutate(borrowerIds, {
      onSuccess: () => router.back(),
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(c) => c.borrowerId}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        ListHeaderComponent={
          <Row className="pb-2">
            <Text variant="subtitle">{t("collectors.assign.title")}</Text>
          </Row>
        }
        ListEmptyComponent={<EmptyState title={t("collectors.assign.empty")} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        renderItem={({ item }) => (
          <ListItem
            title={item.name ?? `Cliente ${item.borrowerId.slice(0, 8)}`}
            subtitle={item.phone ?? item.zonePath ?? item.borrowerId.slice(0, 8)}
            trailing={
              <Switch
                value={isSelected(item)}
                onValueChange={(v) => toggle(item.borrowerId, v)}
              />
            }
          />
        )}
      />
      <View className="mx-auto w-full max-w-[880px] gap-2 p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Button
          label={t("collectors.assign.submit")}
          loading={save.isPending}
          block
          onPress={submit}
        />
      </View>
    </SafeAreaView>
  );
}
