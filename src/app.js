// src/app.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import designsRoutes from "./routes/designsRoutes.js";
import designersRoutes from "./routes/designersRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import "./db.js"; // inicializa conexión y crea tablas si no existen


const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api/designs", designsRoutes);
app.use("/api/designers", designersRoutes);

// limitador solo para /api/auth/*
app.use(
  "/api/auth",
  rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true })
);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api/auth", authRoutes);

// Home (sirve index.html)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

export default app;
