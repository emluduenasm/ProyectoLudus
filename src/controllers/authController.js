// src/controllers/authController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { findUserByEmail, createUser } from "../models/userModel.js";
import { registerSchema, loginSchema } from "../validators/authSchemas.js";

const signToken = (user) =>
  jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

export const register = async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);
    const exists = await findUserByEmail(data.email);
    if (exists) return res.status(409).json({ error: "El email ya está registrado." });

    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await createUser({
      name: data.name.trim(),
      email: data.email.toLowerCase(),
      passwordHash,
      role: data.role || "buyer",
      usePreference: data.usePreference || "buy"
    });

    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (err) {
    if (err?.issues) {
      return res.status(400).json({ error: "Datos inválidos", details: err.issues });
    }
    console.error(err);
    res.status(500).json({ error: "Error de servidor" });
  }
};

export const login = async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);
    const user = await findUserByEmail(data.email.toLowerCase());
    if (!user) return res.status(401).json({ error: "Credenciales inválidas" });

    const ok = await bcrypt.compare(data.password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    const token = signToken(user);
    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        use_preference: user.use_preference
      },
      token
    });
  } catch (err) {
    if (err?.issues) {
      return res.status(400).json({ error: "Datos inválidos", details: err.issues });
    }
    console.error(err);
    res.status(500).json({ error: "Error de servidor" });
  }
};

export const me = async (req, res) => {
  res.json({ user: req.user });
};
