// /public/js/auth-ui.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);

  const token = localStorage.getItem("token") || "";
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  const CART_KEY = "ludus_cart";
  const CART_KEY_PREFIX = `${CART_KEY}:user:`;
  const cartListeners = new Set();
  const cartUserId = getTokenUserId(token);
  const cartStorageKey = cartUserId ? `${CART_KEY_PREFIX}${cartUserId}` : null;
  let cartItems = loadCartItems();

  function getTokenUserId(rawToken) {
    if (!rawToken || !rawToken.includes(".")) return "";
    try {
      const payload = rawToken.split(".")[1] || "";
      const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
      const json = decodeURIComponent(
        Array.from(atob(padded), (char) =>
          `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`
        ).join("")
      );
      return String(JSON.parse(json)?.id || "");
    } catch {
      return "";
    }
  }

  function loadCartItems() {
    if (!cartStorageKey) return [];
    try {
      const scopedCart = localStorage.getItem(cartStorageKey);
      const legacyCart = localStorage.getItem(CART_KEY);
      const raw = JSON.parse(scopedCart || legacyCart || "[]");
      if (!Array.isArray(raw)) return [];
      const normalized = raw.map(normalizeCartItem).filter(Boolean);
      if (!scopedCart && legacyCart && normalized.length) {
        localStorage.setItem(cartStorageKey, JSON.stringify(normalized));
        localStorage.removeItem(CART_KEY);
      }
      return normalized;
    } catch {
      return [];
    }
  }

  function normalizeCartItem(entry) {
    if (!entry || typeof entry !== "object") return null;
    const designId = entry.design_id;
    const productId = entry.product_id;
    if (!designId || !productId) return null;
    const key = entry.key || `${designId}:${productId}`;
    const price = Number(entry.price) || 0;
    let quantity = Number.parseInt(entry.quantity, 10);
    if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;
    return {
      key,
      design_id: designId,
      design_title: entry.design_title || "",
      product_id: productId,
      product_name: entry.product_name || "",
      price,
      quantity,
      image_url: entry.image_url || ""
    };
  }

  function snapshotCart() {
    const items = cartItems.map((item) => ({ ...item }));
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    const total = items.reduce((sum, item) => sum + item.quantity * (item.price ?? 0), 0);
    return { items, count, total };
  }

  function cacheCart() {
    if (!cartStorageKey) {
      cartItems = [];
      notifyCart();
      return false;
    }
    try {
      localStorage.setItem(cartStorageKey, JSON.stringify(cartItems));
      localStorage.removeItem(CART_KEY);
    } catch (err) {
      console.error("No se pudo guardar el carrito", err);
    }
    notifyCart();
    return true;
  }

  function applyServerCart(data = {}) {
    cartItems = Array.isArray(data.items)
      ? data.items.map(normalizeCartItem).filter(Boolean)
      : [];
    return cacheCart();
  }

  async function requestCart(path, options = {}) {
    if (!cartStorageKey || !token) return false;
    const res = await fetch(api(path), {
      ...options,
      headers: {
        ...authHeaders(),
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      cache: "no-store"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) localStorage.removeItem("token");
      throw new Error(data?.error || "No se pudo sincronizar el carrito.");
    }
    applyServerCart(data);
    return true;
  }

  function notifyCart() {
    const data = snapshotCart();
    cartListeners.forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error("cart listener error", err);
      }
    });
  }

  const CartStore = {
    isAuthenticated: () => Boolean(cartStorageKey),
    getItems: () => snapshotCart().items,
    getCount: () => snapshotCart().count,
    getTotal: () => snapshotCart().total,
    async init() {
      if (!cartStorageKey || !token) {
        cartItems = [];
        notifyCart();
        return false;
      }
      const cachedItems = snapshotCart().items;
      await requestCart("/cart");
      const syncKey = `${cartStorageKey}:db-synced`;
      if (!localStorage.getItem(syncKey) && !CartStore.getItems().length && cachedItems.length) {
        for (const item of cachedItems) {
          await requestCart("/cart/items", {
            method: "POST",
            body: JSON.stringify({
              design_id: item.design_id,
              product_id: item.product_id,
              quantity: item.quantity
            })
          });
        }
      }
      try {
        localStorage.setItem(syncKey, "true");
      } catch {}
      return true;
    },
    async addItem(data = {}) {
      if (!cartStorageKey) return false;
      const normalized = normalizeCartItem({ ...data, quantity: data.quantity || 1 });
      if (!normalized) return false;
      return requestCart("/cart/items", {
        method: "POST",
        body: JSON.stringify({
          design_id: normalized.design_id,
          product_id: normalized.product_id,
          quantity: normalized.quantity
        })
      });
    },
    async updateQuantity(key, quantity) {
      if (!cartStorageKey) return false;
      const nextQty = Math.max(1, Number.parseInt(quantity, 10) || 1);
      return requestCart(`/cart/items/${encodeURIComponent(key)}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity: nextQty })
      });
    },
    async removeItem(key) {
      if (!cartStorageKey) return false;
      return requestCart(`/cart/items/${encodeURIComponent(key)}`, {
        method: "DELETE"
      });
    },
    async clear() {
      if (!cartStorageKey) return false;
      return requestCart("/cart", { method: "DELETE" });
    },
    subscribe(fn) {
      if (typeof fn !== "function") return () => {};
      cartListeners.add(fn);
      try {
        fn(snapshotCart());
      } catch {}
      return () => cartListeners.delete(fn);
    }
  };

  window.CartStore = CartStore;
  notifyCart();

  function renderHeader(me) {
    const nav = document.querySelector(".menu");
    if (!nav) return;
    ensureCartLink(nav);

    nav.querySelectorAll(".ui-slot").forEach((n) => n.remove());

    if (me) {
      if (me.role === "admin") {
        const admin = document.createElement("a");
        admin.href = "/admin/users.html";
        admin.className = "btn btn-primary ui-slot";
        admin.innerHTML = `<i class="fa-solid fa-gauge"></i> Panel admin`;
        nav.appendChild(admin);
      } else {
        const panel = document.createElement("a");
        panel.href = "/user-profile.html";
        panel.className = "btn btn-primary ui-slot";
        panel.innerHTML = `<i class="fa-solid fa-table-columns"></i> Panel de usuario`;
        nav.appendChild(panel);
      }

      const hola = document.createElement("span");
      hola.className = "ui-slot user-chip";
      hola.style.marginLeft = "0.75rem";
      hola.textContent = `Hola, ${me.username || me.name || me.email}`;
      nav.appendChild(hola);

      const out = document.createElement("a");
      out.href = "#";
      out.className = "btn ui-slot";
      out.style.marginLeft = "0.5rem";
      out.innerHTML = `<i class="fa-solid fa-right-from-bracket"></i> Salir`;
      out.addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.removeItem("token");
        location.href = "/";
      });
      nav.appendChild(out);
    } else {
      const a1 = document.createElement("a");
      a1.href = "/login.html";
      a1.className = "btn ui-slot";
      a1.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión`;
      nav.appendChild(a1);

      const a2 = document.createElement("a");
      a2.href = "/register.html";
      a2.className = "btn btn-primary ui-slot";
      a2.style.marginLeft = "0.5rem";
      a2.innerHTML = `<i class="fa-solid fa-user-plus"></i> Registrarse`;
      nav.appendChild(a2);
    }
  }

  function ensureCartLink(nav) {
    let cartLink = nav.querySelector(".nav-cart");
    if (!cartLink) {
      cartLink = document.createElement("a");
      cartLink.className = "nav-cart";
      cartLink.innerHTML = `
        <i class="fa-solid fa-cart-shopping"></i>
        <span class="cart-badge" hidden>0</span>
      `;
      nav.appendChild(cartLink);
    }
    cartLink.href = CartStore.isAuthenticated()
      ? "/cart.html"
      : "/login.html?next=%2Fcart.html";
    const badge = cartLink.querySelector(".cart-badge");
    const updateBadge = (count) => {
      if (!badge) return;
      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = false;
      } else {
        badge.hidden = true;
      }
    };
    updateBadge(CartStore.getCount());
    if (!cartLink.dataset.cartBound) {
      cartLink.dataset.cartBound = "true";
      CartStore.subscribe(({ count }) => updateBadge(count));
    }
  }


  function show403() {
    const main = document.querySelector("main") || document.body;
    main.innerHTML = `
      <section class="card" style="max-width:900px;margin:2rem auto;padding:1rem">
        <h1 style="margin-bottom:.5rem">Acceso denegado</h1>
        <p class="muted">Necesitas permisos de administrador para ver esta página.</p>
        <p style="margin-top:1rem">
          <a class="btn" href="/"><i class="fa-solid fa-house"></i> Volver al inicio</a>
        </p>
      </section>`;
  }

  async function getMe() {
    if (!token) return null;
    try {
      const res = await fetch(api("/auth/me"), {
        headers: { ...authHeaders(), "Accept": "application/json" },
        cache: "no-store"         // <- evita 304 / caché
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function getMyDesignCount() {
    if (!token) return 0;
    try {
      const res = await fetch(api("/designs/mine"), {
        headers: { ...authHeaders(), "Accept": "application/json" },
        cache: "no-store"
      });
      if (!res.ok) return 0;
      const data = await res.json();
      return Array.isArray(data) ? data.length : 0;
    } catch {
      return 0;
    }
  }

  async function getMyOrderCount() {
    if (!token) return 0;
    try {
      const res = await fetch(api("/orders/mine?limit=1"), {
        headers: { ...authHeaders(), "Accept": "application/json" },
        cache: "no-store"
      });
      if (!res.ok) return 0;
      const data = await res.json();
      return Number(data?.total || 0);
    } catch {
      return 0;
    }
  }

  async function renderUserPanelNav(me) {
    const navs = document.querySelectorAll(".admin-subnav");
    if (!me || !navs.length || me.role === "admin") return;

    const userPaths = new Set([
      "/user-profile.html",
      "/user-orders.html",
      "/upload.html",
      "/user-designs.html",
      "/designer-sales.html"
    ]);
    const panelNavs = [...navs].filter((nav) =>
      [...nav.querySelectorAll("a[href]")].some((a) => userPaths.has(new URL(a.href, location.origin).pathname))
    );
    if (!panelNavs.length) return;

    const [designCount, orderCount] = await Promise.all([
      getMyDesignCount(),
      getMyOrderCount()
    ]);
    const prefersDesigner = me.use_preference
      ? me.use_preference === "upload"
      : me.role === "designer";
    const hasDesignerTools = prefersDesigner || designCount > 0;
    const hasPurchases = orderCount > 0;
    const here = location.pathname.replace(/\/+$/, "");
    if (!hasDesignerTools && (here === "/user-designs.html" || here === "/designer-sales.html")) {
      location.replace("/user-profile.html");
      return;
    }
    if (prefersDesigner && !hasPurchases && here === "/user-orders.html") {
      location.replace("/user-profile.html");
      return;
    }

    const profileLink = { href: "/user-profile.html", icon: "fa-user-gear", text: "Mi perfil" };
    const ordersLink = { href: "/user-orders.html", icon: "fa-bag-shopping", text: "Mis compras" };
    const uploadLink = { href: "/upload.html", icon: "fa-cloud-arrow-up", text: "Subir dise&ntilde;o" };
    const designsLink = { href: "/user-designs.html", icon: "fa-rectangle-list", text: "Mis dise&ntilde;os" };
    const salesLink = { href: "/designer-sales.html", icon: "fa-chart-line", text: "Mis ventas" };

    const links = prefersDesigner
      ? [
          profileLink,
          uploadLink,
          ...(hasDesignerTools ? [designsLink, salesLink] : []),
          ...(hasPurchases ? [ordersLink] : [])
        ]
      : [
          profileLink,
          ordersLink,
          uploadLink,
          ...(hasDesignerTools ? [designsLink, salesLink] : [])
        ];

    panelNavs.forEach((nav) => {
      nav.innerHTML = links
        .map((link) => {
          const active = here === link.href ? " active" : "";
          return `<a href="${link.href}" class="tab${active}"><i class="fa-solid ${link.icon}"></i> ${link.text}</a>`;
        })
        .join("");
    });
  }

  async function boot() {
    const me = await getMe();
    if (me) {
      await CartStore.init().catch((err) => console.error("cart init error", err));
    } else {
      cartItems = [];
      notifyCart();
    }
    renderHeader(me);
    await renderUserPanelNav(me);

    // Reglas para /admin
    const isAdminPage = location.pathname.startsWith("/admin/");
    if (isAdminPage) {
      if (!me) {
        // no logueado -> ir a login con retorno
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/login.html?next=${next}`;
        return;
      }
      if (me.role !== "admin") {
        // logueado sin rol -> mostrar 403, NO redirigir al home
        show403();
        return;
      }
    }
  }

  async function refreshUserPanelNav() {
    const me = await getMe();
    await renderUserPanelNav(me);
  }

  window.LudusAuthUI = {
    ...(window.LudusAuthUI || {}),
    refreshUserPanelNav
  };
  window.addEventListener("ludus:user-preference-updated", refreshUserPanelNav);
  window.addEventListener("ludus:user-panel-nav-refresh", refreshUserPanelNav);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const chk = document.querySelector('#accept_terms');
    const submit = document.querySelector('#registerForm button[type="submit"]');
    if (chk && submit) {
      submit.disabled = !chk.checked;
      chk.addEventListener('change', () => submit.disabled = !chk.checked);
    }
  });

})();
