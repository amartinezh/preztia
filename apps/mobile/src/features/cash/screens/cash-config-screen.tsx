import { useState } from "react";
import type {
  BankAccount,
  BankAccountInput,
  BankProviderType,
  BankReportConfig,
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
  Switch,
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
  useVerifyBankCredentials,
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
          <BankAccountCard key={a.id} account={a} onEdit={() => setEditor({ account: a })} onDelete={() => del.mutate(a.id)} />
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

/**
 * Tarjeta de una entidad de pago con sus TOGGLES de operación en línea: medio de pago activo,
 * validación de pagos (¿participa al verificar comprobantes?) y validación de saldo. Cada
 * interruptor persiste de inmediato (PATCH parcial) — es el panel donde se elige con cuál(es)
 * entidades (PicPay, Mercado Pago, Banco Inter) se valida un pago.
 */
function BankAccountCard({
  account: a,
  onEdit,
  onDelete,
}: {
  account: BankAccount;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const update = useUpdateBankAccount();
  const toggle = (patch: { active?: boolean; verifyPaymentsEnabled?: boolean; balanceCheckEnabled?: boolean }) =>
    update.mutate({ id: a.id, patch });

  return (
    <Card>
      <Stack gap="sm">
        <Row className="justify-between items-center">
          <Stack gap="xs" className="flex-1 pr-3">
            <Text variant="label">{a.label}</Text>
            <Text variant="caption" tone="muted">
              {a.bankName} · {t(`cash.accounts.provider.${a.providerType}`)}
            </Text>
            <Row className="gap-1 flex-wrap">
              {a.hasApiKey ? (
                <Badge label={t("cash.accounts.hasApiKey")} tone="info" />
              ) : null}
              {a.hasPublicKey ? (
                <Badge label={t("cash.accounts.hasPublicKey")} tone="info" />
              ) : null}
              {a.hasAccessToken ? (
                <Badge label={t("cash.accounts.hasAccessToken")} tone="success" />
              ) : null}
              {a.hasClientId && a.hasClientSecret ? (
                <Badge label={t("cash.accounts.hasClientCredentials")} tone="success" />
              ) : null}
              {a.hasWebhookSecret ? (
                <Badge label={t("cash.accounts.hasWebhookSecret")} tone="info" />
              ) : null}
            </Row>
          </Stack>
          <Row className="gap-2">
            <IconButton glyph="✎" label={t("common.edit")} onPress={onEdit} />
            <IconButton glyph="🗑" label={t("common.delete")} tone="danger" onPress={onDelete} />
          </Row>
        </Row>
        <Switch
          label={t("cash.accounts.activeToggle")}
          value={a.active}
          disabled={update.isPending}
          onValueChange={(v) => toggle({ active: v })}
        />
        <Switch
          label={t("cash.accounts.verifyPaymentsToggle")}
          value={a.verifyPaymentsEnabled}
          disabled={update.isPending || !a.active}
          onValueChange={(v) => toggle({ verifyPaymentsEnabled: v })}
        />
        <Switch
          label={t("cash.accounts.balanceCheckToggle")}
          value={a.balanceCheckEnabled}
          disabled={update.isPending || !a.active}
          onValueChange={(v) => toggle({ balanceCheckEnabled: v })}
        />
      </Stack>
    </Card>
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
  const verify = useVerifyBankCredentials();
  const isEdit = account !== undefined;
  // Campos de texto (todos string) → editables con el helper `set`.
  const [form, setForm] = useState({
    label: account?.label ?? "",
    bankName: account?.bankName ?? "",
    countryCode: account?.countryCode ?? "",
    bankCode: account?.bankCode ?? "",
    accountNumber: account?.accountNumber ?? "",
    pixKey: account?.pixKey ?? "",
    apiKey: "",
    receiverTaxId: account?.receiverTaxId ?? "",
    receiverName: account?.receiverName ?? "",
    publicKey: "",
    accessToken: "",
    webhookSecret: "",
    clientId: "",
    clientSecret: "",
    timezone: account?.reportConfig?.timezone ?? "",
    windowDays:
      account?.reportConfig?.windowDays != null
        ? String(account.reportConfig.windowDays)
        : "",
  });
  // Campos no-string con su propio estado tipado.
  const [providerType, setProviderType] = useState<BankProviderType>(
    account?.providerType ?? "MANUAL",
  );
  const [reportTranslation, setReportTranslation] = useState<string>(
    account?.reportConfig?.reportTranslation ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const set = (k: keyof typeof form) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const isMercadoPago = providerType === "MERCADOPAGO";
  const isPicPay = providerType === "PICPAY";

  const providerOptions: SelectOption<BankProviderType>[] = [
    { value: "MANUAL", label: t("cash.accounts.provider.MANUAL") },
    { value: "INTER", label: t("cash.accounts.provider.INTER") },
    { value: "MERCADOPAGO", label: t("cash.accounts.provider.MERCADOPAGO") },
    { value: "PICPAY", label: t("cash.accounts.provider.PICPAY") },
  ];
  const translationOptions: SelectOption<string>[] = [
    { value: "", label: t("cash.accounts.reportTranslationDefault") },
    { value: "en", label: "en" },
    { value: "es", label: "es" },
    { value: "pt", label: "pt" },
  ];

  const onError = (err: unknown) =>
    setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));

  // Arma reportConfig solo con lo que el operador llenó (undefined = no enviar).
  const buildReportConfig = (): BankReportConfig | undefined => {
    const rc: BankReportConfig = {};
    if (reportTranslation)
      rc.reportTranslation = reportTranslation as "en" | "es" | "pt";
    if (form.timezone.trim()) rc.timezone = form.timezone.trim();
    const wd = Number.parseInt(form.windowDays, 10);
    if (Number.isFinite(wd) && wd > 0) rc.windowDays = wd;
    return Object.keys(rc).length ? rc : undefined;
  };

  const submit = () => {
    setError(null);
    const reportConfig = buildReportConfig();
    if (isEdit) {
      update.mutate(
        {
          id: account.id,
          patch: {
            label: form.label.trim(),
            bankName: form.bankName.trim(),
            accountNumber: form.accountNumber.trim() || null,
            providerType,
            pixKey: form.pixKey.trim() || null,
            receiverTaxId: form.receiverTaxId.trim() || null,
            receiverName: form.receiverName.trim() || null,
            reportConfig: reportConfig ?? null,
            // Secretos: solo si el operador escribió algo (vacío = no cambiar).
            ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
            ...(form.publicKey.trim() ? { publicKey: form.publicKey.trim() } : {}),
            ...(form.accessToken.trim()
              ? { accessToken: form.accessToken.trim() }
              : {}),
            ...(form.webhookSecret.trim()
              ? { webhookSecret: form.webhookSecret.trim() }
              : {}),
            ...(form.clientId.trim() ? { clientId: form.clientId.trim() } : {}),
            ...(form.clientSecret.trim()
              ? { clientSecret: form.clientSecret.trim() }
              : {}),
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
      providerType,
      ...(form.accountNumber.trim()
        ? { accountNumber: form.accountNumber.trim() }
        : {}),
      ...(form.pixKey.trim() ? { pixKey: form.pixKey.trim() } : {}),
      ...(form.receiverTaxId.trim()
        ? { receiverTaxId: form.receiverTaxId.trim() }
        : {}),
      ...(form.receiverName.trim()
        ? { receiverName: form.receiverName.trim() }
        : {}),
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      ...(form.publicKey.trim() ? { publicKey: form.publicKey.trim() } : {}),
      ...(form.accessToken.trim()
        ? { accessToken: form.accessToken.trim() }
        : {}),
      ...(form.webhookSecret.trim()
        ? { webhookSecret: form.webhookSecret.trim() }
        : {}),
      ...(form.clientId.trim() ? { clientId: form.clientId.trim() } : {}),
      ...(form.clientSecret.trim()
        ? { clientSecret: form.clientSecret.trim() }
        : {}),
      ...(reportConfig ? { reportConfig } : {}),
    };
    create.mutate(payload, { onSuccess: onClose, onError });
  };

  const runTest = () => {
    if (!account) return;
    setTestMsg(null);
    verify.mutate(account.id, {
      onSuccess: (r) =>
        setTestMsg({
          ok: r.ok,
          text: r.ok
            ? t("cash.accounts.testOk")
            : r.detail ?? t("cash.accounts.testFail"),
        }),
      onError: () => setTestMsg({ ok: false, text: t("cash.accounts.testFail") }),
    });
  };

  return (
    <Modal
      visible
      onClose={onClose}
      title={isEdit ? t("cash.accounts.edit") : t("cash.accounts.create")}
    >
      <Stack gap="sm" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("cash.accounts.label")} required>
          <Input value={form.label} onChangeText={set("label")} />
        </Field>
        <Field label={t("cash.accounts.bankName")} required>
          <Input value={form.bankName} onChangeText={set("bankName")} />
        </Field>
        <Field label={t("cash.accounts.provider")} required>
          <Select
            value={providerType}
            options={providerOptions}
            onChange={setProviderType}
          />
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

        {isMercadoPago || isPicPay ? (
          <>
            <Text variant="label">{t("cash.accounts.receiver")}</Text>
            <Field label={t("cash.accounts.receiverTaxId")}>
              <Input value={form.receiverTaxId} onChangeText={set("receiverTaxId")} />
            </Field>
            <Field label={t("cash.accounts.receiverName")}>
              <Input value={form.receiverName} onChangeText={set("receiverName")} />
            </Field>
          </>
        ) : null}

        {isMercadoPago ? (
          <>
            <Text variant="label">{t("cash.accounts.credentials")}</Text>
            <Field label={t("cash.accounts.publicKey")}>
              <Input
                value={form.publicKey}
                onChangeText={set("publicKey")}
                secureTextEntry
                placeholder={account?.hasPublicKey ? t("cash.accounts.secretKeep") : undefined}
              />
            </Field>
            <Field label={t("cash.accounts.accessToken")}>
              <Input
                value={form.accessToken}
                onChangeText={set("accessToken")}
                secureTextEntry
                placeholder={account?.hasAccessToken ? t("cash.accounts.secretKeep") : undefined}
              />
            </Field>
            <Field label={t("cash.accounts.webhookSecret")}>
              <Input
                value={form.webhookSecret}
                onChangeText={set("webhookSecret")}
                secureTextEntry
                placeholder={account?.hasWebhookSecret ? t("cash.accounts.secretKeep") : undefined}
              />
            </Field>

            <Text variant="label">{t("cash.accounts.report")}</Text>
            <Field label={t("cash.accounts.reportTranslation")}>
              <Select
                value={reportTranslation}
                options={translationOptions}
                onChange={setReportTranslation}
              />
            </Field>
            <Field label={t("cash.accounts.timezone")}>
              <Input
                value={form.timezone}
                onChangeText={set("timezone")}
                placeholder="America/Sao_Paulo"
              />
            </Field>
            <Field label={t("cash.accounts.windowDays")}>
              <Input
                value={form.windowDays}
                onChangeText={set("windowDays")}
                keyboardType="number-pad"
              />
            </Field>
          </>
        ) : null}

        {isPicPay ? (
          <>
            <Text variant="label">{t("cash.accounts.credentials")}</Text>
            <Field label={t("cash.accounts.clientId")}>
              <Input
                value={form.clientId}
                onChangeText={set("clientId")}
                secureTextEntry
                placeholder={account?.hasClientId ? t("cash.accounts.secretKeep") : undefined}
              />
            </Field>
            <Field label={t("cash.accounts.clientSecret")}>
              <Input
                value={form.clientSecret}
                onChangeText={set("clientSecret")}
                secureTextEntry
                placeholder={account?.hasClientSecret ? t("cash.accounts.secretKeep") : undefined}
              />
            </Field>
            <Field label={t("cash.accounts.picpayWebhookToken")}>
              <Input
                value={form.webhookSecret}
                onChangeText={set("webhookSecret")}
                secureTextEntry
                placeholder={account?.hasWebhookSecret ? t("cash.accounts.secretKeep") : undefined}
              />
            </Field>
            {/* La URL de notificación se registra en el Painel Lojista de PicPay. */}
            <Text variant="caption" tone="muted">
              {t("cash.accounts.picpayWebhookHint")}
            </Text>
          </>
        ) : null}

        {!isMercadoPago && !isPicPay ? (
          <Field label={t("cash.accounts.apiKey")}>
            <Input
              value={form.apiKey}
              onChangeText={set("apiKey")}
              secureTextEntry
              placeholder={isEdit ? t("cash.accounts.apiKeyKeep") : undefined}
            />
          </Field>
        ) : null}

        {(isMercadoPago || isPicPay) && isEdit ? (
          <>
            <Button
              label={t("cash.accounts.testCredentials")}
              variant="secondary"
              loading={verify.isPending}
              onPress={runTest}
            />
            {testMsg ? (
              <Banner
                tone={testMsg.ok ? "success" : "danger"}
                title={testMsg.text}
              />
            ) : null}
          </>
        ) : null}

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
