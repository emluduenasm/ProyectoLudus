// /public/js/auth-ui.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);

  const token = localStorage.getItem("token") || "";
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  const CART_KEY = "ludus_cart";
  const cartListeners = new Set();
  let cartItems = loadCartItems();

  function loadCartItems() {
    try {
      const raw = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.map(normalizeCartItem).filter(Boolean);
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

  function persistCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    } catch (err) {
      console.error("No se pudo guardar el carrito", err);
    }
    notifyCart();
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
    getItems: () => snapshotCart().items,
    getCount: () => snapshotCart().count,
    getTotal: () => snapshotCart().total,
    addItem(data = {}) {
      const normalized = normalizeCartItem({ ...data, quantity: data.quantity || 1 });
      if (!normalized) return;
      const idx = cartItems.findIndex((item) => item.key === normalized.key);
      if (idx >= 0) {
        cartItems[idx].quantity += normalized.quantity;
      } else {
        cartItems.push(normalized);
      }
      persistCart();
    },
    updateQuantity(key, quantity) {
      const idx = cartItems.findIndex((item) => item.key === key);
      if (idx === -1) return;
      const nextQty = Math.max(1, Number.parseInt(quantity, 10) || 1);
      cartItems[idx].quantity = nextQty;
      persistCart();
    },
    removeItem(key) {
      const next = cartItems.filter((item) => item.key !== key);
      if (next.length === cartItems.length) return;
      cartItems = next;
      persistCart();
    },
    clear() {
      cartItems = [];
      persistCart();
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
        panel.href = "/user-designs.html";
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
      cartLink.href = "/cart.html";
      cartLink.className = "nav-cart";
      cartLink.innerHTML = `
        <i class="fa-solid fa-cart-shopping"></i>
        <span class="cart-badge" hidden>0</span>
      `;
      nav.appendChild(cartLink);
    }
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

  async function boot() {
    const me = await getMe();
    renderHeader(me);

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
