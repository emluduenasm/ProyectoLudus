// /public/js/admin-products.js
const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
const $ = (s, r = document) => r.querySelector(s);
const token = localStorage.getItem("token") || "";
const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});

async function guardAdmin() {
  try {
    const res = await fetch(api("/auth/me"), {
      headers: { ...auth(), Accept: "application/json" },
      cache: "no-store"
    });
    if (!res.ok) {
      location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
      return false;
    }
    const me = await res.json();
    if (me.role !== "admin") {
      const main = document.querySelector("main") || document.body;
      main.innerHTML = `
        <section class="card" style="max-width:900px;margin:2rem auto;padding:1rem">
          <h1>Acceso denegado</h1>
          <p class="muted">Se requieren permisos de administrador.</p>
          <p style="margin-top:1rem"><a class="btn" href="/"><i class="fa-solid fa-house"></i> Volver</a></p>
        </section>`;
      return false;
    }
    return true;
  } catch {
    location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
    return false;
  }
}

const state = {
  page: 1,
  limit: 10,
  q: "",
  published: "",
  sort: "newest"
};

const controls = {
  rows: $("#rows"),
  q: $("#q"),
  btnSearch: $("#btnSearch"),
  resultInfo: $("#resultInfo"),
  pageInfo: $("#pageInfo"),
  prev: $("#prev"),
  next: $("#next"),
  fPublished: $("#fPublished"),
  fSort: $("#fSort"),
  fLimit: $("#fLimit"),
  btnClear: $("#btnClear"),
  empty: $("#emptyState"),
  btnNew: $("#btnNew")
};

const modal = $("#modal");
const form = $("#formProduct");
const formMsg = $("#formMsg");
const modalTitle = $("#modalTitle");
const previewImg = $("#preview");
const fileInput = $("#file");
const cancelBtn = $("#btnCancel");
const modalCloseBtn = $("#btnModalClose");
const submitBtn = $("#btnSubmit");
const wizardHead = $("#wizardHead");
const wizardProgress = $("#wizardProgress");
const wizardStep1 = $("#wizardStep1");
const wizardStep2 = $("#wizardStep2");
const wizardActions = $("#wizardActions");
const stepTextPanel = $("#wizardStepText");
const stepImagePanel = $("#wizardStepImage");
const btnStepBack = $("#btnStepBack");
const btnStepNext = $("#btnStepNext");
const mockupCanvas = $("#mockup-canvas");
const overlayEl = $("#mockup-overlay");
const widthInput = $("#mockup-width");
const heightInput = $("#mockup-height");
const leftInput = $("#mockup-left");
const topInput = $("#mockup-top");
const curveTopInput = $("#mockup-curve-top");
const curveBottomInput = $("#mockup-curve-bottom");
const curveLeftInput = $("#mockup-curve-left");
const curveRightInput = $("#mockup-curve-right");
const widthLabel = $("#mockup-width-value");
const heightLabel = $("#mockup-height-value");
const leftLabel = $("#mockup-left-value");
const topLabel = $("#mockup-top-value");
const curveTopLabel = $("#mockup-curve-top-value");
const curveBottomLabel = $("#mockup-curve-bottom-value");
const curveLeftLabel = $("#mockup-curve-left-value");
const curveRightLabel = $("#mockup-curve-right-value");
const pricingSiteProfitEl = $("#pricingSiteProfit");
const pricingBaseEl = $("#pricingBase");
const pricingCommissionEl = $("#pricingCommission");
const pricingFinalEl = $("#pricingFinal");
const costComponentsEl = $("#costComponents");
const btnAddCost = $("#btnAddCost");
const fixedCostsTotalEl = $("#fixedCostsTotal");

const DEFAULT_MOCKUP = {
  width_pct: 0.45,
  height_pct: 0.45,
  left_pct: 0.5,
  top_pct: 0.5,
  curve_top_pct: 0,
  curve_bottom_pct: 0,
  curve_left_pct: 0,
  curve_right_pct: 0
};
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

let currentMockup = { ...DEFAULT_MOCKUP };
let isCreateMode = true;
let currentCreateStep = 1;

if (previewImg) {
  previewImg.addEventListener("load", () => {
    if (!mockupCanvas) return;
    if (previewImg.naturalWidth && previewImg.naturalHeight) {
      const ratio = (previewImg.naturalHeight / previewImg.naturalWidth) * 100;
      mockupCanvas.style.paddingTop = `${Math.max(10, ratio)}%`;
    } else {
      mockupCanvas.style.paddingTop = "100%";
    }
    updateOverlayDisplay();
  });
}

const formatCurrency = (value) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(
    Number(value ?? 0)
  );

const formatDate = (iso) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("es-AR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  } catch {
    return "";
  }
};

const roundMoney = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

