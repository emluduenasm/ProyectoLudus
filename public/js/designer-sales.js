// /public/js/designer-sales.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);
  const token = localStorage.getItem("token") || "";
  const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});

  const currency = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS"
  });
  const STATUS_LABELS = {
    pending: { label: "Pendiente", className: "pending" },
    completed: { label: "Completado", className: "completed" },
    cancelled: { label: "Cancelado", className: "cancelled" }
  };

  const state = {
    page: 1,
    limit: 10,
    total: 0,
    productId: "",
    from: "",
    to: "",
    requestToken: 0
  };

  const controls = {
    rows: $("#rows"),
    resultInfo: $("#resultInfo"),
    pageInfo: $("#pageInfo"),
    prev: $("#prev"),
    next: $("#next"),
    fLimit: $("#fLimit"),
    fProduct: $("#fProduct"),
    fFrom: $("#fFrom"),
    fTo: $("#fTo"),
    btnFiltersClear: $("#btnFiltersClear"),
    totalAmount: $("#totalAmount")
  };

  async function guardDesigner() {
    if (!token) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return false;
    }
    try {
      const res = await fetch(api("/auth/me"), {
        headers: { ...auth(), Accept: "application/json" },
        cache: "no-store"
      });
      if (!res.ok) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/login.html?next=${next}`;
        return false;
      }
      const me = await res.json();
      if (me.role !== "designer") {
        document.querySelector("main").innerHTML = `
          <section class="card" style="padding:1.5rem">
            <h2>No sos diseñador</h2>
            <p class="muted-sm">Para acceder a esta sección necesitás una cuenta de diseñador.</p>
          </section>`;
        return false;
      }
      return true;
    } catch {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return false;
    }
  }

  async function loadSales() {
    if (!controls.rows) return;
    const requestToken = ++state.requestToken;
    controls.rows.innerHTML = `<tr><td colspan="7">Cargando…</td></tr>`;
    try {
      const params = new URLSearchParams({
        page: state.page,
        limit: state.limit
      });
      if (state.productId) params.set("product_id", state.productId);
      if (state.from) params.set("from", state.from);
      if (state.to) params.set("to", state.to);
      const res = await fetch(api(`/designers/me/sales?${params.toString()}`), {
        headers: { ...auth(), Accept: "application/json" },
        cache: "no-store"
      });
      if (!res.ok) throw new Error("No se pudieron cargar las ventas.");
      const data = await res.json();
      if (requestToken !== state.requestToken) return;

      state.total = data.total || 0;
      if (controls.resultInfo) {
        controls.resultInfo.textContent = `${state.total} registro(s)`;
      }
      if (controls.pageInfo) {
        const totalPages = state.total ? Math.ceil(state.total / state.limit) : 1;
        controls.pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
      }
      controls.prev.disabled = state.page <= 1;
      controls.next.disabled = state.page * state.limit >= state.total;

      if (Array.isArray(data.products) && data.products.length) {
        renderProductOptions(data.products);
      } else if (Array.isArray(data.items)) {
        const fallbackProducts = buildProductListFromItems(data.items);
        renderProductOptions(fallbackProducts);
      }
      const totalAmountValue =
        typeof data.total_amount === "number" && !Number.isNaN(data.total_amount)
          ? data.total_amount
          : sumLineTotals(data.items || []);
      if (controls.totalAmount) {
        controls.totalAmount.textContent = currency.format(totalAmountValue);
      }
      syncFilterInputs();

      if (!data.items?.length) {
        controls.rows.innerHTML = `<tr><td colspan="7">Aún no registraste ventas.</td></tr>`;
        return;
      }

      controls.rows.innerHTML = data.items
        .map((item) => {
          const total = currency.format(item.line_total || 0);
          const unit = currency.format(item.unit_price || 0);
          const statusInfo = STATUS_LABELS[item.status] || STATUS_LABELS.pending;
          return `
            <tr>
              <td>${formatDate(item.created_at)}</td>
              <td>${escapeHtml(item.order_number)}</td>
              <td>
                <div style="font-weight:600">${escapeHtml(item.product_name)}</div>
                <div class="muted-sm">${escapeHtml(item.design_title)}</div>
              </td>
              <td>${item.quantity} <span class="muted-sm">(${unit} c/u)</span></td>
              <td>
                <span class="status-pill ${statusInfo.className}">
                  ${statusInfo.label}
                </span>
              </td>
              <td>${total}</td>
              <td>
                <div style="font-weight:600">${escapeHtml(item.buyer?.name || "")}</div>
                <div class="muted-sm">${escapeHtml(item.buyer?.email || "")}</div>
              </td>
            </tr>
          `;
        })
        .join("");
    } catch (err) {
      if (requestToken !== state.requestToken) return;
      controls.rows.innerHTML = `<tr><td colspan="7">${err.message}</td></tr>`;
      if (controls.totalAmount) controls.totalAmount.textContent = currency.format(0);
    }
  }

  function renderProductOptions(products = []) {
    const select = controls.fProduct;
    if (!select) return;
    const current = state.productId;
    const options =
      `<option value="">Todos</option>` +
      products
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}"${p.id === current ? " selected" : ""}>${escapeHtml(p.name || "Producto")}</option>`
        )
        .join("");
    select.innerHTML = options;
    select.value = current || "";
  }

  function buildProductListFromItems(items) {
    const map = new Map();
    for (const item of items) {
      if (!item?.product_id) continue;
      if (!map.has(item.product_id)) {
        map.set(item.product_id, {
          id: item.product_id,
          name: item.product_name || "Producto"
        });
      }
    }
    return Array.from(map.values());
  }

  function sumLineTotals(items) {
    return items.reduce((acc, item) => acc + Number(item?.line_total || 0), 0);
  }

  function syncFilterInputs() {
    if (controls.fProduct) controls.fProduct.value = state.productId || "";
    if (controls.fFrom) controls.fFrom.value = state.from || "";
    if (controls.fTo) controls.fTo.value = state.to || "";
  }

  function formatDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("es-AR");
    } catch {
      return iso;
    }
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function bindEvents() {
    controls.prev?.addEventListener("click", () => {
      if (state.page > 1) {
        state.page -= 1;
        loadSales();
      }
    });
    controls.next?.addEventListener("click", () => {
      if (state.page * state.limit < state.total) {
        state.page += 1;
        loadSales();
      }
    });
    controls.fLimit?.addEventListener("change", () => {
      state.limit = Number(controls.fLimit.value) || 10;
      state.page = 1;
      loadSales();
    });
    controls.fProduct?.addEventListener("change", () => {
      state.productId = controls.fProduct.value;
      state.page = 1;
      loadSales();
    });
    const handleDateChange = () => {
      state.from = controls.fFrom?.value || "";
      state.to = controls.fTo?.value || "";
      state.page = 1;
      loadSales();
    };
    controls.fFrom?.addEventListener("change", handleDateChange);
    controls.fTo?.addEventListener("change", handleDateChange);
    controls.btnFiltersClear?.addEventListener("click", () => {
      state.productId = "";
      state.from = "";
      state.to = "";
      state.page = 1;
      syncFilterInputs();
      loadSales();
    });
  }

  async function init() {
    if (!(await guardDesigner())) return;
    bindEvents();
    loadSales();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
