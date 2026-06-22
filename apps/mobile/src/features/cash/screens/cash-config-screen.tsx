import { useState } from "react";
import type {
  BankAccount,
  BankAccountInput,
  CashBox,
  CashBoxType,
} from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Modal,
  Row,
  Select,
  Spinner,
  Stack,
  Text,
  type SelectOption,
} from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { can } from "@/core/auth/authorization";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useUsersList } from "@/features/users/api/queries";
import {
  useBankAccounts,
  useCashBoxes,
  useCreateBankAccount,
  useCreateCashBox,
  useDeleteBankAccount,
  useDeleteCashBox,
  useUpdateBankAccount,
  useUpdateCashBox,
} from "../api/boxes-queries";

/** Botón cuadrado pequeño para acciones por fila (editar/eliminar). */
function IconButton({
  glyph,
  label,
  tone = "secondary",
  onPress,
}: {
  glyph: string;
  label: string;
  tone?: "secondary" | "danger";
  onPress: () => void;
}) {
  return (
    <Button
      label={glyph}
      variant={tone}
      size="sm"
      className="w-11 px-0"
      accessibilityLabel={label}
      onPress={onPress}
    />
  );
}

/** Cabecera de sección: título a la izquierda y botón discreto "+" para agregar. */
function SectionHeader({ title, onAdd }: { title: string; onAdd: () => void }) {
  const { t } = useT();
  return (
    <Row className="justify-between items-center">
      <Text variant="heading">{title}</Text>
      <IconButton glyph="＋" label={t("common.add")} onPress={onAdd} />
    </Row>
  );
}

