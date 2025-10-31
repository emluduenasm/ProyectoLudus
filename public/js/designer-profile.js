(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);

  const wrap = $("#designerContent");
  const params = new URLSearchParams(location.search);
  const alias = (params.get("alias") || "").trim();

  function renderError(message) {
    if (!wrap) return;
    wrap.innerHTML = `<div class="error-box">${message || "No se pudo cargar el perfil."}</div>`;
  }

  function designCard(d) {
    return `
      <a class="design-card" href="/design.html?id=${encodeURIComponent(d.id)}">
        <div class="thumb">
          <img src="${d.thumbnail_url || d.image_url}" alt="${d.title}"/>
        </div>
        <div class="body">
          <div class="title">${d.title}</div>
          <div class="meta">
            <span><i class="fa-solid fa-heart"></i> ${d.likes}</span>
            ${d.category_name ? `<span>${d.category_name}</span>` : ""}
          </div>
          <span class="muted" style="font-size:.78rem">${new Date(d.created_at).toLocaleDateString("es-AR")}</span>
        </div>
      </a>
    `;
  }

  async function loadProfile() {
    if (!alias) {
      renderError("Alias no especificado.");
      return;
    }
    if (!wrap) return;
    wrap.innerHTML = `<div class="card" style="padding:1.5rem">Cargando perfil de <strong>${alias}</strong>…</div>`;
    try {
      const res = await fetch(api(`/designers/profile/${encodeURIComponent(alias)}`), { cache: "no-store" });
      if (res.status === 404) {
        renderError("No encontramos a este diseñador.");
        return;
      }
      if (!res.ok) throw new Error("No se pudo cargar el perfil.");
      const data = await res.json();
      const info = data.designer || {};
      const designs = Array.isArray(data.designs) ? data.designs : [];

      const likesText = `${info.stats?.likes_published ?? 0} like${(info.stats?.likes_published ?? 0) === 1 ? "" : "s"}`;
      const designsText = `${info.stats?.designs_published ?? designs.length} diseño${(info.stats?.designs_published ?? designs.length) === 1 ? "" : "s"}`;

      wrap.innerHTML = `
        <section class="designer-hero">
          <div class="designer-avatar">
            <img src="${info.avatar_url || "/img/uploads/avatars/default.png"}" alt="Avatar de ${info.username || "diseñador"}"/>
          </div>
          <div class="designer-meta">
            <div>
              <h1 style="margin:0">${info.username || "diseñador"}</h1>
              ${info.display_name && info.display_name !== info.username ? `<p class="muted" style="margin-top:.25rem">${info.display_name}</p>` : ""}
            </div>
            <div class="designer-stats">
              <span><i class="fa-solid fa-images"></i> ${designsText}</span>
              <span><i class="fa-solid fa-heart"></i> ${likesText}</span>
            </div>
            ${info.member_since ? `<p class="muted" style="font-size:.9rem">En la comunidad desde ${new Date(info.member_since).toLocaleDateString("es-AR")}</p>` : ""}
          </div>
        </section>

        <section class="designer-designs">
          <h2>Diseños publicados</h2>
          ${designs.length
            ? `<div class="design-grid">${designs.map(designCard).join("")}</div>`
            : `<p class="muted" style="margin-top:1rem">Todavía no hay diseños publicados.</p>`}
        </section>
      `;
    } catch (err) {
      renderError(err?.message || "No se pudo cargar el perfil.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadProfile, { once: true });
  } else {
    loadProfile();
  }
})();
