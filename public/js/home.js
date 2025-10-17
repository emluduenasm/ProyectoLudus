// /public/js/home.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r=document) => r.querySelector(s);

  // Soporta varias variantes de IDs/clases que fuimos usando
  const getFeaturedWrap = () =>
    $("#featured-designs") ||
    $("#featured-list") ||
    $(".featured-designs") ||
    $("#featuredGrid");

  const getDesignersWrap = () =>
    $("#featured-designers") ||
    $("#designers-list") ||
    $(".featured-designers") ||
    $("#designersGrid");

  const featuredWrap  = getFeaturedWrap();
  const designersWrap = getDesignersWrap();

  const designCard = (d) => `
    <a class="card design-card" href="/design.html?id=${d.id}">
      <div class="thumb">
        <img src="${d.thumbnail_url || d.image_url}" alt="${d.title}" loading="lazy"/>
      </div>
      <div class="body">
        <h3 class="title">${d.title}</h3>
        <div class="meta">
          <span class="muted">${d.designer_name ?? "anónimo"}</span>
          <span title="Me gusta"><i class="fa-solid fa-heart"></i> ${d.likes ?? 0}</span>
        </div>
        ${d.category_name ? `<span class="badge">${d.category_name}</span>` : ""}
      </div>
    </a>
  `;

  const designerCard = (u) => `
    <a class="card" href="/designers.html#${encodeURIComponent(u.username || u.name || u.id)}">
      <div class="thumb">
        <img src="${u.avatar_url || '/img/disenador1.jpg'}" alt="${u.display_name || u.username || 'diseñador'}" loading="lazy"/>
      </div>
      <div class="body">
        <h3 class="title">${u.display_name || u.username || 'Diseñador'}</h3>
        <div class="meta"><span class="muted">${u.designs_count ?? 0} diseños</span></div>
      </div>
    </a>
  `;

  async function loadFeaturedDesigns() {
    if (!featuredWrap) return;
    featuredWrap.innerHTML = `<div class="muted span-all">Cargando…</div>`;
    try {
      const res = await fetch(api("/designs/featured?limit=6"), { cache: "no-store" });
      if (!res.ok) throw 0;
      const items = await res.json();
      featuredWrap.innerHTML = items.length
        ? items.map(designCard).join("")
        : `<div class="muted span-all">Todavía no hay diseños destacados.</div>`;
    } catch {
      featuredWrap.innerHTML = `<div class="muted span-all">No se pudieron cargar los diseños.</div>`;
    }
  }

  async function loadFeaturedDesigners() {
    if (!designersWrap) return;
    designersWrap.innerHTML = `<div class="muted span-all">Cargando…</div>`;
    try {
      const res = await fetch(api("/designers/featured?limit=6"), { cache: "no-store" });
      if (!res.ok) throw 0;
      const items = await res.json();
      designersWrap.innerHTML = items.length
        ? items.map(designerCard).join("")
        : `<div class="muted span-all">Sin diseñadores destacados por ahora.</div>`;
    } catch {
      designersWrap.innerHTML = "";
    }
  }

  // Blindaje: clic en tarjetas => siempre va a design.html
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest("a.design-card");
    if (!a) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
    location.href = a.href;
  }, true);

  // Estilos mínimos por si falta grid/target
  const injectOnce = (id, css) => {
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id; s.textContent = css; document.head.appendChild(s);
  };
  injectOnce("home-cards-css", `
    .cards, #featured-designs, #featured-list, .featured-designs, #featuredGrid,
            #featured-designers, #designers-list, .featured-designers, #designersGrid {
      display:grid; gap:14px; grid-template-columns:repeat(6,minmax(0,1fr));
    }
    @media (max-width:1100px){.cards, #featured-designs, #featured-list, .featured-designs, #featuredGrid,
                               #featured-designers, #designers-list, .featured-designers, #designersGrid{
      grid-template-columns:repeat(4,minmax(0,1fr));
    }}
    @media (max-width:720px){.cards, #featured-designs, #featured-list, .featured-designs, #featuredGrid,
                              #featured-designers, #designers-list, .featured-designers, #designersGrid{
      grid-template-columns:repeat(2,minmax(0,1fr));
    }}
    .card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 10px rgba(2,6,23,.06);display:block}
    .thumb{aspect-ratio:1/1;background:#f1f5f9;overflow:hidden}
    .thumb img{width:100%;height:100%;object-fit:cover;display:block}
    .body{padding:10px}
    .title{font-size:15px;margin:0 0 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .meta{display:flex;gap:10px;align-items:center;color:#64748b;font-size:12px}
    .badge{display:inline-block;margin-top:6px;background:#eef2ff;color:#312e81;border-radius:999px;padding:2px 8px;font-size:11px}
    .muted{color:#64748b}.span-all{grid-column:1/-1}
  `);

  function init(){ loadFeaturedDesigns(); loadFeaturedDesigners(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once:true });
  } else {
    init();
  }
})();
