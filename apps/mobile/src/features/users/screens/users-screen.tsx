import { useMemo, useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { CreatableRole, UserSummary } from "@preztiaos/contracts";
import { createUserInput } from "@preztiaos/contracts";
import {
  Badge,
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
  useToast,
  type SelectOption,
} from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useZonesList } from "@/features/zones/api/queries";
import { useCreateUser, useUsersList } from "../api/queries";
import { UserDetailModal } from "../components/user-detail-modal";
import { ROLE_KEY, userLabel } from "../components/user-presentation";
import { ZoneChecklist } from "../components/zone-checklist";

/**
 * Usuarios del tenant. El ADMIN crea coordinadores/cobradores; el COORDINATOR solo cobradores (el
 * backend impone la jerarquía y el alcance de zonas → 403 si se excede). Cada fila muestra el nombre
 * (o el correo) y el rol; tocarla abre el detalle: estado, nombre, zonas y restablecer contraseña.
 */
export function UsersScreen() {
  const { t } = useT();
  const { role } = useSession();
  const query = useUsersList();
  const zones = useZonesList();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = useMemo<UserSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  // Nombre de cada zona por su path: la fila habla de zonas, no de códigos ltree.
  const zoneNameByPath = useMemo(
    () => new Map((zones.data?.items ?? []).map((z) => [z.path, z.name])),
    [zones.data],
  );
  // El detalle se lee de la lista cargada (no de una copia): tras cada guardado refleja lo nuevo.
  const selected = items.find((u) => u.id === selectedId) ?? null;

  if (query.isPending) return <Spinner label={t("common.loading")} />;

  // El ADMIN administra a todos; el coordinador, solo a los cobradores (lo mismo que impone el backend).
  const canOpen = (user: UserSummary) =>
    role === "ADMIN" || (role === "COORDINATOR" && user.role === "COLLECTOR");

  const subtitle = (user: UserSummary) => {
    const zoneNames = user.zonePaths.map((p) => zoneNameByPath.get(p) ?? p);
    return [
      t(ROLE_KEY[user.role]),
      user.displayName ? user.email : null,
      zoneNames.length ? zoneNames.join(", ") : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" · ");
  };

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-3 p-4"
        ListHeaderComponent={
          <Row className="justify-between pb-2">
            <Text variant="subtitle">{t("users.list.title")}</Text>
            <Button label={t("common.create")} size="sm" onPress={() => setCreating(true)} />
          </Row>
        }
        ListEmptyComponent={<Text tone="muted">{t("users.list.empty")}</Text>}
        onEndReachedThreshold={0.4}
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        renderItem={({ item }) => (
          <ListItem
            title={userLabel(item)}
            subtitle={subtitle(item)}
            onPress={canOpen(item) ? () => setSelectedId(item.id) : undefined}
            trailing={
              <Badge
                tone={item.active ? "success" : "neutral"}
                label={item.active ? t("users.active") : t("users.inactive")}
              />
            }
          />
        )}
      />
      <CreateUserModal visible={creating} onClose={() => setCreating(false)} />
      <UserDetailModal user={selected} onClose={() => setSelectedId(null)} />
    </SafeAreaView>
  );
}

/** Alta de usuario con nombre visible y zonas por casillas (nunca paths ltree a mano). */
export function CreateUserModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const { role } = useSession();
  const create = useCreateUser();
  const zones = useZonesList();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // El coordinador solo crea cobradores; el admin elige rol.
  const [userRole, setUserRole] = useState<CreatableRole>(
    role === "COORDINATOR" ? "COLLECTOR" : "COORDINATOR",
  );
  const [zonePaths, setZonePaths] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const roleOptions: SelectOption<CreatableRole>[] =
    role === "COORDINATOR"
      ? [{ value: "COLLECTOR", label: t("users.role.collector") }]
      : [
          { value: "COORDINATOR", label: t("users.role.coordinator") },
          { value: "COLLECTOR", label: t("users.role.collector") },
        ];

  const reset = () => {
    setDisplayName("");
    setEmail("");
    setPassword("");
    setZonePaths([]);
    setErrors({});
  };

  const submit = () => {
    setSubmitError(null);
    const parsed = createUserInput.safeParse({
      email: email.trim().toLowerCase(),
      password,
      role: userRole,
      zonePaths,
      ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: () => {
        toast.show({ tone: "success", title: t("users.created") });
        reset();
        onClose();
      },
      onError: (err) => setSubmitError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Modal visible={visible} onClose={onClose} title={t("users.new.title")} closeLabel={t("common.close")}>
      <Stack gap="md" className="p-4">
        {submitError ? <Banner tone="danger" title={submitError} /> : null}
        <Field label={t("users.new.displayName")} error={errors.displayName} hint={t("users.new.displayNameHint")}>
          <Input autoCapitalize="words" value={displayName} onChangeText={setDisplayName} invalid={!!errors.displayName} />
        </Field>
        <Field label={t("users.new.email")} error={errors.email} required>
          <Input autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} invalid={!!errors.email} />
        </Field>
        <Field label={t("users.new.password")} error={errors.password} hint={t("password.newHint")} required>
          <Input secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} invalid={!!errors.password} />
        </Field>
        <Field label={t("users.new.role")} required>
          <Select value={userRole} options={roleOptions} onChange={setUserRole} title={t("users.new.role")} />
        </Field>
        <Field label={t("users.new.zonesPick")} error={errors.zonePaths} hint={t("users.new.zonesHint")}>
          <ZoneChecklist
            zones={zones.data?.items ?? []}
            selectedPaths={zonePaths}
            onChange={setZonePaths}
            emptyLabel={zones.isPending ? t("common.loading") : t("users.new.zonesEmpty")}
          />
        </Field>
        <Button label={t("users.new.submit")} loading={create.isPending} block onPress={submit} />
      </Stack>
    </Modal>
  );
}
