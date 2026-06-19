import { useState } from "react";
import type { BankAccountInput, CashBoxType } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  ListItem,
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
import {
  useBankAccounts,
  useCashBoxes,
  useCreateBankAccount,
  useCreateCashBox,
  useDeleteBankAccount,
  useDeleteCashBox,
} from "../api/boxes-queries";

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

function BankAccountsSection() {
  const { t } = useT();
  const list = useBankAccounts();
  const create = useCreateBankAccount();
  const del = useDeleteBankAccount();
  const [form, setForm] = useState<BankAccountInput>(emptyAccount());
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof BankAccountInput) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    setError(null);
    const payload: BankAccountInput = {
      label: form.label.trim(),
      bankName: form.bankName.trim(),
      countryCode: form.countryCode.trim(),
      bankCode: form.bankCode.trim(),
      ...(form.accountNumber?.trim() ? { accountNumber: form.accountNumber.trim() } : {}),
      ...(form.pixKey?.trim() ? { pixKey: form.pixKey.trim() } : {}),
      ...(form.apiKey?.trim() ? { apiKey: form.apiKey.trim() } : {}),
    };
    create.mutate(payload, {
      onSuccess: () => setForm(emptyAccount()),
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  return (
    <Stack gap="sm">
      <Text variant="heading">{t("cash.accounts.title")}</Text>
      {error ? <Banner tone="danger" title={error} /> : null}

      <Card>
        <Stack gap="sm">
          <Field label={t("cash.accounts.label")} required>
            <Input value={form.label} onChangeText={set("label")} />
          </Field>
          <Field label={t("cash.accounts.bankName")} required>
            <Input value={form.bankName} onChangeText={set("bankName")} />
          </Field>
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
          <Field label={t("cash.accounts.accountNumber")}>
            <Input value={form.accountNumber ?? ""} onChangeText={set("accountNumber")} />
          </Field>
          <Field label={t("cash.accounts.pixKey")}>
            <Input value={form.pixKey ?? ""} onChangeText={set("pixKey")} />
          </Field>
          <Field label={t("cash.accounts.apiKey")}>
            <Input value={form.apiKey ?? ""} onChangeText={set("apiKey")} secureTextEntry />
          </Field>
          <Button label={t("cash.accounts.create")} loading={create.isPending} block onPress={submit} />
        </Stack>
      </Card>

      {list.isPending ? <Spinner label={t("common.loading")} /> : null}
      {list.data?.items.length ? (
        list.data.items.map((a) => (
          <ListItem
            key={a.id}
            title={a.label}
            subtitle={`${a.bankName} · ${a.countryCode}:${a.bankCode}`}
            trailing={
              <Row className="items-center gap-2">
                {a.hasApiKey ? <Badge label={t("cash.accounts.hasApiKey")} tone="info" /> : null}
                <Button
                  label={t("common.delete")}
                  variant="ghost"
                  size="sm"
                  onPress={() => del.mutate(a.id)}
                />
              </Row>
            }
          />
        ))
      ) : list.data ? (
        <Text tone="muted">{t("cash.accounts.empty")}</Text>
      ) : null}
    </Stack>
  );
}

function CashBoxesSection() {
  const { t } = useT();
  const accounts = useBankAccounts();
  const boxes = useCashBoxes();
  const create = useCreateCashBox();
  const del = useDeleteCashBox();
  const [name, setName] = useState("");
  const [type, setType] = useState<CashBoxType>("CASH");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const typeOptions: SelectOption<CashBoxType>[] = [
    { value: "CASH", label: t("cash.boxes.type.CASH") },
    { value: "BANK", label: t("cash.boxes.type.BANK") },
    { value: "TRANSIT", label: t("cash.boxes.type.TRANSIT") },
  ];
  const accountOptions: SelectOption<string>[] = (accounts.data?.items ?? []).map((a) => ({
    value: a.id,
    label: a.label,
  }));

  const submit = () => {
    setError(null);
    create.mutate(
      {
        type,
        name: name.trim(),
        ...(type === "BANK" && accountId ? { bankAccountId: accountId } : {}),
      },
      {
        onSuccess: () => {
          setName("");
          setAccountId("");
          setType("CASH");
        },
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Stack gap="sm">
      <Text variant="heading">{t("cash.config.boxes")}</Text>
      {error ? <Banner tone="danger" title={error} /> : null}

      <Card>
        <Stack gap="sm">
          <Field label={t("cash.boxes.name")} required>
            <Input value={name} onChangeText={setName} />
          </Field>
          <Field label={t("cash.boxes.type")} required>
            <Select value={type} options={typeOptions} onChange={setType} />
          </Field>
          {type === "BANK" ? (
            <Field label={t("cash.boxes.account")} required>
              <Select
                value={accountId || null}
                options={accountOptions}
                onChange={setAccountId}
                placeholder={t("cash.boxes.selectAccount")}
              />
            </Field>
          ) : null}
          <Button label={t("cash.boxes.create")} loading={create.isPending} block onPress={submit} />
        </Stack>
      </Card>

      {boxes.data?.items.length ? (
        boxes.data.items.map((b) => (
          <ListItem
            key={b.id}
            title={b.name}
            subtitle={t(`cash.boxes.type.${b.type}`)}
            trailing={
              <Button
                label={t("common.delete")}
                variant="ghost"
                size="sm"
                onPress={() => del.mutate(b.id)}
              />
            }
          />
        ))
      ) : boxes.data ? (
        <Text tone="muted">{t("cash.boxes.empty")}</Text>
      ) : null}
    </Stack>
  );
}

function emptyAccount(): BankAccountInput {
  return {
    label: "",
    bankName: "",
    countryCode: "",
    bankCode: "",
    accountNumber: "",
    pixKey: "",
    apiKey: "",
  };
}
