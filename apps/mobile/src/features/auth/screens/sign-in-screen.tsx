import { useState } from "react";
import { View } from "react-native";
import { loginInput } from "@preztiaos/contracts";
import { Banner, Button, Field, Input, Stack, Text } from "@preztiaos/ui";

import { Screen } from "@/components/screen";
import { useSession } from "@/core/auth/session";
import { useZodForm } from "@/core/form/use-zod-form";
import { isApiError } from "@/core/errors";
import { useT } from "@/core/i18n";

export function SignInScreen() {
  const { t } = useT();
  const { signIn } = useSession();
  const form = useZodForm(loginInput, { email: "", password: "" });
  const [submitError, setSubmitError] = useState<{ message: string; correlationId?: string } | null>(null);
  const [pending, setPending] = useState(false);

  const onSubmit = () =>
    form.handleSubmit(async ({ email, password }) => {
      setSubmitError(null);
      setPending(true);
      try {
        await signIn(email, password);
      } catch (err) {
        setSubmitError({
          message: isApiError(err) ? t(err.messageKey) : t("errors.unknown"),
          correlationId: isApiError(err) ? err.correlationId : undefined,
        });
      } finally {
        setPending(false);
      }
    });

  return (
    <Screen>
      <View className="flex-1 justify-center">
        <Stack gap="xl" className="mx-auto w-full max-w-[420px]">
          <Stack gap="xs">
            <Text variant="title" tone="primary">
              {t("app.name")}
            </Text>
            <Text tone="muted">{t("auth.signIn")}</Text>
          </Stack>

          {submitError ? (
            <Banner
              tone="danger"
              title={submitError.message}
              {...(submitError.correlationId ? { description: `ref: ${submitError.correlationId}` } : {})}
            />
          ) : null}

          <Stack gap="lg">
            <Field label={t("auth.email")} error={form.errors.email} required>
              <Input
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                value={form.values.email}
                onChangeText={(v) => form.setField("email", v)}
                invalid={!!form.errors.email}
                accessibilityLabel={t("auth.email")}
              />
            </Field>

            <Field label={t("auth.password")} error={form.errors.password} required>
              <Input
                secureTextEntry
                autoComplete="current-password"
                value={form.values.password}
                onChangeText={(v) => form.setField("password", v)}
                invalid={!!form.errors.password}
                accessibilityLabel={t("auth.password")}
              />
            </Field>

            <Button
              label={pending ? t("auth.signingIn") : t("auth.signIn")}
              loading={pending}
              block
              onPress={onSubmit}
            />
          </Stack>
        </Stack>
      </View>
    </Screen>
  );
}
