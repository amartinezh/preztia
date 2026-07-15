import { useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ZoneNode } from "@preztiaos/contracts";
import { createZoneInput } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  Field,
  Input,
  ListItem,
  Modal,
  Row,
  Select,
  Spinner,
  Stack,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCreateZone, useDeleteZone, useZonesList } from "../api/queries";
import { ZoneWhatsappEditor } from "./zone-whatsapp-editor";

/** CRUD del árbol de zonas (ADMIN). La indentación refleja la profundidad del path ltree. */
export function ZonesScreen() {
  const { t } = useT();
  const query = useZonesList();
  const remove = useDeleteZone();
  const [creating, setCreating] = useState(false);
  const [whatsappZone, setWhatsappZone] = useState<ZoneNode | null>(null);

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  const zones = query.data?.items ?? [];

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={zones}
        keyExtractor={(z) => z.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        ListHeaderComponent={
          <Row className="justify-between pb-2">
            <Text variant="subtitle">{t("zones.list.title")}</Text>
            <Button label={t("common.create")} size="sm" onPress={() => setCreating(true)} />
          </Row>
        }
        ListEmptyComponent={<Text tone="muted">{t("zones.list.empty")}</Text>}
        renderItem={({ item }) => {
          const depth = item.path.split(".").length - 1;
          return (
            <View style={{ paddingLeft: depth * 16 }}>
              <ListItem
                title={item.name}
                subtitle={item.path}
                trailing={
                  <Row className="items-center gap-1">
                    <Button
                      label={t("zones.action.whatsapp")}
                      variant="ghost"
                      size="sm"
                      onPress={() => setWhatsappZone(item)}
                    />
                    <Button
                      label={t("zones.action.delete")}
                      variant="ghost"
                      size="sm"
                      onPress={() => remove.mutate(item.id)}
                    />
                  </Row>
                }
              />
            </View>
          );
        }}
      />
      <CreateZoneModal visible={creating} onClose={() => setCreating(false)} zones={zones} />
      <ZoneWhatsappEditor
        visible={whatsappZone !== null}
        onClose={() => setWhatsappZone(null)}
        zone={whatsappZone}
      />
    </SafeAreaView>
  );
}

function CreateZoneModal({
  visible,
  onClose,
  zones,
}: {
  visible: boolean;
  onClose: () => void;
  zones: ZoneNode[];
}) {
  const { t } = useT();
  const create = useCreateZone();
  const [name, setName] = useState("");
  const [parentZoneId, setParentZoneId] = useState<string>("");
  const [supportPhone, setSupportPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const ROOT = "__root__";
  const parentOptions: SelectOption<string>[] = [
    { value: ROOT, label: t("zones.new.root") },
    ...zones.map((z) => ({ value: z.id, label: z.name, hint: z.path })),
  ];

  const submit = () => {
    setError(null);
    const parsed = createZoneInput.safeParse({
      name: name.trim(),
      parentZoneId: parentZoneId && parentZoneId !== ROOT ? parentZoneId : null,
      supportPhone: supportPhone.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: () => {
        setName("");
        setParentZoneId("");
        setSupportPhone("");
        onClose();
      },
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Modal visible={visible} onClose={onClose} title={t("zones.new.title")}>
      <Stack gap="md" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("zones.new.name")} required>
          <Input value={name} onChangeText={setName} />
        </Field>
        <Field label={t("zones.new.parent")}>
          <Select
            value={parentZoneId || ROOT}
            options={parentOptions}
            onChange={setParentZoneId}
            title={t("zones.new.parent")}
          />
        </Field>
        <Field label={t("zones.support.label")} hint={t("zones.support.hint")}>
          <Input
            value={supportPhone}
            onChangeText={setSupportPhone}
            keyboardType="phone-pad"
            autoCapitalize="none"
            placeholder={t("zones.support.placeholder")}
          />
        </Field>
        <Button label={t("zones.new.submit")} loading={create.isPending} block onPress={submit} />
      </Stack>
    </Modal>
  );
}
