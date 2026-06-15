import { useState } from "react";
import { FlatList } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, type Href } from "expo-router";
import type { BorrowerColor, BorrowerSummary } from "@preztiaos/contracts";
import { createBorrowerInput, updateBorrowerInput } from "@preztiaos/contracts";
import {
  Badge,
  Banner,
  Button,
  Field,
  Input,
  ListItem,
  minorToMajor,
  majorToMinor,
  Modal,
  MoneyText,
  Row,
  Select,
  Spinner,
  Stack,
  Switch,
  Text,
  type BadgeTone,
  type SelectOption,
} from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { t, useT } from "@/core/i18n";
import type { MessageKey } from "@/core/i18n";
import {
  useBorrowersList,
  useCreateBorrower,
  useUpdateBorrower,
} from "../api/queries";
import { useAddListMembers, useBorrowerLists } from "@/features/lists/api/queries";
import { useBorrowerReport } from "@/features/reporting/api/queries";

const COLORS: BorrowerColor[] = ["NONE", "YELLOW", "BLUE", "RED", "GREEN", "ORANGE"];

const COLOR_TONE: Record<BorrowerColor, BadgeTone> = {
  NONE: "neutral",
  YELLOW: "warning",
  BLUE: "info",
  RED: "danger",
  GREEN: "success",
  ORANGE: "warning",
};

/** Registro de CLIENTES (deudores): listado con búsqueda, alta, edición, color, cupo y bloqueo. */
export function BorrowersScreen() {
  const { t } = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [withoutCredits, setWithoutCredits] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<BorrowerSummary | null>(null);
  const [assigning, setAssigning] = useState<BorrowerSummary | null>(null);
  const [reporting, setReporting] = useState<BorrowerSummary | null>(null);

  const query = useBorrowersList({
    ...(name.trim() ? { name: name.trim() } : {}),
    ...(withoutCredits ? { withoutCredits: true } : {}),
  });
  const items = query.data?.items ?? [];

  return (
    <SafeAreaView edges={["top"]} className="flex-1 bg-white dark:bg-zinc-950">
      <FlatList
        data={items}
        keyExtractor={(b) => b.id}
        className="flex-1"
        contentContainerClassName="mx-auto w-full max-w-[880px] gap-2 p-4"
        ListHeaderComponent={
          <Stack gap="sm" className="pb-2">
            <Row className="justify-between">
              <Text variant="subtitle">{t("borrowers.list.title")}</Text>
              <Row className="gap-2">
                <Button label={t("lists.title")} variant="ghost" size="sm" onPress={() => router.push("/lists" as Href)} />
                <Button label={t("common.create")} size="sm" onPress={() => setCreating(true)} />
              </Row>
            </Row>
            <Input
              value={name}
              onChangeText={setName}
              placeholder={t("borrowers.list.search")}
            />
            <Switch
              value={withoutCredits}
              onValueChange={setWithoutCredits}
              label={t("borrowers.list.withoutCredits")}
            />
          </Stack>
        }
        ListEmptyComponent={
          query.isPending ? (
            <Spinner label={t("common.loading")} />
          ) : (
            <Text tone="muted">{t("borrowers.list.empty")}</Text>
          )
        }
        renderItem={({ item }) => (
          <ListItem
            title={`${item.firstName} ${item.lastName}`.trim()}
            subtitle={subtitleOf(item)}
            trailing={
              <Row className="items-center gap-2">
                {item.color !== "NONE" ? (
                  <Badge label={t(`borrowers.color.${item.color}` as MessageKey)} tone={COLOR_TONE[item.color]} />
                ) : null}
                <Button
                  label={t("reports.summary")}
                  variant="ghost"
                  size="sm"
                  onPress={() => setReporting(item)}
                />
                <Button
                  label={t("lists.assign")}
                  variant="ghost"
                  size="sm"
                  onPress={() => setAssigning(item)}
                />
                <Button
                  label={t("borrowers.action.edit")}
                  variant="ghost"
                  size="sm"
                  onPress={() => setEditing(item)}
                />
              </Row>
            }
          />
        )}
      />
      <AssignListModal
        key={assigning?.id ?? "assign-idle"}
        borrower={assigning}
        onClose={() => setAssigning(null)}
      />
      <BorrowerReportModal borrower={reporting} onClose={() => setReporting(null)} />
      <BorrowerFormModal
        key={creating ? "new" : "new-idle"}
        visible={creating}
        onClose={() => setCreating(false)}
      />
      <BorrowerFormModal
        key={editing?.id ?? "edit-idle"}
        visible={editing !== null}
        borrower={editing}
        onClose={() => setEditing(null)}
      />
    </SafeAreaView>
  );
}

