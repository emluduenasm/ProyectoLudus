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
const submitBtn = $("#btnSubmit");
const mockupCanvas = $("#mockup-canvas");
const overlayEl = $("#mockup-overlay");
const widthInput = $("#mockup-width");
const heightInput = $("#mockup-height");
const leftInput = $("#mockup-left");
const topInput = $("#mockup-top");
const widthLabel = $("#mockup-width-value");
const heightLabel = $("#mockup-height-value");
const leftLabel = $("#mockup-left-value");
const topLabel = $("#mockup-top-value");

const DEFAULT_MOCKUP = {
  width_pct: 0.45,
  height_pct: 0.45,
  left_pct: 0.5,
  top_pct: 0.18
};

let currentMockup = { ...DEFAULT_MOCKUP };

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

function setEmptyState(show) {
  if (!controls.empty) return;
  controls.empty.style.display = show ? "block" : "none";
}

const emptyPreview =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Crect width='160' height='160' rx='18' fill='%23e2e8f0'/%3E%3Cpath d='M48 60a32 32 0 1064 0 32 32 0 00-64 0zm32 80c-27 0-50.7-16.9-60-41l27-21 18 14 24-28 33 36c-10.5 23.5-33.7 40-60 40z' fill='%2394a3b8'/%3E%3C/svg%3E";
let currentObjectURL = null;

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

  return {
    width_pct: width,
    height_pct: height,
    left_pct: left,
    top_pct: top
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
}

function syncMockupInputs() {
  if (!widthInput || !heightInput || !leftInput || !topInput) return;
  const widthValue = Math.round(currentMockup.width_pct * 100);
  const heightValue = Math.round(currentMockup.height_pct * 100);
  const leftValue = Math.round(currentMockup.left_pct * 100);
  const topValue = Math.round(currentMockup.top_pct * 100);

  widthInput.value = String(widthValue);
  heightInput.value = String(heightValue);

  leftInput.min = "0";
  leftInput.max = "100";
  topInput.min = "0";
  topInput.max = "100";

  leftInput.value = String(Math.round(currentMockup.left_pct * 100));
  topInput.value = String(Math.round(currentMockup.top_pct * 100));

  if (widthLabel) widthLabel.textContent = `${Math.round(widthInput.value)}%`;
  if (heightLabel) heightLabel.textContent = `${Math.round(heightInput.value)}%`;
  if (leftLabel) leftLabel.textContent = `${Math.round(leftInput.value)}%`;
  if (topLabel) topLabel.textContent = `${Math.round(topInput.value)}%`;
}

function setMockupConfig(cfg) {
  currentMockup = normalizeLocalConfig(cfg);
  syncMockupInputs();
  updateOverlayDisplay();
}

function handleRangeChange() {
  if (!widthInput || !heightInput || !leftInput || !topInput) return;
  const width = clamp(Number(widthInput.value) / 100, 0.05, 0.9, currentMockup.width_pct);
  const height = clamp(Number(heightInput.value) / 100, 0.05, 0.9, currentMockup.height_pct);
  const left = clamp(Number(leftInput.value) / 100, 0, 1, currentMockup.left_pct);
  const top = clamp(Number(topInput.value) / 100, 0, 1, currentMockup.top_pct);

  currentMockup = normalizeLocalConfig({ width_pct: width, height_pct: height, left_pct: left, top_pct: top });
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
      return `
        <tr
          data-id="${escapeAttr(p.id)}"
          data-name="${escapeAttr(p.name || "")}" 
          data-description="${escapeAttr(p.description || "")}" 
          data-price="${escapeAttr(p.price ?? 0)}" 
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
          <td class="price">${formatCurrency(p.price)}</td>
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
  const product = {
    id: tr.dataset.id,
    name: tr.dataset.name || "",
    description: tr.dataset.description || "",
    price: tr.dataset.price || "0",
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
  setPreviewFromUrl(null);
  if (form?.dataset) {
    form.dataset.originalImage = "";
  }
  setMockupConfig(DEFAULT_MOCKUP);
}

function openModal(product) {
  resetForm();
  if (form?.dataset) {
    form.dataset.originalImage = product?.image_url || "";
  }
  setMockupConfig(product?.mockup_config || DEFAULT_MOCKUP);
  if (product && product.id) {
    form.id.value = product.id;
    form.name.value = product.name || "";
    form.description.value = product.description || "";
    form.price.value = product.price ?? "";
    form.stock.value = product.stock ?? "";
    form.published.checked = !!product.published;
    setPreviewFromUrl(product.image_url);
    modalTitle.textContent = "Editar producto";
  } else {
    modalTitle.textContent = "Nuevo producto";
  }
  if (typeof modal?.showModal === "function") {
    modal.showModal();
  }
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
  if (!form?.reportValidity?.()) return;

  submitBtn.disabled = true;
  formMsg.textContent = "Guardando…";

  const id = form.id.value;
  const isEdit = Boolean(id);
  const formData = new FormData();
  formData.set("name", form.name.value.trim());
  formData.set("description", form.description.value.trim());
  formData.set("price", form.price.value);
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
  form?.addEventListener("submit", submitForm);
  modal?.addEventListener("close", resetForm);

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    updatePreview(file);
  });
  widthInput?.addEventListener("input", handleRangeChange);
  heightInput?.addEventListener("input", handleRangeChange);
  leftInput?.addEventListener("input", handleRangeChange);
  topInput?.addEventListener("input", handleRangeChange);

  setMockupConfig(DEFAULT_MOCKUP);
  await loadProducts();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
