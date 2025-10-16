// /public/js/design.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $$ = (s, r = document) => r.querySelector(s);
  const token = localStorage.getItem("token") || "";
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  function getDesignIdFromLocation() {
    const url = new URL(location.href);
    const qId = url.searchParams.get("id");
    if (qId) return qId.trim();
    const h = (url.hash || "").replace(/^#/, "").trim();
    if (h) return h;
    return null;
  }

  window.addEventListener("error", (ev) => {
    const c = $$("#design-detail");
    if (c) c.innerHTML = `<p style="color:#b91c1c">Error de script: ${ev.message}</p>`;
    console.error("[design] window error:", ev.error || ev.message);
  });

  function likeButtonHTML({ liked, likes, logged }) {
    if (!logged) {
      return `
        <a class="btn" href="/login.html">
          <i class="fa-solid fa-heart"></i> Iniciar sesión para dar Me gusta
        </a>
        <span class="muted" style="margin-left:.5rem"><i class="fa-solid fa-heart"></i> ${likes}</span>
      `;
    }
    const activeClass = liked ? "btn-primary" : "btn";
    const icon = liked ? "fa-solid fa-heart" : "fa-regular fa-heart";
    return `
      <button id="likeBtn" type="button" class="${activeClass}">
        <i class="${icon}"></i> ${liked ? "Te gusta" : "Me gusta"}
      </button>
      <span id="likeCount" class="muted" style="margin-left:.5rem"><i class="fa-solid fa-heart"></i> ${likes}</span>
    `;
  }

  async function safeJSON(res) {
    try { return await res.json(); } catch { return null; }
  }

  async function fetchDesign(id) {
    const res = await fetch(api(`/designs/${encodeURIComponent(id)}`), {
      headers: { Accept: "application/json" },
    });
    const data = await safeJSON(res);
    if (!res.ok) throw (data || { error: "Error HTTP " + res.status });
    return data;
  }

  async function fetchLiked(id) {
    if (!token) return { liked: false, available: false };
    try {
      const res = await fetch(api(`/designs/${encodeURIComponent(id)}/like`), {
        headers: { ...authHeaders(), Accept: "application/json" },
      });
      // Si el endpoint no existe (404) o no hay auth (401), devolvemos estado por defecto
      if (!res.ok) return { liked: false, available: false };
      const data = await safeJSON(res);
      return { liked: !!(data && data.liked), available: true };
    } catch {
      return { liked: false, available: false };
    }
  }

  async function toggleLike(id) {
    const res = await fetch(api(`/designs/${encodeURIComponent(id)}/like`), {
      method: "POST",
      headers: { ...authHeaders(), Accept: "application/json" },
    });
    if (res.status === 401) {
      location.href = "/login.html";
      return null;
    }
    const data = await safeJSON(res);
    if (!res.ok) throw (data || { error: "Error HTTP " + res.status });
    return data; // { liked, likes }
  }

  async function loadDesign() {
    const container = $$("#design-detail");
    const id = getDesignIdFromLocation();

    if (!container) return;
    if (!id) {
      container.innerHTML = `<p>ID de diseño no especificado. Volvé y abrí el diseño desde una tarjeta.</p>`;
      return;
    }

    try {
      // 1) Detalle del diseño (si esto falla, mostramos error)
      const data = await fetchDesign(id);

      // 2) Estado de like (si esto falla, NO rompemos la vista)
      const logged = !!token;
      const likedState = await fetchLiked(id); // { liked, available }

      container.innerHTML = `
        <div>
          <img src="${data.image_url}" alt="${data.title}"
              style="border-radius:12px;width:100%;max-height:520px;object-fit:contain;background:#f8fafc"/>
        </div>
        <div>
          <h1>${data.title}</h1>
          ${data.description ? `<p>${data.description}</p>` : `<p class="muted">Sin descripción.</p>`}

          <div class="meta" style="margin-top:1rem;color:#555;font-size:0.95rem;">
            <span><i class="fa-solid fa-user"></i> ${data.designer_name}</span>
            <span><i class="fa-solid fa-calendar"></i> ${new Date(data.created_at).toLocaleDateString("es-AR")}</span>
            <span><i class="fa-solid fa-heart"></i> ${data.likes}</span>
          </div>

          <div id="likeArea" style="margin-top:1rem;">
            ${
              likedState.available
                ? likeButtonHTML({ liked: likedState.liked, likes: data.likes ?? 0, logged })
                : `<span class="muted"><i class="fa-solid fa-heart"></i> ${data.likes ?? 0}</span>`
            }
          </div>
        </div>
      `;

      // 3) Listener del botón like (si el endpoint no existe, no mostramos botón)
      if (logged && likedState.available) {
        const likeBtn = $$("#likeBtn");
        const likeCountEl = $$("#likeCount");
        if (likeBtn) {
          likeBtn.addEventListener("click", async () => {
            try {
              likeBtn.disabled = true;
              const r = await toggleLike(id); // { liked, likes }
              if (!r) return;
              likeBtn.className = r.liked ? "btn-primary" : "btn";
              likeBtn.innerHTML = `<i class="${r.liked ? "fa-solid fa-heart" : "fa-regular fa-heart"}"></i> ${r.liked ? "Te gusta" : "Me gusta"}`;
              if (likeCountEl) likeCountEl.innerHTML = `<i class="fa-solid fa-heart"></i> ${r.likes}`;
            } catch (err) {
              console.error(err);
            } finally {
              likeBtn.disabled = false;
            }
          });
        }
      }
    } catch (err) {
      console.error("[design] error:", err);
      const msg = err?.error || "No se pudo cargar el diseño.";
      container.innerHTML = `<p>${msg}</p>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadDesign, { once: true });
  } else {
    loadDesign();
  }
})();