function subtitleOf(b: BorrowerSummary): string {
  const cupo = `${t("borrowers.field.creditLimit")}: ${minorToMajor(b.creditLimitMinor)}`;
  const parts = [b.nationalId, b.business, b.phone].filter(Boolean) as string[];
  const blocked = b.creditBlocked ? ` · ${t("borrowers.field.creditBlocked")}` : "";
  return `${parts.join(" · ")} · ${cupo}${blocked}`;
}

/** Modal "Resumen del cliente desde la última liquidada". */
function BorrowerReportModal({
  borrower,
  onClose,
}: {
  borrower: BorrowerSummary | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const query = useBorrowerReport(borrower?.id ?? null);
  return (
    <Modal visible={borrower !== null} onClose={onClose} title={t("reports.summaryTitle")}>
      <Stack gap="sm" className="p-4">
        {query.isPending || !query.data ? (
          <Spinner label={t("common.loading")} />
        ) : (
          <>
            <ReportRow label={t("reports.activeCredits")} value={String(query.data.activeCredits)} />
            <ReportRow label={t("reports.settledCredits")} value={String(query.data.settledCredits)} />
            <Row className="justify-between">
              <Text tone="muted">{t("reports.debt")}</Text>
              <MoneyText variant="label" amountMinor={query.data.outstandingMinor} currency="COP" />
            </Row>
            <Row className="justify-between">
              <Text tone="muted">{t("reports.due")}</Text>
              <MoneyText variant="label" amountMinor={query.data.dueSinceLastSettlementMinor} currency="COP" />
            </Row>
            <Row className="justify-between">
              <Text tone="muted">{t("reports.paid")}</Text>
              <MoneyText variant="label" amountMinor={query.data.paidSinceLastSettlementMinor} currency="COP" />
            </Row>
          </>
        )}
      </Stack>
    </Modal>
  );
}

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <Row className="justify-between">
      <Text tone="muted">{label}</Text>
      <Text variant="label">{value}</Text>
    </Row>
  );
}

