(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);
  const token = localStorage.getItem("token") || "";
  const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});

  const rowsEl = $("#rows");
  const resultInfo = $("#resultInfo");
  const totalProducts = $("#totalProducts");
  const currency = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0
  });

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function redirectLogin() {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
  }

  function commissionLabel(item) {
    if (item.commission_type === "fixed") {
      return `${currency.format(item.commission_value || 0)} fijo`;
    }
    return `${Number(item.commission_value || 0)}%`;
  }

  function hasDesignerTools(profile = {}) {
    const user = profile.user || {};
    const designer = profile.designer || {};
    return (
      user.role === "designer" ||
      user.use_preference === "upload" ||
      Number(designer.stats?.designs || 0) > 0
    );
  }

  function hasPayoutData(profile = {}) {
    const designer = profile.designer || {};
    return Boolean(String(designer.payout_alias || "").trim() || String(designer.payout_cbu || "").trim());
  }

  function renderPayoutBanner(profile) {
    const main = document.querySelector("main");
    if (!main || !hasDesignerTools(profile) || hasPayoutData(profile)) return;
    if (main.querySelector("#payoutAlert")) return;
    const nav = main.querySelector(".admin-subnav");
    const html = `
      <section id="payoutAlert" class="card" style="padding:1rem;margin:1rem 0;border-left:4px solid #f59e0b">
        <div style="display:flex;gap:1rem;align-items:center;justify-content:space-between;flex-wrap:wrap">
          <div>
            <strong>Datos de cobro pendientes</strong>
            <p class="muted-sm" style="margin:.25rem 0 0">Para poder cobrar comisiones por tus dise&ntilde;os, carg&aacute; un alias o CBU/CVU.</p>
          </div>
          <a class="btn btn-primary" href="/user-profile.html#payoutSection"><i class="fa-solid fa-wallet"></i> Completar datos de cobro</a>
        </div>
      </section>`;
    if (nav) nav.insertAdjacentHTML("afterend", html);
    else main.insertAdjacentHTML("afterbegin", html);
  }

  function render(items = []) {
    if (totalProducts) totalProducts.textContent = String(items.length);
    if (resultInfo) resultInfo.textContent = `${items.length} producto(s)`;

    if (!items.length) {
      rowsEl.innerHTML = `<tr><td colspan="4">No hay productos publicados con comisión configurada.</td></tr>`;
      return;
    }

    rowsEl.innerHTML = items
      .map(
        (item) => `
          <tr>
            <td>
              <div class="product-name">${escapeHtml(item.name || "Producto")}</div>
            </td>
            <td><span class="money">${currency.format(item.base_price || 0)}</span></td>
            <td>
              <span class="money">${currency.format(item.commission_amount || 0)}</span>
              <div class="muted-sm">${escapeHtml(commissionLabel(item))}</div>
            </td>
            <td><span class="money">${currency.format(item.price || 0)}</span></td>
          </tr>
        `
      )
      .join("");
  }

  async function guardAccess() {
    if (!token) {
      redirectLogin();
      return null;
    }
    const res = await fetch(api("/designers/me"), {
      headers: { ...auth(), Accept: "application/json" },
      cache: "no-store"
    });
    if (!res.ok) {
      redirectLogin();
      return null;
    }
    const profile = await res.json();
    if (!hasDesignerTools(profile)) {
      location.replace("/user-profile.html");
      return null;
    }
    return profile;
  }

  async function load() {
    if (!rowsEl) return;
    try {
      const profile = await guardAccess();
      if (!profile) return;
      renderPayoutBanner(profile);
      rowsEl.innerHTML = `<tr><td colspan="4">Cargando...</td></tr>`;
      const res = await fetch(api("/designers/me/commissions"), {
        headers: { ...auth(), Accept: "application/json" },
        cache: "no-store"
      });
      if (res.status === 401) {
        redirectLogin();
        return;
      }
      if (!res.ok) throw new Error("No se pudieron cargar las comisiones.");
      const data = await res.json();
      render(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      rowsEl.innerHTML = `<tr><td colspan="4">${escapeHtml(err.message || "Error al cargar comisiones.")}</td></tr>`;
      if (totalProducts) totalProducts.textContent = "0";
      if (resultInfo) resultInfo.textContent = "";
    }
  }

  load();
})();
