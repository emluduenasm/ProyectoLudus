// /public/js/cart-page.js
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const cartStore = window.CartStore;
  if (!cartStore) return;

  const list = $("#cartList");
  const empty = document.querySelector(".cart-empty");
  const totalEl = $("#cartTotal");
  const btnClear = $("#btnClear");
  const btnCheckout = $("#btnCheckout");
  const msgEl = $("#cartMsg");
  const token = localStorage.getItem("token") || "";

  if (!list || !empty || !totalEl) return;

  let unsubscribe = null;

  function formatCurrency(value) {
    return new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS"
    }).format(Number(value ?? 0));
  }

  function render({ items, total }) {
    if (!items.length) {
      empty.style.display = "block";
      list.innerHTML = "";
      btnCheckout.disabled = true;
      totalEl.textContent = formatCurrency(0);
      return;
    }

    empty.style.display = "none";
    btnCheckout.disabled = false;
    totalEl.textContent = formatCurrency(total);
    list.innerHTML = items
      .map((item) => {
        const product = escapeHtml(item.product_name || "Producto");
        const design = escapeHtml(item.design_title || "");
        const img = escapeHtml(item.image_url || "/img/logo.png");
        const unit = formatCurrency(item.price ?? 0);
        const itemTotal = formatCurrency((item.price ?? 0) * item.quantity);
        return `
          <div class="cart-item" data-key="${escapeHtml(item.key)}">
            <img class="cart-thumb" src="${img}" alt="${product}" />
            <div>
              <h3>${product}</h3>
              <div class="cart-meta">${design}</div>
              <div class="cart-price">${unit} c/u</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.4rem">
              <div class="cart-qty">
                <button type="button" data-action="dec" aria-label="Disminuir cantidad">−</button>
                <span>${item.quantity}</span>
                <button type="button" data-action="inc" aria-label="Aumentar cantidad">+</button>
              </div>
              <div class="cart-total">${itemTotal}</div>
              <button class="cart-item-remove" data-action="remove">Quitar</button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function escapeHtml(value = "") {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  list.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;
    const itemEl = btn.closest(".cart-item");
    if (!itemEl) return;
    const key = itemEl.dataset.key;
    if (!key) return;
    const action = btn.dataset.action;
    if (action === "inc") {
      adjustQuantity(key, 1);
    } else if (action === "dec") {
      adjustQuantity(key, -1);
    } else if (action === "remove") {
      cartStore.removeItem(key);
    }
  });

  btnClear?.addEventListener("click", () => {
    if (!cartStore.getItems().length) return;
    if (confirm("¿Vaciar carrito?")) {
      cartStore.clear();
    }
  });

  btnCheckout?.addEventListener("click", async () => {
    if (!cartStore.getItems().length) return;
    if (!token) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return;
    }
    setMessage("");
    btnCheckout.disabled = true;
    btnCheckout.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Procesando…`;
    try {
      const payload = {
        items: cartStore.getItems().map((item) => ({
          design_id: item.design_id,
          product_id: item.product_id,
          quantity: item.quantity
        }))
      };
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload),
        cache: "no-store"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = [data?.error, data?.detail].filter(Boolean).join(" — ");
        throw new Error(message || "No se pudo crear el pedido.");
      }
      cartStore.clear();
      setMessage(
        `Pedido #${data?.order?.order_number || "-"} registrado correctamente. Te contactaremos para el pago.`
      );
    } catch (err) {
      console.error(err);
      setMessage(err.message || "Ocurrió un error al finalizar la compra.", true);
    } finally {
      btnCheckout.disabled = false;
      btnCheckout.innerHTML = `Finalizar compra`;
    }
  });

  function adjustQuantity(key, delta) {
    const item = cartStore.getItems().find((it) => it.key === key);
    if (!item) return;
    const next = Math.max(1, item.quantity + delta);
    cartStore.updateQuantity(key, next);
  }

  unsubscribe = cartStore.subscribe(render);

  window.addEventListener("beforeunload", () => {
    unsubscribe?.();
  });

  function setMessage(text, isError = false) {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.color = isError ? "#dc2626" : "#64748b";
  }
})();
