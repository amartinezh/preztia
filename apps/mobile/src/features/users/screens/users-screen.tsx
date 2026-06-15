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
  type SelectOption,
} from "@preztiaos/ui";

import { useSession } from "@/core/auth/session";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useCreateUser, useUpdateUser, useUsersList } from "../api/queries";

/**
 * CRUD de usuarios del tenant. El ADMIN crea coordinadores/cobradores; el COORDINATOR solo
 * crea cobradores (el backend impone la jerarquía y el alcance de zonas → 403 si se excede).
 */
export function UsersScreen() {
  const { t } = useT();
  const { role } = useSession();
  const query = useUsersList();
  const update = useUpdateUser();
  const [creating, setCreating] = useState(false);

  const items = useMemo<UserSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isPending) return <Spinner label={t("common.loading")} />;
  const canEdit = role === "ADMIN";

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
            title={item.email}
            subtitle={`${item.role}${item.zonePaths.length ? ` · ${item.zonePaths.join(", ")}` : ""}`}
            onPress={
              canEdit
                ? () => update.mutate({ id: item.id, active: !item.active })
                : undefined
            }
            trailing={
              <Badge
                tone={item.active ? "success" : "neutral"}
                label={item.active ? t("users.active") : "—"}
              />
            }
          />
        )}
      />
      <CreateUserModal visible={creating} onClose={() => setCreating(false)} />
    </SafeAreaView>
  );
}

export function CreateUserModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const { role } = useSession();
  const create = useCreateUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // El coordinador solo crea cobradores; el admin elige rol.
  const [userRole, setUserRole] = useState<CreatableRole>(
    role === "COORDINATOR" ? "COLLECTOR" : "COORDINATOR",
  );
  const [zones, setZones] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const roleOptions: SelectOption<CreatableRole>[] =
    role === "COORDINATOR"
      ? [{ value: "COLLECTOR", label: t("users.role.collector") }]
      : [
          { value: "COORDINATOR", label: t("users.role.coordinator") },
          { value: "COLLECTOR", label: t("users.role.collector") },
        ];

  const submit = () => {
    setSubmitError(null);
    const zonePaths = zones
      .split(",")
      .map((z) => z.trim())
      .filter((z) => z.length > 0);
    const parsed = createUserInput.safeParse({
      email: email.trim().toLowerCase(),
      password,
      role: userRole,
      zonePaths,
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
        setEmail("");
        setPassword("");
        setZones("");
        onClose();
      },
      onError: (err) => setSubmitError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Modal visible={visible} onClose={onClose} title={t("users.new.title")}>
      <Stack gap="md" className="p-4">
        {submitError ? <Banner tone="danger" title={submitError} /> : null}
        <Field label={t("users.new.email")} error={errors.email} required>
          <Input autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} invalid={!!errors.email} />
        </Field>
        <Field label={t("users.new.password")} error={errors.password} required>
          <Input secureTextEntry value={password} onChangeText={setPassword} invalid={!!errors.password} />
        </Field>
        <Field label={t("users.new.role")} required>
          <Select value={userRole} options={roleOptions} onChange={setUserRole} title={t("users.new.role")} />
        </Field>
        <Field label={t("users.new.zones")} error={errors.zonePaths} hint="co.antioquia, co.antioquia.medellin">
          <Input autoCapitalize="none" value={zones} onChangeText={setZones} invalid={!!errors.zonePaths} />
        </Field>
        <Button label={t("users.new.submit")} loading={create.isPending} block onPress={submit} />
      </Stack>
    </Modal>
  );
}