/** Configuración de caja (solo ADMIN): CRUD de cuentas bancarias y de cajas (Req 1 y 2). */
export function CashConfigScreen() {
  const { t } = useT();
  const { role } = useSession();

  if (!can(role, "cash:admin")) {
    return (
      <Screen>
        <ErrorState title={t("errors.forbidden")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack gap="lg">
        <Text variant="subtitle">{t("cash.config.link")}</Text>
        <BankAccountsSection />
        <CashBoxesSection />
      </Stack>
    </Screen>
  );
}

// --- Cuentas bancarias ------------------------------------------------------

function BankAccountsSection() {
  const { t } = useT();
  const list = useBankAccounts();
  const del = useDeleteBankAccount();
  // null = cerrado; { account } presente = editar; { account: undefined } = crear.
  const [editor, setEditor] = useState<{ account?: BankAccount } | null>(null);

  return (
    <Stack gap="sm">
      <SectionHeader title={t("cash.accounts.title")} onAdd={() => setEditor({})} />

      {list.isPending ? <Spinner label={t("common.loading")} /> : null}
      {list.data?.items.length ? (
        list.data.items.map((a) => (
          <Card key={a.id}>
            <Row className="justify-between items-center">
              <Stack gap="xs" className="flex-1 pr-3">
                <Text variant="label">{a.label}</Text>
                <Text variant="caption" tone="muted">
                  {a.bankName} · {a.countryCode}:{a.bankCode}
                </Text>
                {a.hasApiKey ? (
                  <Badge label={t("cash.accounts.hasApiKey")} tone="info" />
                ) : null}
              </Stack>
              <Row className="gap-2">
                <IconButton glyph="✎" label={t("common.edit")} onPress={() => setEditor({ account: a })} />
                <IconButton glyph="🗑" label={t("common.delete")} tone="danger" onPress={() => del.mutate(a.id)} />
              </Row>
            </Row>
          </Card>
        ))
      ) : list.data ? (
        <Text tone="muted">{t("cash.accounts.empty")}</Text>
      ) : null}

      {editor ? (
        <BankAccountModal account={editor.account} onClose={() => setEditor(null)} />
      ) : null}
    </Stack>
  );
}

function BankAccountModal({
  account,
  onClose,
}: {
  account?: BankAccount;
  onClose: () => void;
}) {
  const { t } = useT();
  const create = useCreateBankAccount();
  const update = useUpdateBankAccount();
  const isEdit = account !== undefined;
  const [form, setForm] = useState({
    label: account?.label ?? "",
    bankName: account?.bankName ?? "",
    countryCode: account?.countryCode ?? "",
    bankCode: account?.bankCode ?? "",
    accountNumber: account?.accountNumber ?? "",
    pixKey: account?.pixKey ?? "",
    apiKey: "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const onError = (err: unknown) =>
    setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));

  const submit = () => {
    setError(null);
    if (isEdit) {
      update.mutate(
        {
          id: account.id,
          patch: {
            label: form.label.trim(),
            bankName: form.bankName.trim(),
            accountNumber: form.accountNumber.trim() || null,
            pixKey: form.pixKey.trim() || null,
            ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          },
        },
        { onSuccess: onClose, onError },
      );
      return;
    }
    const payload: BankAccountInput = {
      label: form.label.trim(),
      bankName: form.bankName.trim(),
      countryCode: form.countryCode.trim(),
      bankCode: form.bankCode.trim(),
      ...(form.accountNumber.trim() ? { accountNumber: form.accountNumber.trim() } : {}),
      ...(form.pixKey.trim() ? { pixKey: form.pixKey.trim() } : {}),
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    };
    create.mutate(payload, { onSuccess: onClose, onError });
  };

  return (
    <Modal visible onClose={onClose} title={isEdit ? t("cash.accounts.edit") : t("cash.accounts.create")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("cash.accounts.label")} required>
          <Input value={form.label} onChangeText={set("label")} />
        </Field>
        <Field label={t("cash.accounts.bankName")} required>
          <Input value={form.bankName} onChangeText={set("bankName")} />
        </Field>
        {isEdit ? (
          // País y código son inmutables (protegen la conciliación): solo lectura al editar.
          <Text variant="caption" tone="muted">
            {form.countryCode}:{form.bankCode}
          </Text>
        ) : (
          <Row className="gap-2">
            <Stack gap="xs" className="flex-1">
              <Field label={t("cash.accounts.country")} required>
                <Input value={form.countryCode} onChangeText={set("countryCode")} autoCapitalize="characters" />
              </Field>
            </Stack>
            <Stack gap="xs" className="flex-1">
              <Field label={t("cash.accounts.bankCode")} required>
                <Input value={form.bankCode} onChangeText={set("bankCode")} autoCapitalize="characters" />
              </Field>
            </Stack>
          </Row>
        )}
        <Field label={t("cash.accounts.accountNumber")}>
          <Input value={form.accountNumber} onChangeText={set("accountNumber")} />
        </Field>
        <Field label={t("cash.accounts.pixKey")}>
          <Input value={form.pixKey} onChangeText={set("pixKey")} />
        </Field>
        <Field label={t("cash.accounts.apiKey")}>
          <Input
            value={form.apiKey}
            onChangeText={set("apiKey")}
            secureTextEntry
            placeholder={isEdit ? t("cash.accounts.apiKeyKeep") : undefined}
          />
        </Field>
        <Button
          label={isEdit ? t("common.save") : t("cash.accounts.create")}
          loading={create.isPending || update.isPending}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
  );
}

// --- Cajas ------------------------------------------------------------------

function CashBoxesSection() {
  const { t } = useT();
  const accounts = useBankAccounts();
  const boxes = useCashBoxes();
  const collectors = useUsersList("COLLECTOR");
  const del = useDeleteCashBox();
  const [editor, setEditor] = useState<{ box?: CashBox } | null>(null);

  const accountOptions: SelectOption<string>[] = (accounts.data?.items ?? []).map((a) => ({
    value: a.id,
    label: a.label,
  }));
  const collectorOptions: SelectOption<string>[] = (
    collectors.data?.pages.flatMap((p) => p.items) ?? []
  ).map((u) => ({ value: u.id, label: u.email }));
  const collectorLabel = (id: string | null) =>
    id ? collectorOptions.find((c) => c.value === id)?.label ?? id : null;

  return (
    <Stack gap="sm">
      <SectionHeader title={t("cash.config.boxes")} onAdd={() => setEditor({})} />

      {boxes.isPending ? <Spinner label={t("common.loading")} /> : null}
      {boxes.data?.items.length ? (
        boxes.data.items.map((b) => (
          <Card key={b.id}>
            <Row className="justify-between items-center">
              <Stack gap="xs" className="flex-1 pr-3">
                <Text variant="label">{b.name}</Text>
                <Text variant="caption" tone="muted">{t(`cash.boxes.type.${b.type}`)}</Text>
                {b.type === "CASH" && b.assignedTo ? (
                  <Text variant="caption" tone="muted">
                    {t("cash.boxes.collector")}: {collectorLabel(b.assignedTo)}
                  </Text>
                ) : null}
              </Stack>
              <Row className="gap-2">
                <IconButton glyph="✎" label={t("common.edit")} onPress={() => setEditor({ box: b })} />
                <IconButton glyph="🗑" label={t("common.delete")} tone="danger" onPress={() => del.mutate(b.id)} />
              </Row>
            </Row>
          </Card>
        ))
      ) : boxes.data ? (
        <Text tone="muted">{t("cash.boxes.empty")}</Text>
      ) : null}

      {editor ? (
        <CashBoxModal
          box={editor.box}
          accountOptions={accountOptions}
          collectorOptions={collectorOptions}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </Stack>
  );
}

function CashBoxModal({
  box,
  accountOptions,
  collectorOptions,
  onClose,
}: {
  box?: CashBox;
  accountOptions: SelectOption<string>[];
  collectorOptions: SelectOption<string>[];
  onClose: () => void;
}) {
  const { t } = useT();
  const create = useCreateCashBox();
  const update = useUpdateCashBox();
  const isEdit = box !== undefined;
  const [name, setName] = useState(box?.name ?? "");
  const [type, setType] = useState<CashBoxType>(box?.type ?? "CASH");
  const [accountId, setAccountId] = useState(box?.bankAccountId ?? "");
  const [collectorId, setCollectorId] = useState(box?.assignedTo ?? "");
  const [error, setError] = useState<string | null>(null);

  const typeOptions: SelectOption<CashBoxType>[] = [
    { value: "CASH", label: t("cash.boxes.type.CASH") },
    { value: "BANK", label: t("cash.boxes.type.BANK") },
    { value: "TRANSIT", label: t("cash.boxes.type.TRANSIT") },
  ];
  // Centinela "" para dejar la caja sin cobrador (el Select solo emite strings).
  const collectorChoices: SelectOption<string>[] = [
    { value: "", label: t("cash.boxes.selectCollector") },
    ...collectorOptions,
  ];

  const onError = (err: unknown) =>
    setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));

  const submit = () => {
    setError(null);
    if (isEdit) {
      update.mutate(
        {
          id: box.id,
          name: name.trim(),
          ...(box.type === "CASH" ? { assignedTo: collectorId || null } : {}),
        },
        { onSuccess: onClose, onError },
      );
      return;
    }
    create.mutate(
      {
        type,
        name: name.trim(),
        ...(type === "BANK" && accountId ? { bankAccountId: accountId } : {}),
        ...(type === "CASH" && collectorId ? { assignedTo: collectorId } : {}),
      },
      { onSuccess: onClose, onError },
    );
  };

  return (
    <Modal visible onClose={onClose} title={isEdit ? t("cash.boxes.edit") : t("cash.boxes.add")}>
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("cash.boxes.name")} required>
          <Input value={name} onChangeText={setName} />
        </Field>
        {isEdit ? (
          // El tipo (y la cuenta) son inmutables: protegen el libro mayor.
          <Text variant="caption" tone="muted">{t(`cash.boxes.type.${type}`)}</Text>
        ) : (
          <Field label={t("cash.boxes.type")} required>
            <Select value={type} options={typeOptions} onChange={setType} />
          </Field>
        )}
        {!isEdit && type === "BANK" ? (
          <Field label={t("cash.boxes.account")} required>
            <Select
              value={accountId || null}
              options={accountOptions}
              onChange={setAccountId}
              placeholder={t("cash.boxes.selectAccount")}
            />
          </Field>
        ) : null}
        {type === "CASH" ? (
          <Field label={t("cash.boxes.collector")}>
            <Select
              value={collectorId || ""}
              options={collectorChoices}
              onChange={(v) => setCollectorId(v)}
              placeholder={t("cash.boxes.selectCollector")}
            />
          </Field>
        ) : null}
        <Button
          label={isEdit ? t("common.save") : t("cash.boxes.create")}
          loading={create.isPending || update.isPending}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
  );
}
