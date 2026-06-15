import { useMemo, useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { TenantOutput } from "@preztiaos/contracts";
import { createTenantInput } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Field,
  Input,
  ListItem,
  Modal,
  Row,
  Spinner,
  Stack,
  Switch,
  Text,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import {
  useCreateTenant,
  useCreateTenantAdmin,
  useDeleteTenant,
  useTenantsList,
  useUpdateTenant,
} from "../api/queries";

/** Pantalla del super admin: CRUD de tenants y provisión de su admin. Responsiva (móvil/web). */
export function TenantsScreen() {
  const { t } = useT();
  const query = useTenantsList();
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<TenantOutput | null>(null);

  const items = useMemo<TenantOutput[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isPending) return <Spinner label={t("common.loading")} />;

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-3 p-4"
        ListHeaderComponent={
          <Row className="justify-between pb-2">
            <Text variant="subtitle">{t("tenants.list.title")}</Text>
            <Button label={t("common.create")} size="sm" onPress={() => setCreating(true)} />
          </Row>
        }
        ListEmptyComponent={<Text tone="muted">{t("tenants.list.empty")}</Text>}
        onEndReachedThreshold={0.4}
        onEndReached={() => query.hasNextPage && query.fetchNextPage()}
        renderItem={({ item }) => (
          <ListItem
            title={item.name}
            subtitle={item.slug}
            onPress={() => setSelected(item)}
            trailing={
              <Badge
                tone={item.status === "ACTIVE" ? "success" : "warning"}
                label={
                  item.status === "ACTIVE"
                    ? t("tenants.status.active")
                    : t("tenants.status.suspended")
                }
              />
            }
          />
        )}
      />

      <CreateTenantModal visible={creating} onClose={() => setCreating(false)} />
      {selected ? (
        <TenantDetailModal tenant={selected} onClose={() => setSelected(null)} />
      ) : null}
    </SafeAreaView>
  );
}

function CreateTenantModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useT();
  const create = useCreateTenant();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [errors, setErrors] = useState<{ name?: string; slug?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submit = () => {
    setSubmitError(null);
    const parsed = createTenantInput.safeParse({
      name: name.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
    });
    if (!parsed.success) {
      const next: { name?: string; slug?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "name" | "slug" | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: () => {
        setName("");
        setSlug("");
        onClose();
      },
      onError: (err) => setSubmitError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Modal visible={visible} onClose={onClose} title={t("tenants.new.title")}>
      <Stack gap="md" className="p-4">
        {submitError ? <Banner tone="danger" title={submitError} /> : null}
        <Field label={t("tenants.new.name")} error={errors.name} required>
          <Input value={name} onChangeText={setName} invalid={!!errors.name} />
        </Field>
        <Field label={t("tenants.new.slug")} error={errors.slug}>
          <Input autoCapitalize="none" value={slug} onChangeText={setSlug} invalid={!!errors.slug} />
        </Field>
        <Button label={t("tenants.new.submit")} loading={create.isPending} block onPress={submit} />
      </Stack>
    </Modal>
  );
}

function TenantDetailModal({ tenant, onClose }: { tenant: TenantOutput; onClose: () => void }) {
  const { t } = useT();
  const update = useUpdateTenant();
  const remove = useDeleteTenant();
  const createAdmin = useCreateTenantAdmin(tenant.id);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const active = tenant.status === "ACTIVE";

  return (
    <Modal visible onClose={onClose} title={tenant.name}>
      <Stack gap="md" className="p-4">
        {feedback ? <Banner tone="info" title={feedback} /> : null}

        <Switch
          label={active ? t("tenants.status.active") : t("tenants.status.suspended")}
          value={active}
          onValueChange={(v) =>
            update.mutate(
              { id: tenant.id, status: v ? "ACTIVE" : "SUSPENDED" },
              { onSuccess: onClose },
            )
          }
        />

        <Text variant="label" tone="muted">
          {t("tenants.admin.title")}
        </Text>
        <Field label={t("users.new.email")} required>
          <Input autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        </Field>
        <Field label={t("users.new.password")} required>
          <Input secureTextEntry value={password} onChangeText={setPassword} />
        </Field>
        <Button
          label={t("tenants.admin.submit")}
          variant="secondary"
          loading={createAdmin.isPending}
          block
          onPress={() =>
            createAdmin.mutate(
              { email: email.trim(), password },
              {
                onSuccess: () => {
                  setEmail("");
                  setPassword("");
                  setFeedback(`${t("tenants.admin.submit")} ✓`);
                },
              },
            )
          }
        />

        <Button
          label={t("tenants.action.delete")}
          variant="danger"
          loading={remove.isPending}
          block
          onPress={() => remove.mutate(tenant.id, { onSuccess: onClose })}
        />
      </Stack>
    </Modal>
  );
}
