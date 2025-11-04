// /public/js/design.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r=document) => r.querySelector(s);

  const qs = new URLSearchParams(location.search);
  const id = qs.get("id");

  const token = localStorage.getItem("token") || "";
  const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});

  const wrap = $("#detail");

  if (!id) {
    wrap.innerHTML = `<div class="card" style="grid-column:1/-1">ID de diseño inválido.</div>`;
    return;
  }

  async function fetchJSON(url, opts={}) {
    const res = await fetch(url, { ...opts, cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  async function getMe() {
    if (!token) return null;
    try {
      const res = await fetch(api("/auth/me"), {
        headers: { ...auth(), "Accept":"application/json" },
        cache: "no-store"
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  function render(d, liked=false, me=null) {
    const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch] || ch));
    const mockups = Array.isArray(d.mockups) ? d.mockups : [];
    const mockupCards = mockups
      .map(
        (m) => `
        <div class="media-card">
          <h3>${esc(m.product_name || "Mockup")}</h3>
          <img src="${m.image_url}" alt="Mockup ${esc(m.product_name || "producto")}" style="width:100%;object-fit:contain;border-radius:12px;" />
        </div>`
      )
      .join("");

    const hasMockups = Boolean(mockups.length);
    const fallbackMockup = !hasMockups && d.mockup_remera
      ? `<div class="media-card">
           <h3>Mockup remera</h3>
           <img src="${d.mockup_remera}" alt="Mockup remera de ${esc(d.title)}"
                style="width:100%;object-fit:contain;border-radius:12px;" />
         </div>`
      : "";

    wrap.innerHTML = `
      <div class="detail-media">
        <div class="media-card">
          <h3>Diseño original</h3>
          <img src="${d.image_url}" alt="${esc(d.title)}"
               style="width:100%;object-fit:contain;border-radius:12px;" />
        </div>
        ${hasMockups ? mockupCards : fallbackMockup}
      </div>

      <aside class="meta">
        <div class="card" style="padding:1.5rem;">
          <h1 style="margin-top:0">${esc(d.title)}</h1>
          <div class="muted">
            por <strong>${esc(d.designer_name || "anónimo")}</strong>
            ${d.category_name ? `<span class="badge">${esc(d.category_name)}</span>` : ""}
          </div>

          <div class="likes" style="display:flex;align-items:center;gap:8px;margin-top:14px">
            <button id="btnLike" class="btn btn-like ${liked ? "liked": ""}">
              <i class="fa-solid fa-heart"></i>
              <span id="likeText">${liked ? "Te gusta" : "Me gusta"}</span>
            </button>
            <span id="likeCount" class="muted">${d.likes ?? 0}</span>
          </div>

          ${me?.role === "admin" ? `
            <div style="margin-top:.75rem">
              <button id="btnDownload" class="btn">
                <i class="fa-solid fa-download"></i> Descargar diseño
              </button>
            </div>
          ` : ""}

          <div style="margin-top:1.2rem;">
            <h3 style="margin-bottom:.5rem;">Descripción</h3>
            <p id="desc" style="color:#334155;white-space:pre-wrap;">
              ${d.description ? esc(d.description) : "Este diseño aún no tiene descripción."}
            </p>
          </div>

          <p class="muted" style="margin-top:1.5rem">
            Publicado: ${new Date(d.created_at).toLocaleDateString("es-AR")}
          </p>
        </div>
      </aside>
    `;

    // Like handler
    $("#btnLike")?.addEventListener("click", async () => {
      if (!token) {
        location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
        return;
      }
      try {
        const r = await fetchJSON(api(`/designs/${id}/like`), {
          method: "POST",
          headers: { ...auth() },
        });
        $("#btnLike").classList.toggle("liked", r.liked);
        $("#likeText").textContent = r.liked ? "Te gusta" : "Me gusta";
        $("#likeCount").textContent = r.likes;
      } catch (e) {
        console.error(e);
        alert("No se pudo actualizar tu me gusta.");
      }
    });

    // Descargar (solo admin)
    if (me?.role === "admin") {
      $("#btnDownload")?.addEventListener("click", async () => {
        try {
          const res = await fetch(d.image_url, { credentials: "same-origin", cache: "no-store" });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const blob = await res.blob();
          const a = document.createElement("a");
          const ext = (d.image_url.split(".").pop() || "jpg").split("?")[0];
          a.href = URL.createObjectURL(blob);
          a.download = `${(d.title || "design").replace(/\s+/g,"_")}.${ext}`;
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

  async function load() {
    try {
      const [d, me] = await Promise.all([
        fetchJSON(api(`/designs/${id}`)),
        getMe()
      ]);

      // Si hay sesión, pregunto si ya di like
      let liked = false;
      if (token) {
        try {
          const s = await fetch(api(`/designs/${id}/like`), { headers: { ...auth() }, cache:"no-store" });
          if (s.ok) {
            const j = await s.json();
            liked = !!j.liked;
          }
        } catch {}
      }

      render(d, liked, me);
    } catch (e) {
      console.error(e);
      wrap.innerHTML = `<div class="card" style="grid-column:1/-1">No se pudo cargar el diseño.</div>`;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load, { once:true });
  } else {
    load();
  }
})();