/** Modal para asignar un cliente a una lista personalizada existente. */
function AssignListModal({
  borrower,
  onClose,
}: {
  borrower: BorrowerSummary | null;
  onClose: () => void;
}) {
  const { t } = useT();
  const lists = useBorrowerLists();
  const addMembers = useAddListMembers();
  const [listId, setListId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const options: SelectOption<string>[] = (lists.data?.items ?? []).map((l) => ({
    value: l.id,
    label: l.name,
  }));

  const submit = () => {
    setError(null);
    if (!borrower || !listId) {
      setError(t("errors.validation"));
      return;
    }
    addMembers.mutate(
      { listId, borrowerIds: [borrower.id] },
      {
        onSuccess: onClose,
        onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
      },
    );
  };

  return (
    <Modal visible={borrower !== null} onClose={onClose} title={t("lists.assignTitle")}>
      <Stack gap="md" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        {options.length === 0 ? (
          <Text tone="muted">{t("lists.empty")}</Text>
        ) : (
          <>
            <Field label={t("lists.title")}>
              <Select value={listId} options={options} onChange={setListId} title={t("lists.title")} />
            </Field>
            <Button label={t("lists.assign")} loading={addMembers.isPending} block onPress={submit} />
          </>
        )}
      </Stack>
    </Modal>
  );
}

/** Formulario compartido de alta/edición de cliente (color, cupo, bloqueo de créditos). */
function BorrowerFormModal({
  visible,
  onClose,
  borrower,
}: {
  visible: boolean;
  onClose: () => void;
  borrower?: BorrowerSummary | null;
}) {
  const { t } = useT();
  const create = useCreateBorrower();
  const update = useUpdateBorrower();
  const isEdit = !!borrower;

  const [nationalId, setNationalId] = useState(borrower?.nationalId ?? "");
  const [firstName, setFirstName] = useState(borrower?.firstName ?? "");
  const [lastName, setLastName] = useState(borrower?.lastName ?? "");
  const [business, setBusiness] = useState(borrower?.business ?? "");
  const [phone, setPhone] = useState(borrower?.phone ?? "");
  const [color, setColor] = useState<BorrowerColor>(borrower?.color ?? "NONE");
  const [creditLimit, setCreditLimit] = useState(
    borrower ? String(minorToMajor(borrower.creditLimitMinor)) : "0",
  );
  const [creditBlocked, setCreditBlocked] = useState(borrower?.creditBlocked ?? false);
  const [error, setError] = useState<string | null>(null);

  const colorOptions: SelectOption<BorrowerColor>[] = COLORS.map((c) => ({
    value: c,
    label: t(`borrowers.color.${c}` as MessageKey),
  }));

  const submit = () => {
    setError(null);
    const fields = {
      nationalId: nationalId.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      business: business.trim() || null,
      phone: phone.trim() || null,
      lat: null,
      lng: null,
      color,
      creditBlocked,
      creditLimitMinor: majorToMinor(Number(creditLimit) || 0),
    };
    const onError = (err: unknown) =>
      setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown"));

    if (isEdit && borrower) {
      const parsed = updateBorrowerInput.safeParse(fields);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
        return;
      }
      update.mutate({ id: borrower.id, patch: parsed.data }, { onSuccess: onClose, onError });
      return;
    }
    const parsed = createBorrowerInput.safeParse(fields);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("errors.validation"));
      return;
    }
    create.mutate(parsed.data, { onSuccess: onClose, onError });
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={isEdit ? t("borrowers.edit.title") : t("borrowers.new.title")}
    >
      <Stack gap="md" className="p-4">
        {error ? <Banner tone="danger" title={error} /> : null}
        <Field label={t("borrowers.field.nationalId")} required>
          <Input value={nationalId} onChangeText={setNationalId} />
        </Field>
        <Field label={t("borrowers.field.firstName")} required>
          <Input value={firstName} onChangeText={setFirstName} />
        </Field>
        <Field label={t("borrowers.field.lastName")}>
          <Input value={lastName} onChangeText={setLastName} />
        </Field>
        <Field label={t("borrowers.field.business")}>
          <Input value={business} onChangeText={setBusiness} />
        </Field>
        <Field label={t("borrowers.field.phone")}>
          <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        </Field>
        <Field label={t("borrowers.field.color")}>
          <Select value={color} options={colorOptions} onChange={setColor} title={t("borrowers.field.color")} />
        </Field>
        <Field label={t("borrowers.field.creditLimit")}>
          <Input value={creditLimit} onChangeText={setCreditLimit} keyboardType="numeric" />
        </Field>
        <Switch
          value={creditBlocked}
          onValueChange={setCreditBlocked}
          label={t("borrowers.field.creditBlocked")}
        />
        <Button
          label={isEdit ? t("common.save") : t("borrowers.new.submit")}
          loading={create.isPending || update.isPending}
          block
          onPress={submit}
        />
      </Stack>
    </Modal>
  );
}