function calculatePricing(values = {}) {
  const productCost = roundMoney(values.product_cost);
  const fixedCosts = roundMoney(values.fixed_costs);
  const siteProfitPercent = roundMoney(values.site_profit_percent);
  const commissionType = values.designer_commission_type === "fixed" ? "fixed" : "percent";
  const commissionValue = roundMoney(values.designer_commission_value);
  const productionCost = roundMoney(productCost + fixedCosts);
  const siteProfitAmount = roundMoney(productionCost * (siteProfitPercent / 100));
  const designerBasePrice = roundMoney(productionCost + siteProfitAmount);
  const designerCommissionAmount =
    commissionType === "fixed"
      ? commissionValue
      : roundMoney(designerBasePrice * (commissionValue / 100));
  return {
    site_profit_amount: siteProfitAmount,
    designer_base_price: designerBasePrice,
    designer_commission_amount: designerCommissionAmount,
    price: roundMoney(designerBasePrice + designerCommissionAmount)
  };
}

function setEmptyState(show) {
  if (!controls.empty) return;
  controls.empty.style.display = show ? "block" : "none";
}

const emptyPreview =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Crect width='160' height='160' rx='18' fill='%23e2e8f0'/%3E%3Cpath d='M48 60a32 32 0 1064 0 32 32 0 00-64 0zm32 80c-27 0-50.7-16.9-60-41l27-21 18 14 24-28 33 36c-10.5 23.5-33.7 40-60 40z' fill='%2394a3b8'/%3E%3C/svg%3E";
let currentObjectURL = null;
const PREVIEW_CURVE_INSET = 0.42;

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeAttr = (value = "") => escapeHtml(value);

const clamp = (value, min, max, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
};

function normalizeLocalConfig(cfg = {}) {
  const base = { ...DEFAULT_MOCKUP, ...(cfg || {}) };
  const width = clamp(base.width_pct, 0.05, 0.9, DEFAULT_MOCKUP.width_pct);
  const height = clamp(
    base.height_pct,
    0.05,
    0.9,
    Number.isFinite(base.height_pct) ? base.height_pct : width
  );
  const left = clamp(base.left_pct, 0, 1, DEFAULT_MOCKUP.left_pct);
  const top = clamp(base.top_pct, 0, 1, DEFAULT_MOCKUP.top_pct);
  // Backward-compat: if old x/y exist, map them into side-specific curves.
  const fallbackSideTop = Number.isFinite(base.curve_y_pct) ? base.curve_y_pct : DEFAULT_MOCKUP.curve_top_pct;
  const fallbackSideBottom = Number.isFinite(base.curve_y_pct) ? base.curve_y_pct : DEFAULT_MOCKUP.curve_bottom_pct;
  const fallbackSideLeft = Number.isFinite(base.curve_x_pct) ? base.curve_x_pct : DEFAULT_MOCKUP.curve_left_pct;
  const fallbackSideRight = Number.isFinite(base.curve_x_pct) ? base.curve_x_pct : DEFAULT_MOCKUP.curve_right_pct;

  const curveTop = clamp(base.curve_top_pct, -1, 1, fallbackSideTop);
  const curveBottom = clamp(base.curve_bottom_pct, -1, 1, fallbackSideBottom);
  const curveLeft = clamp(base.curve_left_pct, -1, 1, fallbackSideLeft);
  const curveRight = clamp(base.curve_right_pct, -1, 1, fallbackSideRight);

  return {
    width_pct: width,
    height_pct: height,
    left_pct: left,
    top_pct: top,
    curve_top_pct: curveTop,
    curve_bottom_pct: curveBottom,
    curve_left_pct: curveLeft,
    curve_right_pct: curveRight
  };
}

function updateOverlayDisplay() {
  if (!overlayEl) return;
  const visible = previewImg && previewImg.src && previewImg.style.display !== "none" && previewImg.src !== emptyPreview;
  overlayEl.style.display = visible ? "block" : "none";
  if (!visible) return;
  const widthPercent = currentMockup.width_pct * 100;
  const heightPercent = currentMockup.height_pct * 100;
  const leftPercent = (currentMockup.left_pct - currentMockup.width_pct / 2) * 100;
  const topPercent = (currentMockup.top_pct - currentMockup.height_pct / 2) * 100;
  overlayEl.style.width = `${widthPercent.toFixed(2)}%`;
  overlayEl.style.height = `${heightPercent.toFixed(2)}%`;
  overlayEl.style.left = `${leftPercent.toFixed(2)}%`;
  overlayEl.style.top = `${topPercent.toFixed(2)}%`;
  overlayEl.style.borderRadius = "0";
  overlayEl.style.clipPath = buildCurvedOverlayClipPath(
    currentMockup.curve_top_pct,
    currentMockup.curve_bottom_pct,
    currentMockup.curve_left_pct,
    currentMockup.curve_right_pct
  );
}

