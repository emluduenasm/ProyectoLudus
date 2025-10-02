// src/validators/authSchemas.js
import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2, "Nombre muy corto").max(80),
  email: z.string().email("Email inválido").max(120),
  password: z
    .string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Z]/, "Debe incluir una mayúscula")
    .regex(/[a-z]/, "Debe incluir una minúscula")
    .regex(/[0-9]/, "Debe incluir un número"),
  role: z.enum(["buyer", "designer"]).optional(),
  usePreference: z.enum(["buy", "upload"]).optional()
});

export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "Contraseña inválida")
});
