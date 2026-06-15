import { useMemo, useState } from "react";
import { FlatList, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { TenantAdminOutput, TenantOutput } from "@preztiaos/contracts";
import {
  createTenantAdminInput,
  createTenantInput,
  updateTenantAdminInput,
} from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  EmptyState,
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
  useTenantAdminsList,
  useTenantsList,
  useUpdateTenant,
  useUpdateTenantAdmin,
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
  const [statusError, setStatusError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const active = tenant.status === "ACTIVE";

  return (
    <>
      <Modal visible onClose={onClose} title={tenant.name}>
        <ScrollView contentContainerClassName="p-4">
          <Stack gap="lg">
            {/* Estado del tenant */}
            <Stack gap="sm">
              <Text variant="label" tone="muted">
                {t("tenants.section.status")}
              </Text>
              {statusError ? <Banner tone="danger" title={statusError} /> : null}
              <Switch
                label={active ? t("tenants.status.active") : t("tenants.status.suspended")}
                value={active}
                disabled={update.isPending}
                onValueChange={(v) => {
                  setStatusError(null);
                  update.mutate(
                    { id: tenant.id, status: v ? "ACTIVE" : "SUSPENDED" },
                    {
                      onError: (err) =>
                        setStatusError(
                          isApiError(err) ? t(err.messageKey) : t("errors.unknown"),
                        ),
                    },
                  );
                }}
              />
            </Stack>

            <AdminsSection tenant={tenant} />

            {/* Zona de peligro */}
            <Button
              label={t("tenants.delete.title")}
              variant="danger"
              block
              onPress={() => setConfirmingDelete(true)}
            />
          </Stack>
        </ScrollView>
      </Modal>

      {confirmingDelete ? (
        <DeleteTenantConfirmModal
          tenant={tenant}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={onClose}
        />
      ) : null}
    </>
  );
}

/** Lista de admins del tenant + alta de nuevos. Varios admins por tenant. */
function AdminsSection({ tenant }: { tenant: TenantOutput }) {
  const { t } = useT();
  const query = useTenantAdminsList(tenant.id);
  const [adding, setAdding] = useState(false);

  const admins = useMemo<TenantAdminOutput[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  return (
    <Stack gap="sm">
      <Row className="justify-between">
        <Text variant="label" tone="muted">
          {t("tenants.admins.title")}
        </Text>
        {!adding ? (
          <Button
            label={t("tenants.admins.add")}
            size="sm"
            variant="secondary"
            onPress={() => setAdding(true)}
          />
        ) : null}
      </Row>

      {query.isPending ? (
        <Spinner label={t("common.loading")} />
      ) : admins.length === 0 && !adding ? (
        <EmptyState title={t("tenants.admins.empty")} />
      ) : (
        <Stack gap="sm">
          {admins.map((admin) => (
            <AdminRow key={admin.id} tenantId={tenant.id} admin={admin} />
          ))}
        </Stack>
      )}

      {adding ? (
        <AddAdminForm tenantId={tenant.id} onDone={() => setAdding(false)} />
      ) : null}
    </Stack>
  );
}

/** Una fila de admin: estado, activar/desactivar y restablecer contraseña. */
function AdminRow({ tenantId, admin }: { tenantId: string; admin: TenantAdminOutput }) {
  const { t } = useT();
  const update = useUpdateTenantAdmin(tenantId);
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const submitReset = () => {
    setError(null);
    const parsed = updateTenantAdminInput.safeParse({ password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.unknown"));
      return;
    }
    update.mutate(
      { adminId: admin.id, password },
      {
        onSuccess: () => {
          setPassword("");
          setResetting(false);
          setFeedback(t("tenants.admins.passwordReset"));
        },
        onError: (err) =>
          setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Card className="gap-3">
      <Row className="justify-between">
        <Text variant="body" className="flex-1 pr-2">
          {admin.email}
        </Text>
        <Badge
          tone={admin.active ? "success" : "neutral"}
          label={admin.active ? t("tenants.admins.statusActive") : t("tenants.admins.statusInactive")}
        />
      </Row>

      {feedback ? <Banner tone="info" title={feedback} /> : null}

      <Row className="justify-between">
        <Switch
          label={admin.active ? t("tenants.admins.deactivate") : t("tenants.admins.activate")}
          value={admin.active}
          disabled={update.isPending}
          onValueChange={(v) => {
            setError(null);
            setFeedback(null);
            update.mutate(
              { adminId: admin.id, active: v },
              {
                onError: (err) =>
                  setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
              },
            );
          }}
        />
        {!resetting ? (
          <Button
            label={t("tenants.admins.resetPassword")}
            size="sm"
            variant="ghost"
            onPress={() => {
              setFeedback(null);
              setResetting(true);
            }}
          />
        ) : null}
      </Row>

      {resetting ? (
        <Stack gap="sm">
          {error ? <Banner tone="danger" title={error} /> : null}
          <Field label={t("tenants.admins.newPassword")} required>
            <Input secureTextEntry value={password} onChangeText={setPassword} invalid={!!error} />
          </Field>
          <Row className="gap-2">
            <Button
              label={t("tenants.admins.cancel")}
              variant="secondary"
              size="sm"
              onPress={() => {
                setResetting(false);
                setPassword("");
                setError(null);
              }}
            />
            <Button
              label={t("tenants.admins.save")}
              size="sm"
              loading={update.isPending}
              onPress={submitReset}
            />
          </Row>
        </Stack>
      ) : null}
    </Card>
  );
}

/** Formulario de alta de un admin para el tenant (permite crear varios). */
function AddAdminForm({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const { t } = useT();
  const createAdmin = useCreateTenantAdmin(tenantId);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const submit = () => {
    setSubmitError(null);
    setFeedback(null);
    const parsed = createTenantAdminInput.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const next: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "password" | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    createAdmin.mutate(parsed.data, {
      onSuccess: () => {
        setEmail("");
        setPassword("");
        setFeedback(t("tenants.admins.created"));
      },
      onError: (err) =>
        setSubmitError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Card className="gap-3">
      <Text variant="label" tone="muted">
        {t("tenants.admins.addTitle")}
      </Text>
      {feedback ? <Banner tone="info" title={feedback} /> : null}
      {submitError ? <Banner tone="danger" title={submitError} /> : null}
      <Field label={t("users.new.email")} error={errors.email} required>
        <Input
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          invalid={!!errors.email}
        />
      </Field>
      <Field label={t("users.new.password")} error={errors.password} required>
        <Input secureTextEntry value={password} onChangeText={setPassword} invalid={!!errors.password} />
      </Field>
      <Row className="gap-2">
        <Button label={t("tenants.admins.cancel")} variant="secondary" size="sm" onPress={onDone} />
        <Button
          label={t("tenants.admins.add")}
          size="sm"
          loading={createAdmin.isPending}
          onPress={submit}
        />
      </Row>
    </Card>
  );
}

/** Confirmación segura: exige escribir el nombre exacto del tenant para borrarlo. */
function DeleteTenantConfirmModal({
  tenant,
  onClose,
  onDeleted,
}: {
  tenant: TenantOutput;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useT();
  const remove = useDeleteTenant();
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  const matches = confirmation.trim() === tenant.name;

  return (
    <Modal visible onClose={onClose} title={t("tenants.delete.title")}>
      <Stack gap="md" className="p-4">
        <Banner tone="danger" title={t("tenants.delete.warning")} />
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("tenants.delete.confirmPrompt")} required>
          <Input
            autoCapitalize="none"
            value={confirmation}
            onChangeText={setConfirmation}
            placeholder={tenant.name}
          />
        </Field>
        <Row className="gap-2">
          <Button label={t("tenants.admins.cancel")} variant="secondary" block onPress={onClose} />
          <Button
            label={t("tenants.delete.confirm")}
            variant="danger"
            block
            disabled={!matches || remove.isPending}
            loading={remove.isPending}
            onPress={() => {
              setError(null);
              remove.mutate(tenant.id, {
                onSuccess: onDeleted,
                onError: (err) =>
                  setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
              });
            }}
          />
        </Row>
      </Stack>
    </Modal>
  );
}