function buildCurvedOverlayClipPath(curveTop = 0, curveBottom = 0, curveLeft = 0, curveRight = 0) {
  const ct = clamp(Number(curveTop), -1, 1, 0);
  const cb = clamp(Number(curveBottom), -1, 1, 0);
  const cl = clamp(Number(curveLeft), -1, 1, 0);
  const cr = clamp(Number(curveRight), -1, 1, 0);
  if (ct === 0 && cb === 0 && cl === 0 && cr === 0) return "none";

  const seg = 18;
  const points = [];
  const profile = (v, c) => (c >= 0 ? (1 - v * v) : (v * v));
  const insetTopAt = (nx) => Math.abs(ct) * PREVIEW_CURVE_INSET * profile(nx, ct);
  const insetBottomAt = (nx) => Math.abs(cb) * PREVIEW_CURVE_INSET * profile(nx, cb);
  const insetLeftAt = (ny) => Math.abs(cl) * PREVIEW_CURVE_INSET * profile(ny, cl);
  const insetRightAt = (ny) => Math.abs(cr) * PREVIEW_CURVE_INSET * profile(ny, cr);

  // Top edge (left -> right)
  for (let i = 0; i <= seg; i += 1) {
    const nx = (i / seg) * 2 - 1;
    const x = i / seg;
    const y = insetTopAt(nx) / 2;
    points.push(`${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
  }

  // Right edge (top -> bottom)
  for (let i = 1; i <= seg; i += 1) {
    const ny = (i / seg) * 2 - 1;
    const x = 1 - insetRightAt(ny) / 2;
    const y = i / seg;
    points.push(`${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
  }

  // Bottom edge (right -> left)
  for (let i = seg - 1; i >= 0; i -= 1) {
    const nx = (i / seg) * 2 - 1;
    const x = i / seg;
    const y = 1 - insetBottomAt(nx) / 2;
    points.push(`${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
  }

  // Left edge (bottom -> top)
  for (let i = seg - 1; i >= 1; i -= 1) {
    const ny = (i / seg) * 2 - 1;
    const x = insetLeftAt(ny) / 2;
    const y = i / seg;
    points.push(`${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
  }

  return `polygon(${points.join(",")})`;
}

function syncMockupInputs() {
  if (!widthInput || !heightInput || !leftInput || !topInput || !curveTopInput || !curveBottomInput || !curveLeftInput || !curveRightInput) return;
  const widthValue = Math.round(currentMockup.width_pct * 100);
  const heightValue = Math.round(currentMockup.height_pct * 100);
  const leftValue = Math.round(currentMockup.left_pct * 100);
  const topValue = Math.round(currentMockup.top_pct * 100);
  const curveTopValue = Math.round(currentMockup.curve_top_pct * 100);
  const curveBottomValue = Math.round(currentMockup.curve_bottom_pct * 100);
  const curveLeftValue = Math.round(currentMockup.curve_left_pct * 100);
  const curveRightValue = Math.round(currentMockup.curve_right_pct * 100);

  widthInput.value = String(widthValue);
  heightInput.value = String(heightValue);

  leftInput.min = "0";
  leftInput.max = "100";
  topInput.min = "0";
  topInput.max = "100";

  leftInput.value = String(Math.round(currentMockup.left_pct * 100));
  topInput.value = String(Math.round(currentMockup.top_pct * 100));
  curveTopInput.value = String(curveTopValue);
  curveBottomInput.value = String(curveBottomValue);
  curveLeftInput.value = String(curveLeftValue);
  curveRightInput.value = String(curveRightValue);

  if (widthLabel) widthLabel.textContent = `${Math.round(widthInput.value)}%`;
  if (heightLabel) heightLabel.textContent = `${Math.round(heightInput.value)}%`;
  if (leftLabel) leftLabel.textContent = `${Math.round(leftInput.value)}%`;
  if (topLabel) topLabel.textContent = `${Math.round(topInput.value)}%`;
  if (curveTopLabel) curveTopLabel.textContent = `${Math.round(curveTopInput.value)}%`;
  if (curveBottomLabel) curveBottomLabel.textContent = `${Math.round(curveBottomInput.value)}%`;
  if (curveLeftLabel) curveLeftLabel.textContent = `${Math.round(curveLeftInput.value)}%`;
  if (curveRightLabel) curveRightLabel.textContent = `${Math.round(curveRightInput.value)}%`;
}

function setMockupConfig(cfg) {
  currentMockup = normalizeLocalConfig(cfg);
  syncMockupInputs();
  updateOverlayDisplay();
}

function normalizeCostComponents(components = []) {
  const list = Array.isArray(components) ? components : [];
  return list
    .map((item) => ({
      name: String(item?.name || "").trim().replace(/\s+/g, " "),
      amount: roundMoney(item?.amount)
    }))
    .filter((item) => item.name || item.amount > 0);
}

function sumCostComponents(components = []) {
  return roundMoney(components.reduce((sum, item) => sum + Number(item.amount || 0), 0));
}

function readCostComponents() {
  if (!costComponentsEl) return [];
  return normalizeCostComponents(
    Array.from(costComponentsEl.querySelectorAll(".cost-component-row")).map((row) => ({
      name: row.querySelector("[data-cost-name]")?.value || "",
      amount: row.querySelector("[data-cost-amount]")?.value || 0
    }))
  );
}

function renderCostComponents(components = []) {
  if (!costComponentsEl) return;
  const list = (Array.isArray(components) ? components : []).map((item) => ({
    name: String(item?.name || ""),
    amount: item?.amount ?? ""
  }));
  const rows = list.length ? list : [{ name: "", amount: 0 }];
  costComponentsEl.innerHTML = rows
    .map(
      (item) => `
        <div class="cost-component-row">
          <label>Nombre
            <input data-cost-name class="input" type="text" maxlength="80" placeholder="Ej: tinta" value="${escapeAttr(item.name || "")}"/>
          </label>
          <label>Valor (ARS)
            <input data-cost-amount class="input" type="number" min="0" step="1" placeholder="0" value="${escapeAttr(item.amount || "")}"/>
          </label>
          <button type="button" class="btn btn-outline" data-cost-remove aria-label="Quitar costo">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      `
    )
    .join("");
  bindCostComponentRows();
  updatePricingPreview();
}

function bindCostComponentRows() {
  if (!costComponentsEl) return;
  costComponentsEl.querySelectorAll("[data-cost-name], [data-cost-amount]").forEach((input) => {
    input.addEventListener("input", () => {
      validatePricingFields(true);
      updatePricingPreview();
    });
  });
  costComponentsEl.querySelectorAll("[data-cost-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const row = button.closest(".cost-component-row");
      row?.remove();
      if (!costComponentsEl.querySelector(".cost-component-row")) {
        renderCostComponents([{ name: "", amount: 0 }]);
        return;
      }
      updatePricingPreview();
    });
  });
}

function addCostComponentRow(component = { name: "", amount: 0 }) {
  const current = readCostComponents();
  current.push(component);
  renderCostComponents(current);
}

function readPricingForm() {
  return {
    product_cost: Number(form?.product_cost?.value || 0),
    fixed_costs: sumCostComponents(readCostComponents()),
    site_profit_percent: Number(form?.site_profit_percent?.value || 0),
    designer_commission_type: form?.designer_commission_type?.value || "percent",
    designer_commission_value: Number(form?.designer_commission_value?.value || 0)
  };
}

function updatePricingPreview() {
  const pricing = calculatePricing(readPricingForm());
  if (fixedCostsTotalEl) fixedCostsTotalEl.textContent = formatCurrency(readPricingForm().fixed_costs);
  if (pricingSiteProfitEl) pricingSiteProfitEl.textContent = formatCurrency(pricing.site_profit_amount);
  if (pricingBaseEl) pricingBaseEl.textContent = formatCurrency(pricing.designer_base_price);
  if (pricingCommissionEl) pricingCommissionEl.textContent = formatCurrency(pricing.designer_commission_amount);
  if (pricingFinalEl) pricingFinalEl.textContent = formatCurrency(pricing.price);
}

function handleRangeChange() {
  if (!widthInput || !heightInput || !leftInput || !topInput || !curveTopInput || !curveBottomInput || !curveLeftInput || !curveRightInput) return;
  const width = clamp(Number(widthInput.value) / 100, 0.05, 0.9, currentMockup.width_pct);
  const height = clamp(Number(heightInput.value) / 100, 0.05, 0.9, currentMockup.height_pct);
  const left = clamp(Number(leftInput.value) / 100, 0, 1, currentMockup.left_pct);
  const top = clamp(Number(topInput.value) / 100, 0, 1, currentMockup.top_pct);
  const curveTop = clamp(Number(curveTopInput.value) / 100, -1, 1, currentMockup.curve_top_pct);
  const curveBottom = clamp(Number(curveBottomInput.value) / 100, -1, 1, currentMockup.curve_bottom_pct);
  const curveLeft = clamp(Number(curveLeftInput.value) / 100, -1, 1, currentMockup.curve_left_pct);
  const curveRight = clamp(Number(curveRightInput.value) / 100, -1, 1, currentMockup.curve_right_pct);

  currentMockup = normalizeLocalConfig({
    width_pct: width,
    height_pct: height,
    left_pct: left,
    top_pct: top,
    curve_top_pct: curveTop,
    curve_bottom_pct: curveBottom,
    curve_left_pct: curveLeft,
    curve_right_pct: curveRight
  });
  syncMockupInputs();
  updateOverlayDisplay();
}

function revokePreviewObject() {
  if (currentObjectURL) {
    URL.revokeObjectURL(currentObjectURL);
    currentObjectURL = null;
  }
}

function setPreviewFromUrl(url) {
  if (!previewImg) return;
  revokePreviewObject();
  const clean =
    typeof url === "string" && url.trim().length ? url.trim() : emptyPreview;
  previewImg.src = clean;
  const isPlaceholder = clean === emptyPreview;
  previewImg.style.display = isPlaceholder ? "none" : "block";
  if (mockupCanvas) {
    mockupCanvas.style.paddingTop = "100%";
  }
  updateOverlayDisplay();
}

function setCreateStepLabel(step) {
  if (!wizardProgress || !wizardStep1 || !wizardStep2) return;
  const onStep2 = step === 2;
  wizardProgress.style.setProperty("--wizard-progress", onStep2 ? "100%" : "0%");
  wizardStep1.classList.toggle("is-active", !onStep2);
  wizardStep1.classList.toggle("is-done", onStep2);
  wizardStep2.classList.toggle("is-active", onStep2);
  wizardStep2.classList.toggle("is-done", false);
  const activeStep = onStep2 ? wizardStep2 : wizardStep1;
  if (activeStep) {
    const dot = activeStep.querySelector(".wizard-step-dot");
    if (dot) {
      dot.style.animation = "none";
      // Force reflow so the animation restarts on each step change
      void dot.offsetWidth;
      dot.style.animation = "";
    }
  }
}

function renderCreateStep(step) {
  currentCreateStep = step === 2 ? 2 : 1;
  if (stepTextPanel) stepTextPanel.hidden = currentCreateStep !== 1;
  if (stepImagePanel) stepImagePanel.hidden = currentCreateStep !== 2;
  if (btnStepBack) btnStepBack.hidden = currentCreateStep !== 2;
  if (btnStepNext) btnStepNext.hidden = currentCreateStep !== 1;
  setCreateStepLabel(currentCreateStep);
}

function validateTextStep() {
  if (!validateNameField(true)) {
    form.name?.reportValidity?.();
    return false;
  }
  if (!validateDescriptionField(true)) {
    form.description?.reportValidity?.();
    return false;
  }
  if (!validatePricingFields(true)) {
    return false;
  }
  if (!validateStockField(true)) {
    form.stock?.reportValidity?.();
    return false;
  }
  return true;
}

function validateImageStep() {
  if (!validateImageField(true)) {
    fileInput?.reportValidity?.();
    fileInput?.focus?.();
    return false;
  }
  formMsg.textContent = "";
  return true;
}

function setFieldState(input, isValid, touched) {
  if (!input) return;
  input.classList.remove("is-valid", "is-invalid");
  if (!touched) return;
  input.classList.add(isValid ? "is-valid" : "is-invalid");
}

function validateNameField(touched = false) {
  const input = form?.name;
  if (!input) return true;
  const value = (input.value || "").trim();
  const valid = value.length >= 3;
  input.setCustomValidity(valid ? "" : "El nombre debe tener al menos 3 caracteres.");
  setFieldState(input, valid, touched || value.length > 0);
  return valid;
}

function validateDescriptionField(touched = false) {
  const input = form?.description;
  if (!input) return true;
  const value = (input.value || "").trim();
  const valid = value.length > 0;
  input.setCustomValidity(valid ? "" : "La descripción es obligatoria.");
  setFieldState(input, valid, touched || value.length > 0);
  return valid;
}

function validateMoneyField(input, label, touched = false) {
  if (!input) return true;
  const raw = (input.value || "").trim();
  const value = Number(raw);
  const valid = raw !== "" && Number.isFinite(value) && value >= 0;
  input.setCustomValidity(valid ? "" : `Ingresá un valor válido para ${label}.`);
  setFieldState(input, valid, touched || raw.length > 0);
  return valid;
}

function validatePricingFields(touched = false) {
  const fields = [
    [form?.product_cost, "costo producto"],
    [form?.site_profit_percent, "ganancia sitio"],
    [form?.designer_commission_value, "comisión diseñador"]
  ];
  const baseValid = fields.every(([input, label]) => validateMoneyField(input, label, touched));
  const costsValid = validateCostComponents(touched);
  return baseValid && costsValid;
}

function validateCostComponents(touched = false) {
  if (!costComponentsEl) return true;
  let valid = true;
  costComponentsEl.querySelectorAll(".cost-component-row").forEach((row) => {
    const nameInput = row.querySelector("[data-cost-name]");
    const amountInput = row.querySelector("[data-cost-amount]");
    const name = (nameInput?.value || "").trim();
    const rawAmount = (amountInput?.value || "").trim();
    const amount = Number(rawAmount);
    const empty = !name && !rawAmount;
    const rowValid = empty || (Boolean(name) && rawAmount !== "" && Number.isFinite(amount) && amount >= 0);
    if (nameInput) {
      nameInput.setCustomValidity(rowValid ? "" : "Ingresá el nombre del costo.");
      setFieldState(nameInput, rowValid, touched || Boolean(name));
    }
    if (amountInput) {
      amountInput.setCustomValidity(rowValid ? "" : "Ingresá un monto válido.");
      setFieldState(amountInput, rowValid, touched || rawAmount.length > 0);
    }
    valid = valid && rowValid;
  });
  return valid;
}

function validateStockField(touched = false) {
  const input = form?.stock;
  if (!input) return true;
  const raw = (input.value || "").trim();
  const value = Number(raw);
  const valid = raw !== "" && Number.isInteger(value) && value >= 0;
  input.setCustomValidity(valid ? "" : "Ingresá un stock entero válido (0 o mayor).");
  setFieldState(input, valid, touched || raw.length > 0);
  return valid;
}

function validateImageField(touched = false) {
  if (!fileInput) return true;
  const file = fileInput.files?.[0];
  const isCreate = Boolean(isCreateMode && !form?.id?.value);
  let message = "";

  if (!file) {
    if (isCreate) message = "La imagen es obligatoria.";
  } else if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    message = "Formato no válido. Usá PNG, JPG o WEBP.";
  } else if (file.size > MAX_IMAGE_BYTES) {
    message = "La imagen supera los 6MB.";
  }

  fileInput.setCustomValidity(message);
  setFieldState(fileInput, message === "", touched || Boolean(file));
  if (touched && message) formMsg.textContent = message;
  return message === "";
}

