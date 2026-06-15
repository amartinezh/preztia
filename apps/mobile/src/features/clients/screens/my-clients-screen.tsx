import { useMemo, useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CollectorClient, CreateChangeRequestInput } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  EmptyState,
  Field,
  Input,
  ListItem,
  Modal,
  Row,
  Spinner,
  Stack,
  Text,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { getCurrentPosition, geolocationAvailable } from "@/core/geo/current-position";
import { useT } from "@/core/i18n";
import { useCreateChangeRequest } from "@/features/operations/api/queries";
import { useRecordLocation } from "@/features/tracking/api/queries";
import { useMyClients } from "../api/queries";

/** Vista del COBRADOR: solo los clientes que le asignó su coordinador. Puede PROPONER cambios. */
export function MyClientsScreen() {
  const { t } = useT();
  const query = useMyClients();
  const recordLocation = useRecordLocation();
  const [proposing, setProposing] = useState<CollectorClient | null>(null);
  const items = useMemo<CollectorClient[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const registerLocation = async () => {
    try {
      const { lat, lng } = await getCurrentPosition();
      recordLocation.mutate({ lat, lng });
    } catch {
      /* la geolocalización pudo ser denegada; no bloquea la pantalla */
    }
  };

  if (query.isPending) return <Spinner label={t("common.loading")} />;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(c) => c.borrowerId}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-3 p-4"
        ListHeaderComponent={
          <Row className="justify-between pb-2">
            <Text variant="subtitle">{t("clients.list.title")}</Text>
            {geolocationAvailable() ? (
              <Button
                label={t("tracking.record")}
                size="sm"
                variant="ghost"
                loading={recordLocation.isPending}
                onPress={registerLocation}
              />
            ) : null}
          </Row>
        }
        ListEmptyComponent={<EmptyState title={t("clients.list.empty")} />}
        onEndReachedThreshold={0.4}
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        renderItem={({ item }) => (
          <ListItem
            title={item.name ?? `Cliente ${item.borrowerId.slice(0, 8)}`}
            subtitle={item.phone ?? item.zonePath ?? item.borrowerId.slice(0, 8)}
            trailing={
              <Button
                label={t("clients.propose.action")}
                variant="ghost"
                size="sm"
                onPress={() => setProposing(item)}
              />
            }
          />
        )}
      />
      <ProposeChangeModal
        key={proposing?.borrowerId ?? "idle"}
        client={proposing}
        onClose={() => setProposing(null)}
      />
    </SafeAreaView>
  );
}

/** Modal del cobrador para PROPONER cambios de datos de un cliente (maker-checker). */
function ProposeChangeModal({
  client,
  onClose,
}: {
  client: CollectorClient | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const propose = useCreateChangeRequest();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [business, setBusiness] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    if (!client) return;
    const changes: CreateChangeRequestInput["changes"] = {
      ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
      ...(lastName.trim() ? { lastName: lastName.trim() } : {}),
      ...(business.trim() ? { business: business.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
    };
    if (Object.keys(changes).length === 0) {
      setError(t("errors.validation"));
      return;
    }
    propose.mutate(
      { borrowerId: client.borrowerId, changes },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible={client !== null} onClose={onClose} title={t("clients.propose.title")}>
      <Stack gap="md" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("clients.propose.firstName")}>
          <Input value={firstName} onChangeText={setFirstName} />
        </Field>
        <Field label={t("clients.propose.lastName")}>
          <Input value={lastName} onChangeText={setLastName} />
        </Field>
        <Field label={t("clients.propose.business")}>
          <Input value={business} onChangeText={setBusiness} />
        </Field>
        <Field label={t("clients.propose.phone")}>
          <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        </Field>
        <Button label={t("clients.propose.submit")} loading={propose.isPending} block onPress={submit} />
      </Stack>
    </Modal>
  );
}
