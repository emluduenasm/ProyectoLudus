import { z } from "zod";

// Regex iguales a los del front
const nameRegex = /^[\p{L}ÁÉÍÓÚáéíóúÑñÜü' -]{2,80}$/u;

export const registerSchema = z.object({
  first_name: z.string()
    .min(2).max(80)
    .regex(nameRegex, "Solo letras/espacios (2–80)"),
  last_name: z.string()
    .min(2).max(80)
    .regex(nameRegex, "Solo letras/espacios (2–80)"),

  dni: z.string()
    .regex(/^\d{8}$/, "DNI debe tener exactamente 8 dígitos"),

  username: z.string()
    .min(3).max(30)
    .regex(/^[a-zA-Z0-9._-]+$/, "Solo letras, números, . _ -"),

  email: z.string().email().max(120),
  password: z.string()
    .min(8, "Mínimo 8 caracteres")
    .regex(/[A-Z]/, "Debe incluir una mayúscula")
    .regex(/[a-z]/, "Debe incluir una minúscula")
    .regex(/\d/, "Debe incluir un número"),

  role: z.enum(["buyer", "designer"]).optional(),
  usePreference: z.enum(["buy", "upload"]).optional()
});