function resetValidationUI() {
  [form?.name, form?.description, form?.product_cost, form?.site_profit_percent, form?.designer_commission_value, form?.stock, fileInput].forEach((input) => {
    if (!input) return;
    input.classList.remove("is-valid", "is-invalid");
    input.setCustomValidity("");
  });
}

function configureModalMode(createMode) {
  isCreateMode = Boolean(createMode);
  // Keep the same 2-step wizard UI for both create and edit.
  if (wizardHead) wizardHead.hidden = false;
  if (wizardActions) wizardActions.hidden = false;
  submitBtn.disabled = false;
  renderCreateStep(1);
}

async function loadProducts() {
  controls.rows.innerHTML = `<tr><td colspan="6">Cargando…</td></tr>`;
  setEmptyState(false);

  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit,
    sort: state.sort
  });
  if (state.q) params.set("q", state.q);
  if (state.published !== "") params.set("published", state.published);

  const res = await fetch(api(`/admin/products?${params.toString()}`), {
    headers: { ...auth(), Accept: "application/json" },
    cache: "no-store"
  });
  if (!res.ok) {
    controls.rows.innerHTML = `<tr><td colspan="6">No se pudo cargar la lista.</td></tr>`;
    return;
  }

  const data = await res.json();
  controls.resultInfo.textContent = `${data.total} producto(s)`;
  controls.pageInfo.textContent = `Página ${data.page} · ${data.items.length}/${state.limit}`;
  controls.prev.disabled = state.page <= 1;
  controls.next.disabled = data.page * state.limit >= data.total;

  if (!data.items.length) {
    controls.rows.innerHTML = "";
    setEmptyState(true);
    return;
  }

  setEmptyState(false);
  controls.rows.innerHTML = data.items
    .map((p) => {
      const image = p.image_url || emptyPreview;
      const nameEsc = escapeHtml(p.name || "—");
      const desc = p.description || "";
      const descShort = desc.length > 80 ? `${desc.slice(0, 77)}…` : desc || "—";
      const descEsc = escapeHtml(descShort);
      const configAttr = encodeURIComponent(JSON.stringify(p.mockup_config || {}));
      const costsAttr = encodeURIComponent(JSON.stringify(p.cost_components || []));
      return `
        <tr
          data-id="${escapeAttr(p.id)}"
          data-name="${escapeAttr(p.name || "")}" 
          data-description="${escapeAttr(p.description || "")}" 
          data-price="${escapeAttr(p.price ?? 0)}" 
          data-product-cost="${escapeAttr(p.product_cost ?? 0)}"
          data-fixed-costs="${escapeAttr(p.fixed_costs ?? 0)}"
          data-cost-components="${costsAttr}"
          data-site-profit-percent="${escapeAttr(p.site_profit_percent ?? 0)}"
          data-designer-commission-type="${escapeAttr(p.designer_commission_type || "percent")}"
          data-designer-commission-value="${escapeAttr(p.designer_commission_value ?? 0)}"
          data-designer-base-price="${escapeAttr(p.designer_base_price ?? 0)}"
          data-designer-commission-amount="${escapeAttr(p.designer_commission_amount ?? 0)}"
          data-stock="${escapeAttr(p.stock ?? 0)}" 
          data-image="${escapeAttr(p.image_url || "")}" 
          data-config="${configAttr}" 
          data-published="${p.published ? "1" : "0"}"
        >
          <td>
            <div style="display:flex;gap:.75rem;align-items:center">
              <img class="product-thumb" src="${image}" alt="${nameEsc}"/>
              <div>
                <div style="font-weight:600">${nameEsc}</div>
                <div class="muted-sm">${descEsc}</div>
              </div>
            </div>
          </td>
          <td class="price">
            <div>${formatCurrency(p.price)}</div>
            <div class="muted-sm">Base producto ${formatCurrency(p.designer_base_price || 0)} · Comisión ${formatCurrency(p.designer_commission_amount || 0)}</div>
          </td>
          <td>${p.stock ?? 0}</td>
          <td>
            <span class="status-pill ${p.published ? "published" : "unpublished"}">
              <i class="fa-solid ${p.published ? "fa-circle-check" : "fa-circle-xmark"}"></i>
              ${p.published ? "Publicado" : "Oculto"}
            </span>
          </td>
          <td>${formatDate(p.updated_at)}</td>
          <td class="right">
            <div class="actions">
              <button class="btn" data-action="edit"><i class="fa-solid fa-pen"></i> Editar</button>
              <button class="btn btn-danger" data-action="delete"><i class="fa-solid fa-trash"></i> Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  controls.rows
    .querySelectorAll("button[data-action]")
    .forEach((btn) => btn.addEventListener("click", handleRowAction));
}

function handleRowAction(ev) {
  const btn = ev.currentTarget;
  const action = btn.dataset.action;
  const tr = btn.closest("tr");
  if (!tr) return;
  let config = {};
  if (tr.dataset.config) {
    try {
      config = JSON.parse(decodeURIComponent(tr.dataset.config));
    } catch {}
  }
  let costComponents = [];
  if (tr.dataset.costComponents) {
    try {
      costComponents = JSON.parse(decodeURIComponent(tr.dataset.costComponents));
    } catch {}
  }
  const product = {
    id: tr.dataset.id,
    name: tr.dataset.name || "",
    description: tr.dataset.description || "",
    price: tr.dataset.price || "0",
    product_cost: tr.dataset.productCost || "0",
    fixed_costs: tr.dataset.fixedCosts || "0",
    cost_components: Array.isArray(costComponents) ? costComponents : [],
    site_profit_percent: tr.dataset.siteProfitPercent || "0",
    designer_commission_type: tr.dataset.designerCommissionType || "percent",
    designer_commission_value: tr.dataset.designerCommissionValue || "0",
    designer_base_price: tr.dataset.designerBasePrice || "0",
    designer_commission_amount: tr.dataset.designerCommissionAmount || "0",
    stock: tr.dataset.stock || "0",
    image_url: tr.dataset.image || "",
    published: tr.dataset.published === "1",
    mockup_config: config
  };
  if (!product.id) return;
  if (action === "edit") {
    openModal(product);
  } else if (action === "delete") {
    confirmDelete(product.id, product.name);
  }
}

function updatePreview(file) {
  if (!previewImg) return;
  revokePreviewObject();
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      setPreviewFromUrl(reader.result);
    };
    reader.onerror = () => {
      const original = form?.dataset?.originalImage || "";
      setPreviewFromUrl(original);
    };
    reader.readAsDataURL(file);
  } else {
    const original = form?.dataset?.originalImage || "";
    setPreviewFromUrl(original);
  }
}

function resetForm() {
  form.reset();
  formMsg.textContent = "";
  resetValidationUI();
  setPreviewFromUrl(null);
  if (form?.dataset) {
    form.dataset.originalImage = "";
  }
  setMockupConfig(DEFAULT_MOCKUP);
  if (form?.product_cost) form.product_cost.value = "0";
  renderCostComponents([{ name: "", amount: 0 }]);
  if (form?.site_profit_percent) form.site_profit_percent.value = "0";
  if (form?.designer_commission_type) form.designer_commission_type.value = "percent";
  if (form?.designer_commission_value) form.designer_commission_value.value = "0";
  updatePricingPreview();
  configureModalMode(true);
}

function openModal(product) {
  resetForm();
  if (form?.dataset) {
    form.dataset.originalImage = product?.image_url || "";
  }
  setMockupConfig(product?.mockup_config || DEFAULT_MOCKUP);
  if (product && product.id) {
    configureModalMode(false);
    form.id.value = product.id;
    form.name.value = product.name || "";
    form.description.value = product.description || "";
    form.product_cost.value = product.product_cost ?? "0";
    renderCostComponents(
      product.cost_components?.length
        ? product.cost_components
        : [{ name: "Costos fijos", amount: product.fixed_costs || 0 }]
    );
    form.site_profit_percent.value = product.site_profit_percent ?? "0";
    form.designer_commission_type.value = product.designer_commission_type || "percent";
    form.designer_commission_value.value = product.designer_commission_value ?? "0";
    form.stock.value = product.stock ?? "";
    form.published.checked = !!product.published;
    setPreviewFromUrl(product.image_url);
    modalTitle.textContent = "Editar producto";
  } else {
    configureModalMode(true);
    modalTitle.textContent = "Nuevo producto";
    form.published.checked = true;
  }
  updatePricingPreview();
  if (typeof modal?.showModal === "function") {
    modal.showModal();
  }
}

function handleNextStep() {
  if (!validateTextStep()) return;
  renderCreateStep(2);
}

function handleBackStep() {
  renderCreateStep(1);
}

async function confirmDelete(id, name = "") {
  if (!id) return;
  if (!confirm(`¿Eliminar "${name || "este producto"}"?`)) return;
  try {
    const res = await fetch(api(`/admin/products/${id}`), {
      method: "DELETE",
      headers: { ...auth() },
      cache: "no-store"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "No se pudo eliminar");
    await loadProducts();
  } catch (error) {
    alert(error.message || "No se pudo eliminar");
  }
}

function closeModal() {
  if (typeof modal?.close === "function") modal.close();
  resetForm();
}

async function submitForm(ev) {
  ev?.preventDefault?.();
  const id = form.id.value;
  const isEdit = Boolean(id);

  if (!validateTextStep()) {
    renderCreateStep(1);
    return;
  }
  if (!validateImageStep()) {
    renderCreateStep(2);
    return;
  }

  if (!form?.reportValidity?.()) return;

  submitBtn.disabled = true;
  formMsg.textContent = "Guardando…";

  const formData = new FormData();
  formData.set("name", form.name.value.trim());
  formData.set("description", form.description.value.trim());
  const costComponents = readCostComponents();
  formData.set("product_cost", form.product_cost.value);
  formData.set("fixed_costs", String(sumCostComponents(costComponents)));
  formData.set("cost_components", JSON.stringify(costComponents));
  formData.set("site_profit_percent", form.site_profit_percent.value);
  formData.set("designer_commission_type", form.designer_commission_type.value);
  formData.set("designer_commission_value", form.designer_commission_value.value);
  formData.set("stock", form.stock.value);
  formData.set("published", form.published.checked ? "1" : "0");

  const file = fileInput?.files?.[0];
  if (file) {
    formData.set("image", file);
  } else if (!isEdit) {
    formMsg.textContent = "Seleccioná una imagen para el nuevo producto.";
    submitBtn.disabled = false;
    return;
  }

  formData.set("mockup_width_pct", String(currentMockup.width_pct));
  formData.set("mockup_height_pct", String(currentMockup.height_pct));
  formData.set("mockup_left_pct", String(currentMockup.left_pct));
  formData.set("mockup_top_pct", String(currentMockup.top_pct));
  formData.set("mockup_curve_top_pct", String(currentMockup.curve_top_pct));
  formData.set("mockup_curve_bottom_pct", String(currentMockup.curve_bottom_pct));
  formData.set("mockup_curve_left_pct", String(currentMockup.curve_left_pct));
  formData.set("mockup_curve_right_pct", String(currentMockup.curve_right_pct));

  try {
    const res = await fetch(
      api(isEdit ? `/admin/products/${id}` : "/admin/products"),
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { ...auth() },
        body: formData,
        cache: "no-store"
      }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "No se pudo guardar");
    closeModal();
    await loadProducts();
  } catch (error) {
    formMsg.textContent = error.message || "Error al guardar";
  } finally {
    submitBtn.disabled = false;
  }
}

async function init() {
  if (!(await guardAdmin())) return;

  controls.fLimit.value = String(state.limit);
  controls.fSort.value = state.sort;
  controls.fPublished.value = state.published;

  controls.btnSearch?.addEventListener("click", () => {
    state.q = controls.q.value.trim();
    state.page = 1;
    loadProducts();
  });
  controls.q?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      state.q = controls.q.value.trim();
      state.page = 1;
      loadProducts();
    }
  });
  controls.btnClear?.addEventListener("click", () => {
    controls.q.value = "";
    state.q = "";
    controls.fPublished.value = "";
    state.published = "";
    controls.fSort.value = "newest";
    state.sort = "newest";
    controls.fLimit.value = "10";
    state.limit = 10;
    state.page = 1;
    loadProducts();
  });

  controls.fPublished?.addEventListener("change", () => {
    state.published = controls.fPublished.value;
    state.page = 1;
    loadProducts();
  });
  controls.fSort?.addEventListener("change", () => {
    state.sort = controls.fSort.value;
    state.page = 1;
    loadProducts();
  });
  controls.fLimit?.addEventListener("change", () => {
    state.limit = Number.parseInt(controls.fLimit.value, 10) || 10;
    state.page = 1;
    loadProducts();
  });

  controls.prev?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      loadProducts();
    }
  });
  controls.next?.addEventListener("click", () => {
    state.page += 1;
    loadProducts();
  });

  controls.btnNew?.addEventListener("click", () => openModal(null));
  cancelBtn?.addEventListener("click", closeModal);
  modalCloseBtn?.addEventListener("click", closeModal);
  form?.addEventListener("submit", submitForm);
  modal?.addEventListener("close", resetForm);
  btnStepNext?.addEventListener("click", handleNextStep);
  btnStepBack?.addEventListener("click", handleBackStep);

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    updatePreview(file);
    validateImageField(true);
  });
  form?.name?.addEventListener("input", () => {
    validateNameField(true);
  });
  form?.description?.addEventListener("input", () => {
    validateDescriptionField(true);
  });
  [form?.product_cost, form?.site_profit_percent, form?.designer_commission_value].forEach((input) => {
    input?.addEventListener("input", () => {
      validatePricingFields(true);
      updatePricingPreview();
    });
  });
  form?.designer_commission_type?.addEventListener("change", updatePricingPreview);
  btnAddCost?.addEventListener("click", () => addCostComponentRow());
  form?.stock?.addEventListener("input", () => {
    validateStockField(true);
  });
  widthInput?.addEventListener("input", () => {
    handleRangeChange();
  });
  heightInput?.addEventListener("input", () => {
    handleRangeChange();
  });
  leftInput?.addEventListener("input", () => {
    handleRangeChange();
  });
  topInput?.addEventListener("input", () => {
    handleRangeChange();
  });
  curveTopInput?.addEventListener("input", () => {
    handleRangeChange();
  });
  curveBottomInput?.addEventListener("input", () => {
    handleRangeChange();
  });
  curveLeftInput?.addEventListener("input", () => {
    handleRangeChange();
  });
  curveRightInput?.addEventListener("input", () => {
    handleRangeChange();
  });

  setMockupConfig(DEFAULT_MOCKUP);
  await loadProducts();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
