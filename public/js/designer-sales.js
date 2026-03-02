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

  const state = {
    page: 1,
    limit: 10,
    total: 0
  };

  const controls = {
    rows: $("#rows"),
    resultInfo: $("#resultInfo"),
    pageInfo: $("#pageInfo"),
    prev: $("#prev"),
    next: $("#next"),
    fLimit: $("#fLimit")
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
    controls.rows.innerHTML = `<tr><td colspan="6">Cargando…</td></tr>`;
    try {
      const params = new URLSearchParams({
        page: state.page,
        limit: state.limit
      });
      const res = await fetch(api(`/designers/me/sales?${params.toString()}`), {
        headers: { ...auth(), Accept: "application/json" },
        cache: "no-store"
      });
      if (!res.ok) throw new Error("No se pudieron cargar las ventas.");
      const data = await res.json();
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

      if (!data.items?.length) {
        controls.rows.innerHTML = `<tr><td colspan="6">Aún no registraste ventas.</td></tr>`;
        return;
      }

      controls.rows.innerHTML = data.items
        .map((item) => {
          const total = currency.format(item.line_total || 0);
          const unit = currency.format(item.unit_price || 0);
          return `
            <tr>
              <td>${formatDate(item.created_at)}</td>
              <td>${escapeHtml(item.order_number)}</td>
              <td>
                <div style="font-weight:600">${escapeHtml(item.product_name)}</div>
                <div class="muted-sm">${escapeHtml(item.design_title)}</div>
              </td>
              <td>${item.quantity} <span class="muted-sm">(${unit} c/u)</span></td>
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
      controls.rows.innerHTML = `<tr><td colspan="6">${err.message}</td></tr>`;
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
