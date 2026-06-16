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
import categoriesRoutes from "./routes/categoriesRoutes.js";
import adminDesignsRoutes from "./routes/adminDesignsRoutes.js";
import adminUsersRoutes from "./routes/adminUsersRoutes.js";
import adminProductsRoutes from "./routes/adminProductsRoutes.js";
import ordersRoutes from "./routes/ordersRoutes.js";
import adminOrdersRoutes from "./routes/adminOrdersRoutes.js";
import "./db.js"; // inicializa conexión y crea tablas si no existen


const app = express();

// Required when requests pass through a reverse proxy (e.g., devcontainer/ingress)
// so rate-limit can safely use X-Forwarded-For.
const trustProxy = process.env.TRUST_PROXY;
if (typeof trustProxy === "string" && trustProxy.trim() !== "") {
  app.set("trust proxy", trustProxy === "true" ? true : trustProxy);
} else {
  app.set("trust proxy", 1);
}

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api/designs", designsRoutes);
app.use("/api/designers", designersRoutes);
app.use("/api/categories", categoriesRoutes);
app.use("/api/admin/designs", adminDesignsRoutes);
app.use("/api/admin/users", adminUsersRoutes);
app.use("/api/admin/products", adminProductsRoutes);
app.use("/api/admin/orders", adminOrdersRoutes);
app.use("/api/orders", ordersRoutes);

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
