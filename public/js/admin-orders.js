// /public/js/admin-orders.js
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
      document.querySelector("main").innerHTML = `
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
  status: "",
  q: ""
};

const controls = {
  rows: $("#rows"),
  q: $("#q"),
  btnSearch: $("#btnSearch"),
  btnClear: $("#btnClear"),
  pageInfo: $("#pageInfo"),
  resultInfo: $("#resultInfo"),
  prev: $("#prev"),
  next: $("#next"),
  fStatus: $("#fStatus"),
  fLimit: $("#fLimit"),
  modal: $("#modal"),
  modalTitle: $("#modalTitle"),
  modalMeta: $("#modalMeta"),
  modalItems: $("#modalItems"),
  btnModalClose: $("#btnModalClose")
};

const currency = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS"
});

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleString("es-AR") : "";

async function loadOrders() {
  controls.rows.innerHTML = `<tr><td colspan="7">Cargando…</td></tr>`;
  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit
  });
  if (state.status) params.set("status", state.status);
  if (state.q) params.set("q", state.q);

  try {
    const res = await fetch(api(`/admin/orders?${params.toString()}`), {
      headers: { ...auth(), Accept: "application/json" },
      cache: "no-store"
    });
    if (!res.ok) throw new Error("No se pudo obtener la lista.");
    const data = await res.json();
    controls.resultInfo.textContent = `${data.total} pedido(s)`;
    controls.pageInfo.textContent = `Página ${state.page}`;
    controls.prev.disabled = state.page <= 1;
    controls.next.disabled = state.page * state.limit >= data.total;
    if (!data.items.length) {
      controls.rows.innerHTML = `<tr><td colspan="7">No hay resultados.</td></tr>`;
      return;
    }
    controls.rows.innerHTML = data.items
      .map((order) => {
        const badge = `<span class="status-pill ${order.status}">${order.status}</span>`;
        return `
          <tr data-id="${order.id}">
            <td>${order.order_number}</td>
            <td>
              <div style="font-weight:600">${escapeHtml(order.buyer.name || "Cliente")}</div>
              <div class="muted-sm">${escapeHtml(order.buyer.email || "")}</div>
            </td>
            <td>${order.lines} ítem(s)<br/><span class="muted-sm">${order.total_quantity} unidad(es)</span></td>
            <td>${currency.format(order.total_amount || 0)}</td>
            <td>${badge}</td>
            <td>${formatDate(order.created_at)}</td>
            <td class="actions">
              <button class="btn" data-action="detail"><i class="fa-solid fa-eye"></i> Ver</button>
            </td>
          </tr>
        `;
      })
      .join("");
    controls.rows
      .querySelectorAll("button[data-action='detail']")
      .forEach((btn) => btn.addEventListener("click", handleViewDetail));
  } catch (error) {
    controls.rows.innerHTML = `<tr><td colspan="7">${error.message}</td></tr>`;
  }
}

async function handleViewDetail(ev) {
  const tr = ev.currentTarget.closest("tr");
  if (!tr) return;
  const id = tr.dataset.id;
  if (!id) return;
  try {
    const res = await fetch(api(`/admin/orders/${id}`), {
      headers: { ...auth(), Accept: "application/json" },
      cache: "no-store"
    });
    if (!res.ok) throw new Error("No se pudo cargar el pedido.");
    const order = await res.json();
    renderModal(order);
  } catch (error) {
    alert(error.message);
  }
}

function renderModal(order) {
  const total = currency.format(order.total_amount || 0);
  controls.modalTitle.textContent = `Pedido ${order.order_number}`;
  controls.modalMeta.textContent = `Cliente: ${order.user_name} · ${order.email} · ${formatDate(order.created_at)} · Estado: ${order.status}`;
  controls.modalItems.innerHTML = `
    <div class="muted-sm" style="margin-bottom:.5rem">Total: <strong>${total}</strong></div>
    <ul class="detail-list">
      ${order.items
        .map(
          (item) => `
        <li class="detail-item">
          <h4>${escapeHtml(item.product_name)}</h4>
          <div class="detail-meta">${escapeHtml(item.design_title)} · Diseñador: ${escapeHtml(
            item.designer_name || item.designer_email || ""
          )}</div>
          <div>Cantidad: <strong>${item.quantity}</strong></div>
          <div>Precio unitario: ${currency.format(item.unit_price || 0)}</div>
          <div>Total: ${currency.format((item.unit_price || 0) * item.quantity)}</div>
        </li>`
        )
        .join("")}
    </ul>
  `;
  controls.modal.showModal();
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function init() {
  if (!(await guardAdmin())) return;
  loadOrders();
  controls.btnSearch?.addEventListener("click", () => {
    state.q = controls.q.value.trim();
    state.page = 1;
    loadOrders();
  });
  controls.q?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      state.q = controls.q.value.trim();
      state.page = 1;
      loadOrders();
    }
  });
  controls.btnClear?.addEventListener("click", () => {
    controls.q.value = "";
    state.q = "";
    controls.fStatus.value = "";
    controls.fLimit.value = "10";
    state.status = "";
    state.limit = 10;
    state.page = 1;
    loadOrders();
  });
  controls.fStatus?.addEventListener("change", () => {
    state.status = controls.fStatus.value;
    state.page = 1;
    loadOrders();
  });
  controls.fLimit?.addEventListener("change", () => {
    state.limit = Number(controls.fLimit.value) || 10;
    state.page = 1;
    loadOrders();
  });
  controls.prev?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      loadOrders();
    }
  });
  controls.next?.addEventListener("click", () => {
    state.page += 1;
    loadOrders();
  });
  controls.btnModalClose?.addEventListener("click", () => controls.modal.close());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
