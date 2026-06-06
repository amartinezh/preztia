import { useMutation } from '@tanstack/react-query';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/lib/api';

// Payload de ejemplo. En la app real vendría de un formulario validado con el mismo zod del contrato.
const SAMPLE = {
  borrowerId: '11111111-1111-1111-1111-111111111111',
  zoneId: '22222222-2222-2222-2222-222222222222',
  principalMinor: 500_000,
  interestPct: 20,
  installmentsCount: 12,
};
const SAMPLE_TENANT = '33333333-3333-3333-3333-333333333333';

export default function HomeScreen() {
  const grant = useMutation({
    mutationFn: async () => {
      const res = await api.grantCredit({
        headers: { 'x-tenant-id': SAMPLE_TENANT },
        body: SAMPLE,
      });
      if (res.status !== 201) {
        throw new Error(`API respondió ${res.status}`);
      }
      return res.body; // { id, installments } — tipado desde el contrato
    },
  });

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-neutral-950">
      <ScrollView contentContainerClassName="flex-1 items-center justify-center gap-6 px-6">
        <Text className="text-3xl font-bold text-neutral-900 dark:text-white">
          PreztiaOS
        </Text>
        <Text className="text-center text-base text-neutral-500 dark:text-neutral-400">
          Cliente tipado ts-rest + React Query{'\n'}corriendo en {Platform.OS}
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={grant.isPending}
          onPress={() => grant.mutate()}
          className="rounded-2xl bg-indigo-600 px-6 py-3 active:opacity-80 disabled:opacity-50"
        >
          <Text className="text-base font-semibold text-white">
            {grant.isPending ? 'Otorgando…' : 'Otorgar crédito de prueba'}
          </Text>
        </Pressable>

        {grant.isSuccess && (
          <View className="w-full rounded-2xl bg-emerald-50 p-4 dark:bg-emerald-950">
            <Text className="font-semibold text-emerald-700 dark:text-emerald-300">
              Crédito creado
            </Text>
            <Text className="mt-1 text-emerald-700 dark:text-emerald-300">
              id: {grant.data.id}
            </Text>
            <Text className="text-emerald-700 dark:text-emerald-300">
              cuotas: {grant.data.installments}
            </Text>
          </View>
        )}

        {grant.isError && (
          <View className="w-full rounded-2xl bg-red-50 p-4 dark:bg-red-950">
            <Text className="font-semibold text-red-700 dark:text-red-300">
              Error: {grant.error.message}
            </Text>
            <Text className="mt-1 text-xs text-red-600 dark:text-red-400">
              ¿Está la API arriba en localhost:3000?
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
