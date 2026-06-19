import { useState } from "react";
import type { CreateBorrowerInput, ExtractedIdentityView } from "@preztiaos/contracts";
import { Badge, Banner, Button, Field, Input, ListItem, Row, Stack, Text } from "@preztiaos/ui";

import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";
import { useBorrowersList, useCreateBorrower } from "@/features/borrowers/api/queries";

const MIN_SEARCH = 2;

type Props = {
  /** Datos del cliente extraídos por OCR (para precargar "Crear Cliente"). */
  extractedIdentity: ExtractedIdentityView | null;
  /** Teléfono del solicitante (E.164): se usa como teléfono del cliente nuevo. */
  applicantPhone: string;
  /** Cliente actualmente asignado a la solicitud (`null` si aún no hay). */
  selected: { id: string; label: string } | null;
  onSelect: (borrower: { id: string; label: string } | null) => void;
};

/**
 * Gestión del deudor en la revisión: o se crea desde los datos del OCR (un clic), o se elige uno
 * ya registrado por búsqueda. Al fijar el deudor, emite su UUID hacia arriba; ese UUID es el que
 * habilita el botón de aprobar (regla de negocio). No decide la transacción: solo selecciona.
 */
export function BorrowerPicker({ extractedIdentity, applicantPhone, selected, onSelect }: Props) {
  const { t } = useT();
  const create = useCreateBorrower();
  const [term, setTerm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const search = useBorrowersList(term.trim().length >= MIN_SEARCH ? { name: term.trim() } : {});
  const results = term.trim().length >= MIN_SEARCH ? search.data?.items ?? [] : [];

  // Solo se puede crear desde OCR si hay cédula y nombre legibles.
  const canCreateFromOcr =
    !!extractedIdentity?.nationalId && extractedIdentity.firstName.trim().length > 0;

  const createFromOcr = () => {
    if (!extractedIdentity) return;
    setError(null);
    const input: CreateBorrowerInput = {
      nationalId: extractedIdentity.nationalId ?? "",
      firstName: extractedIdentity.firstName,
      lastName: extractedIdentity.lastName,
      business: null,
      phone: applicantPhone,
      lat: null,
      lng: null,
      color: "NONE",
      creditBlocked: false,
      creditLimitMinor: 0,
    };
    create.mutate(input, {
      onSuccess: ({ id }) =>
        onSelect({ id, label: `${input.firstName} ${input.lastName}`.trim() || input.nationalId }),
      onError: (err) => setError(isApiError(err) ? t(err.messageKey) : t("errors.unknown")),
    });
  };

  if (selected) {
    return (
      <Stack gap="xs" className="rounded-xl border border-emerald-300 p-3 dark:border-emerald-800">
        <Row className="items-center justify-between">
          <Text variant="label">{t("borrower.selectedLabel")}</Text>
          <Badge tone="success" label={selected.label} />
        </Row>
        <Button label={t("borrower.change")} variant="ghost" size="sm" onPress={() => onSelect(null)} />
      </Stack>
    );
  }

  return (
    <Stack gap="sm">
      {error ? <Banner tone="danger" title={error} /> : null}

      {/* Crear cliente desde los datos del OCR (un clic). */}
      {extractedIdentity ? (
        <Stack gap="xs" className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
          <Text variant="label">{t("borrower.fromOcr")}</Text>
          <Row className="justify-between">
            <Text tone="muted">{t("borrower.nationalId")}</Text>
            <Text variant="label">{extractedIdentity.nationalId ?? "—"}</Text>
          </Row>
          <Row className="justify-between">
            <Text tone="muted">{t("borrower.name")}</Text>
            <Text variant="label">{extractedIdentity.fullName ?? "—"}</Text>
          </Row>
          <Button
            label={t("borrower.create")}
            loading={create.isPending}
            disabled={!canCreateFromOcr}
            block
            onPress={createFromOcr}
          />
          {!canCreateFromOcr ? (
            <Text variant="caption" tone="muted">
              {t("borrower.ocrIncomplete")}
            </Text>
          ) : null}
        </Stack>
      ) : null}

      {/* Elegir un cliente ya registrado. */}
      <Field label={t("borrower.searchExisting")}>
        <Input value={term} onChangeText={setTerm} placeholder={t("borrower.searchPlaceholder")} />
      </Field>
      {results.map((b) => (
        <ListItem
          key={b.id}
          title={`${b.firstName} ${b.lastName}`.trim() || b.nationalId}
          subtitle={b.nationalId}
          onPress={() =>
            onSelect({ id: b.id, label: `${b.firstName} ${b.lastName}`.trim() || b.nationalId })
          }
        />
      ))}
    </Stack>
  );
}
