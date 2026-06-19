import { useMemo } from "react";
import { Pressable } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { PaymentSummary } from "@preztiaos/contracts";
import { Badge, Button, Card, EmptyState, MoneyText, Row, Spinner, Stack, Text } from "@preztiaos/ui";

import { useT } from "@/core/i18n";
import { usePaymentsList } from "../api/queries";
import { paymentBadge } from "./payment-status";

/**
 * Lista de pagos de un crédito. Muestra SOLO los campos que el contrato expone (con CPF/CNPJ
 * ya enmascarado); la PII completa nunca sale de la BD bajo RLS. Cada fila abre el detalle/auditoría
 * del intento. Sin FlatList para evitar virtualización anidada dentro del ScrollView de la cartera.
 */
export function PaymentsList({ creditId }: { creditId: string }) {
  const { t } = useT();
  const router = useRouter();
  const query = usePaymentsList(creditId);

  const items = useMemo<PaymentSummary[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isPending) return <Spinner />;
  if (query.isError) return <Text tone="danger">{t("errors.network")}</Text>;
  if (items.length === 0) return <EmptyState title={t("payments.empty")} />;

  return (
    <Stack gap="sm">
      {items.map((p) => {
        const badge = paymentBadge(p.status);
        return (
          <Pressable key={p.id} onPress={() => router.push(`/payments/${p.id}` as Href)}>
            <Card>
              <Row className="justify-between">
                <Stack gap="xs">
                  <Text variant="label">{p.payerName ?? "—"}</Text>
                  <Text variant="caption" tone="muted">
                    {p.payerTaxIdMasked ?? p.payerBankName ?? p.endToEndId ?? p.id.slice(0, 8)}
                  </Text>
                </Stack>
                <Stack gap="xs" className="items-end">
                  {p.amountMinor !== null ? (
                    <MoneyText variant="label" amountMinor={p.amountMinor} currency={p.currency} />
                  ) : (
                    <Text variant="label" tone="muted">—</Text>
                  )}
                  <Badge tone={badge.tone} label={badge.label} />
                </Stack>
              </Row>
            </Card>
          </Pressable>
        );
      })}
      {query.hasNextPage ? (
        <Button
          label="Cargar más"
          variant="secondary"
          size="sm"
          loading={query.isFetchingNextPage}
          onPress={() => query.fetchNextPage()}
        />
      ) : null}
    </Stack>
  );
}
