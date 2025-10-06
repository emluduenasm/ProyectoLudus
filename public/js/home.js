// /public/js/home.js
console.log("[home] script cargado");

const initHome = async () => {
  const grid = document.getElementById("featured-grid");
  if (!grid) {
    console.warn("[home] no existe #featured-grid");
    return;
  }

  grid.innerHTML = `<p class="muted">Cargando diseños destacados…</p>`;

  try {
    const url = "/api/designs/featured?limit=6";
    console.log("[home] fetching:", url);
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = await res.json();
    console.log("[home] recibidos:", items);

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
    console.error("[home] error render:", e);
    grid.innerHTML = `<p class="muted">No se pudieron cargar los diseños.</p>`;
  }
};

document.addEventListener("DOMContentLoaded", initHome);
