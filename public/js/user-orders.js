// /public/js/user-orders.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);
  const token = localStorage.getItem("token") || "";
  const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});
  const currency = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS"
  });

  const state = { page: 1, limit: 10, total: 0 };
  const controls = {
    rows: $("#rows"),
    resultInfo: $("#resultInfo"),
    pageInfo: $("#pageInfo"),
    prev: $("#prev"),
    next: $("#next"),
    fLimit: $("#fLimit")
  };

  async function guardUser() {
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
      if (!res.ok) throw new Error();
      return true;
    } catch {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return false;
    }
  }

  async function loadOrders() {
    controls.rows.innerHTML = `<tr><td colspan="5">Cargando…</td></tr>`;
    try {
      const params = new URLSearchParams({
        page: state.page,
        limit: state.limit
      });
      const res = await fetch(api(`/orders/mine?${params.toString()}`), {
        headers: { ...auth(), Accept: "application/json" },
        cache: "no-store"
      });
      if (!res.ok) throw new Error("No se pudieron cargar tus compras.");
      const data = await res.json();
      state.total = data.total || 0;
      controls.resultInfo.textContent = `${state.total} pedido(s)`;
      const totalPages = state.total ? Math.ceil(state.total / state.limit) : 1;
      controls.pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
      controls.prev.disabled = state.page <= 1;
      controls.next.disabled = state.page * state.limit >= state.total;

      if (!data.items?.length) {
        controls.rows.innerHTML = `<tr><td colspan="5">Aún no realizaste compras.</td></tr>`;
        return;
      }

      controls.rows.innerHTML = data.items
        .map((order) => {
          const badge = `<span class="status-pill ${order.status}">${order.status}</span>`;
          const itemsList = (order.items || [])
            .map(
              (item) =>
                `<li>${escapeHtml(item.product_name)} · ${escapeHtml(
                  item.design_title
                )} · ${item.quantity} u. (${currency.format(item.line_total || 0)})</li>`
            )
            .join("");
          return `
            <tr>
              <td><strong>${escapeHtml(order.order_number)}</strong></td>
              <td>${formatDate(order.created_at)}</td>
              <td>${badge}</td>
              <td>
                <ul class="order-items">${itemsList}</ul>
              </td>
              <td>${currency.format(order.total_amount || 0)}</td>
            </tr>
          `;
        })
        .join("");
    } catch (err) {
      controls.rows.innerHTML = `<tr><td colspan="5">${err.message}</td></tr>`;
    }
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
        loadOrders();
      }
    });
    controls.next?.addEventListener("click", () => {
      if (state.page * state.limit < state.total) {
        state.page += 1;
        loadOrders();
      }
    });
    controls.fLimit?.addEventListener("change", () => {
      state.limit = Number(controls.fLimit.value) || 10;
      state.page = 1;
      loadOrders();
    });
  }

  async function init() {
    if (!(await guardUser())) return;
    bindEvents();
    loadOrders();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
