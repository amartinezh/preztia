import { useCallback, useState } from "react";
import type { z } from "zod";

/**
 * Formularios contract-first sin dependencias nuevas: adapta un `ZodSchema` (el MISMO del
 * contrato `@preztiaos/contracts`) a estado de formulario con errores por campo. La validación
 * ocurre en la frontera (§3.5); el dominio asume datos válidos.
 */

type FieldErrors<TInput> = Partial<Record<keyof TInput, string>>;

export type ZodForm<TInput, TOutput> = {
  values: TInput;
  errors: FieldErrors<TInput>;
  setField: <K extends keyof TInput>(key: K, value: TInput[K]) => void;
  /** Valida; si pasa, invoca `onValid` con la salida parseada y tipada del contrato. */
  handleSubmit: (onValid: (parsed: TOutput) => void | Promise<void>) => void;
  reset: (next?: TInput) => void;
};

export function useZodForm<TSchema extends z.ZodType>(
  schema: TSchema,
  initialValues: z.input<TSchema>,
): ZodForm<z.input<TSchema>, z.output<TSchema>> {
  type TInput = z.input<TSchema>;
  type TOutput = z.output<TSchema>;

  const [values, setValues] = useState<TInput>(initialValues);
  const [errors, setErrors] = useState<FieldErrors<TInput>>({});

  const setField = useCallback(<K extends keyof TInput>(key: K, value: TInput[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }, []);

  const handleSubmit = useCallback(
    (onValid: (parsed: TOutput) => void | Promise<void>) => {
      const result = schema.safeParse(values);
      if (result.success) {
        setErrors({});
        void onValid(result.data as TOutput);
        return;
      }
      const fieldErrors: FieldErrors<TInput> = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0] as keyof TInput | undefined;
        if (key !== undefined && fieldErrors[key] === undefined) {
          fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
    },
    [schema, values],
  );

  const reset = useCallback((next?: TInput) => {
    setValues(next ?? initialValues);
    setErrors({});
  }, [initialValues]);

  return { values, errors, setField, handleSubmit, reset };
}
