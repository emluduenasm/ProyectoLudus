// /public/js/home.js
console.log("[home] script cargado");

const renderFeaturedDesigns = async () => {
  const grid = document.getElementById("featured-grid");
  if (!grid) return;
  grid.innerHTML = `<p class="muted">Cargando diseños destacados…</p>`;
  try {
    const res = await fetch("/api/designs/featured?limit=6");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      grid.innerHTML = `<p class="muted">Aún no hay diseños destacados.</p>`;
      return;
    }
    grid.innerHTML = items.map(x => `
      <article class="card">
        <div class="card-media">
          <img src="${x.image_url}" alt="${x.title}" loading="lazy" />
        </div>
        <div class="card-body">
          <h3>${x.title}</h3>
          <p class="muted">Diseñador: ${x.designer_name ?? "Anónimo"}</p>
          <p class="muted">${new Date(x.created_at).toLocaleDateString("es-AR")}</p>
          <p class="muted" title="Me gusta"><i class="fa-solid fa-heart"></i> ${x.likes ?? 0}</p>
        </div>
      </article>
    `).join("");
  } catch (e) {
    console.error("[home] featured designs error:", e);
    grid.innerHTML = `<p class="muted">No se pudieron cargar los diseños.</p>`;
  }
};

const renderFeaturedDesigners = async () => {
  const grid = document.getElementById("designers-grid");
  if (!grid) return;
  grid.innerHTML = `<p class="muted">Cargando diseñadores destacados…</p>`;
  try {
    const res = await fetch("/api/designers/featured?limit=6");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      grid.innerHTML = `<p class="muted">Aún no hay diseñadores destacados.</p>`;
      return;
    }
    grid.innerHTML = items.map(x => `
      <article class="card designer">
        <div class="card-media circle">
          <img src="${x.avatar_url}" alt="${x.display_name}" loading="lazy" />
        </div>
        <div class="card-body">
          <h3>${x.display_name}</h3>
          <p class="muted">${x.designs_count} diseño(s) · <i class="fa-solid fa-heart"></i> ${x.total_likes}</p>
        </div>
      </article>
    `).join("");
  } catch (e) {
    console.error("[home] featured designers error:", e);
    grid.innerHTML = `<p class="muted">No se pudieron cargar los diseñadores.</p>`;
  }
};

const initHome = async () => {
  await Promise.all([renderFeaturedDesigns(), renderFeaturedDesigners()]);
};

document.addEventListener("DOMContentLoaded", initHome);
