import { useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { ZoneNode } from "@preztiaos/contracts";
import { createZoneInput, updateZoneInput } from "@preztiaos/contracts";
import {
  Banner,
  Button,
  ConfirmModal,
  Field,
  Input,
  ListItem,
  Modal,
  Row,
  Select,
  Spinner,
  Stack,
  Text,
  useToast,
  type SelectOption,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCreateZone, useDeleteZone, useUpdateZone, useZonesList } from "../api/queries";
import { ZoneWhatsappEditor } from "./zone-whatsapp-editor";

/** CRUD del árbol de zonas (ADMIN). La indentación refleja la profundidad del path ltree. */
export function ZonesScreen() {
  const { t, tf } = useT();
  const toast = useToast();
  const query = useZonesList();
  const remove = useDeleteZone();
  const [creating, setCreating] = useState(false);
  const [whatsappZone, setWhatsappZone] = useState<ZoneNode | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ZoneNode | null>(null);
  const [renaming, setRenaming] = useState<ZoneNode | null>(null);

  // Eliminar solo tras confirmar; el error se avisa fuera del modal para que quede visible.
  const confirmDelete = () => {
    if (!pendingDelete) return;
    remove.mutate(pendingDelete.id, {
      onSettled: () => setPendingDelete(null),
      onError: (err) =>
        toast.show({
          tone: "danger",
          title: isApiError(err) ? t(err.messageKey) : t("errors.unknown"),
        }),
    });
  };

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
                      label={t("zones.action.rename")}
                      variant="ghost"
                      size="sm"
                      onPress={() => setRenaming(item)}
                    />
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
                      onPress={() => setPendingDelete(item)}
                    />
                  </Row>
                }
              />
            </View>
          );
        }}
      />
      <CreateZoneModal visible={creating} onClose={() => setCreating(false)} zones={zones} />
      <RenameZoneModal zone={renaming} onClose={() => setRenaming(null)} />
      <ZoneWhatsappEditor
        visible={whatsappZone !== null}
        onClose={() => setWhatsappZone(null)}
        zone={whatsappZone}
      />
      <ConfirmModal
        visible={pendingDelete !== null}
        title={t("zones.delete.confirmTitle")}
        description={tf("zones.delete.confirmBody", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        closeLabel={t("common.close")}
        tone="danger"
        loading={remove.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}

/** Renombrar una zona: cambia solo el nombre visible; el path (código ltree) es estable. */
function RenameZoneModal({ zone, onClose }: { zone: ZoneNode | null; onClose: () => void }) {
  const { t } = useT();
  return (
    <Modal visible={zone !== null} onClose={onClose} title={t("zones.rename.title")} closeLabel={t("common.close")}>
      {zone ? <RenameZoneForm key={zone.id} zone={zone} onClose={onClose} /> : null}
    </Modal>
  );
}

function RenameZoneForm({ zone, onClose }: { zone: ZoneNode; onClose: () => void }) {
  const { t, tf } = useT();
  const toast = useToast();
  const update = useUpdateZone();
  const [name, setName] = useState(zone.name);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const submit = () => {
    setError(null);
    // Solo viaja el nombre: sin `supportPhone` el servidor conserva el teléfono actual.
    const parsed = updateZoneInput.safeParse({ name: trimmed });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    update.mutate(
      { id: zone.id, name: parsed.data.name },
      {
        onSuccess: () => {
          toast.show({ tone: "success", title: t("zones.renamed") });
          onClose();
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Stack gap="md" className="p-4">
      {error ? <Banner tone="danger" title={error} /> : null}
      <Field label={t("zones.new.name")} hint={tf("zones.rename.hint", { path: zone.path })} required>
        <Input value={name} onChangeText={setName} autoFocus accessibilityLabel={t("zones.new.name")} />
      </Field>
      <Button
        label={t("common.save")}
        loading={update.isPending}
        disabled={trimmed.length === 0 || trimmed === zone.name}
        block
        onPress={submit}
      />
    </Stack>
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
    <Modal visible={visible} onClose={onClose} title={t("zones.new.title")} closeLabel={t("common.close")}>
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
