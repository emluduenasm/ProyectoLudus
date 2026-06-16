// /public/js/design.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);
  const formatCurrency = (value) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(
      Number(value ?? 0)
    );
  const escapeHtml = (value = "") =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const qs = new URLSearchParams(location.search);
  const id = qs.get("id");
  const token = localStorage.getItem("token") || "";
  const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});
  const wrap = $("#detail");
  const backBtn = $("#btnBack");
  const cartStore = window.CartStore || null;

  setupBackButton();

  if (!wrap) return;

  if (!id) {
    wrap.innerHTML = `<div class="card" style="grid-column:1/-1">ID de diseño inválido.</div>`;
    return;
  }

  async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, { ...opts, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function getMe() {
    if (!token) return null;
    try {
      const res = await fetch(api("/auth/me"), {
        headers: { ...auth(), Accept: "application/json" },
        cache: "no-store"
      });
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  }

  function setupBackButton() {
    if (!backBtn) return;

    let target = "/designs.html";
    const returnTo = qs.get("returnTo");

    if (returnTo) {
      try {
        const url = new URL(returnTo, location.origin);
        if (url.origin === location.origin && url.pathname !== "/design.html") {
          target = `${url.pathname}${url.search}${url.hash}`;
        }
      } catch {}
    } else if (document.referrer) {
      try {
        const ref = new URL(document.referrer);
        if (ref.origin === location.origin && ref.pathname !== "/design.html") {
          target = `${ref.pathname}${ref.search}${ref.hash}`;
        }
      } catch {}
    }

    backBtn.href = target;
    backBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      location.href = target;
    });
  }

  function render(d, liked = false, me = null) {
    const esc = (value) => escapeHtml(value);
    const mockups = Array.isArray(d.mockups) ? d.mockups : [];
    const mockupCards = mockups
      .map(
        (m) => `
        <div class="media-card media-card--product">
          <button class="mockup-zoom-trigger"
                  type="button"
                  aria-label="Ver mockup en grande"
                  data-mockup-zoom="${esc(m.image_url || "")}"
                  data-mockup-alt="Mockup ${esc(m.product_name || "producto")}">
            <img src="${m.image_url}" alt="Mockup ${esc(m.product_name || "producto")}" />
          </button>
          <div class="media-card-body">
            <h3>${esc(m.product_name || "Mockup")}</h3>
            ${
              typeof m.price === "number"
                ? `<p class="media-price">${formatCurrency(m.price)}</p>`
                : ""
            }
            <button class="btn btn-primary media-cart-btn"
                    data-product-id="${esc(m.product_id)}"
                    data-product-name="${esc(m.product_name || "Mockup")}"
                    data-product-price="${typeof m.price === "number" ? Number(m.price) : ""}"
                    data-product-image="${esc(m.image_url || "")}">
              <i class="fa-solid fa-cart-plus"></i> Agregar al carrito
            </button>
          </div>
        </div>`
      )
      .join("");

    const hasMockups = Boolean(mockups.length);
    const fallbackMockup =
      !hasMockups && d.mockup_remera
        ? `<div class="media-card media-card--product">
             <button class="mockup-zoom-trigger"
                     type="button"
                     aria-label="Ver mockup en grande"
                     data-mockup-zoom="${esc(d.mockup_remera || "")}"
                     data-mockup-alt="Mockup remera de ${esc(d.title)}">
               <img src="${d.mockup_remera}" alt="Mockup remera de ${esc(d.title)}" />
             </button>
             <div class="media-card-body">
               <h3>Mockup remera</h3>
               <button class="btn btn-primary media-cart-btn" disabled title="Disponible pronto">
                 <i class="fa-solid fa-cart-plus"></i> Agregar al carrito
               </button>
             </div>
           </div>`
        : "";

    wrap.innerHTML = `
      <article class="detail-hero">
        <div class="hero-image">
          <button class="mockup-zoom-trigger"
                  type="button"
                  aria-label="Ver diseño en grande"
                  data-mockup-zoom="${esc(d.image_url || "")}"
                  data-mockup-alt="${esc(d.title)}">
            <img src="${d.image_url}" alt="${esc(d.title)}" />
          </button>
        </div>
        <div class="hero-meta">
          <div>
            <h1 class="hero-title">${esc(d.title)}</h1>
            <div class="hero-author-line">
              por <strong>${esc(d.designer_name || "anónimo")}</strong>
              ${d.category_name ? `<span class="badge">${esc(d.category_name)}</span>` : ""}
            </div>
          </div>
          <div class="hero-actions">
            <div class="hero-likes">
              <button id="btnLike" class="btn btn-like ${liked ? "liked" : ""}">
                <i class="fa-solid fa-heart"></i>
                <span id="likeText">${liked ? "Te gusta" : "Me gusta"}</span>
              </button>
              <span id="likeCount" class="hero-like-count">${d.likes ?? 0}</span>
            </div>
            ${
              me?.role === "admin"
                ? `
              <button id="btnDownload" class="btn">
                <i class="fa-solid fa-download"></i> Descargar diseño
              </button>
            `
                : ""
            }
          </div>
          <div class="hero-description-block">
            <h3 class="hero-description-title">Descripción</h3>
            <p id="desc" class="hero-description-text">
              ${d.description ? esc(d.description) : "Este diseño aún no tiene descripción."}
            </p>
          </div>
          <p class="hero-published">
            Publicado: ${new Date(d.created_at).toLocaleDateString("es-AR")}
          </p>
        </div>
      </article>

      <div class="detail-media">
        ${hasMockups ? mockupCards : fallbackMockup}
      </div>
      <div id="mockupModal" class="mockup-modal" role="dialog" aria-modal="true" aria-label="Vista ampliada de mockup">
        <div class="mockup-modal-content">
          <button id="mockupModalClose" class="mockup-modal-close" type="button" aria-label="Cerrar vista ampliada">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <img id="mockupModalImage" src="" alt="Mockup ampliado" />
        </div>
      </div>
    `;

    attachCartButtons(d);
    attachMockupZoom();

    $("#btnLike")?.addEventListener("click", async () => {
      if (!token) {
        location.href = `/login.html?next=${encodeURIComponent(
          location.pathname + location.search
        )}`;
        return;
      }
      try {
        const r = await fetchJSON(api(`/designs/${id}/like`), {
          method: "POST",
          headers: { ...auth() }
        });
        $("#btnLike").classList.toggle("liked", r.liked);
        $("#likeText").textContent = r.liked ? "Te gusta" : "Me gusta";
        $("#likeCount").textContent = r.likes;
      } catch (e) {
        console.error(e);
        alert("No se pudo actualizar tu me gusta.");
      }
    });

    if (me?.role === "admin") {
      $("#btnDownload")?.addEventListener("click", async () => {
        try {
          const res = await fetch(d.image_url, {
            credentials: "same-origin",
            cache: "no-store"
          });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const blob = await res.blob();
          const a = document.createElement("a");
          const ext = (d.image_url.split(".").pop() || "jpg").split("?")[0];
          a.href = URL.createObjectURL(blob);
          a.download = `${(d.title || "design").replace(/\s+/g, "_")}.${ext}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1200);
        } catch (e) {
          console.error(e);
          alert("No se pudo descargar la imagen.");
        }
      });
    }
  }

  function attachMockupZoom() {
    const modal = $("#mockupModal", wrap);
    const modalImg = $("#mockupModalImage", wrap);
    const closeBtn = $("#mockupModalClose", wrap);
    if (!modal || !modalImg || !closeBtn) return;

    const close = () => {
      modal.classList.remove("open");
      modalImg.src = "";
    };

    wrap.querySelectorAll(".mockup-zoom-trigger[data-mockup-zoom]").forEach((trigger) => {
      trigger.addEventListener("click", () => {
        const imageUrl = trigger.dataset.mockupZoom || "";
        if (!imageUrl) return;
        modalImg.src = imageUrl;
        modalImg.alt = trigger.dataset.mockupAlt || "Mockup ampliado";
        modal.classList.add("open");
      });
    });

    closeBtn.addEventListener("click", close);
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) close();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && modal.classList.contains("open")) close();
    });
  }

  function attachCartButtons(designData) {
    if (!cartStore) return;
    wrap
      .querySelectorAll(".media-cart-btn[data-product-id]:not([disabled])")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const productId = btn.dataset.productId;
          if (!productId) return;
          cartStore.addItem({
            design_id: designData.id,
            design_title: designData.title,
            product_id: productId,
            product_name: btn.dataset.productName || "Producto",
            price: Number(btn.dataset.productPrice) || 0,
            quantity: 1,
            image_url: btn.dataset.productImage || designData.image_url
          });
          btn.classList.add("added");
          btn.innerHTML = `<i class="fa-solid fa-check"></i> Agregado`;
          setTimeout(() => {
            if (!document.contains(btn)) return;
            btn.classList.remove("added");
            btn.innerHTML = `<i class="fa-solid fa-cart-plus"></i> Agregar al carrito`;
          }, 1800);
        });
      });
  }

  async function load() {
    try {
      const [d, me] = await Promise.all([fetchJSON(api(`/designs/${id}`)), getMe()]);
      let liked = false;
      if (token) {
        try {
          const s = await fetch(api(`/designs/${id}/like`), {
            headers: { ...auth() },
            cache: "no-store"
          });
          if (s.ok) liked = !!(await s.json()).liked;
        } catch {}
      }
      render(d, liked, me);
    } catch (e) {
      console.error(e);
      wrap.innerHTML = `<div class="card" style="grid-column:1/-1">No se pudo cargar el diseño.</div>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load, { once: true });
  } else {
    load();
  }
})();
