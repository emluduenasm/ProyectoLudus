// /public/js/home.js
const api = (p) => p.startsWith("/api") ? p : `/api${p}`;
const qs = (s, r=document) => r.querySelector(s);

/* ------------------ Diseños destacados ------------------ */
async function loadFeatured(limit = 6) {
  const grid = qs("#featured-grid");
  if (!grid) return;
  grid.innerHTML = `<p class="muted">Cargando…</p>`;

  try {
    const res = await fetch(api(`/designs/featured?limit=${limit}`));
    const items = await res.json();
    if (!res.ok) throw items;

    if (!items.length) {
      grid.innerHTML = `<p class="muted">No hay diseños destacados aún.</p>`;
      return;
    }

    grid.innerHTML = items.map(x => `
      <article class="card" data-id="${x.id}" style="cursor:pointer">
        <div class="card-media">
          <img src="${x.thumbnail_url || x.image_url}" alt="${x.title}" loading="lazy" />
        </div>
        <div class="card-body">
          <h3>${x.title}</h3>
          <p class="muted">${x.designer_name} ·
            <i class="fa-solid fa-heart"></i> ${x.likes ?? 0}</p>
        </div>
      </article>
    `).join("");

    grid.querySelectorAll(".card").forEach(card => {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        location.href = `/design.html?id=${id}`;
      });
    });

  } catch (err) {
    console.error(err);
    grid.innerHTML = `<p class="muted">No se pudieron cargar los destacados.</p>`;
  }
}

/* ------------------ Diseñadores destacados ------------------ */
async function loadFeaturedDesigners(limit = 8) {
  const grid = qs("#designers-grid");
  if (!grid) return;
  grid.innerHTML = `<p class="muted">Cargando…</p>`;

  try {
    const res = await fetch(api(`/designers/featured?limit=${limit}`)); // el SQL ya limita a 12
    const items = await res.json();
    if (!res.ok) throw items;

    if (!items.length) {
      grid.innerHTML = `<p class="muted">Todavía no hay diseñadores destacados.</p>`;
      return;
    }

    grid.innerHTML = items.slice(0, limit).map(d => `
      <article class="card designer" data-id="${d.id}" style="cursor:pointer">
        <div class="card-media avatar">
          <img src="${d.avatar_url || '/img/disenador1.jpg'}" alt="${d.name}" loading="lazy" />
        </div>
        <div class="card-body">
          <h3>${d.name}</h3>
          <p class="muted"><i class="fa-solid fa-heart"></i> ${d.likes ?? 0}</p>
        </div>
      </article>
    `).join("");

    // Por ahora, al click te llevo a la página general de diseñadores (o futura ficha)
    grid.querySelectorAll(".card").forEach(card => {
      card.addEventListener("click", () => {
        // Si luego tienes un detalle de diseñador, cambia aquí a /designer.html?id=...
        location.href = "/disenadores.html";
      });
    });

  } catch (err) {
    console.error(err);
    grid.innerHTML = `<p class="muted">No se pudieron cargar los diseñadores destacados.</p>`;
  }
}

/* ------------------ Init ------------------ */
document.addEventListener("DOMContentLoaded", () => {
  loadFeatured(6);
  loadFeaturedDesigners(8);
});
