import { initContract } from "@ts-rest/core";
import { z } from "zod";

const c = initContract();

// Credenciales de acceso. La validación de la frontera vive en el contrato (zod).
export const loginInput = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginInput = z.infer<typeof loginInput>;

// El backend devuelve tokens; el cliente DERIVA tenant/rol de los claims del accessToken
// (no se confía en el cliente para el tenant). El refreshToken es opcional.
export const tokenPair = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).nullable(),
});
export type TokenPair = z.infer<typeof tokenPair>;

export const refreshInput = z.object({
  refreshToken: z.string().min(1),
});

// Contrato de autenticación. Fuente única para API y clientes.
export const authContract = c.router({
  login: {
    method: "POST",
    path: "/auth/login",
    body: loginInput,
    responses: { 200: tokenPair },
    summary: "Autentica con email/contraseña y devuelve tokens",
  },
  refresh: {
    method: "POST",
    path: "/auth/refresh",
    body: refreshInput,
    responses: { 200: tokenPair },
    summary: "Renueva el access token a partir del refresh token",
  },
});
