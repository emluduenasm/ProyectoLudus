// /public/js/upload.js
const token = localStorage.getItem("token") || "";
const api = (p) => p.startsWith("/api") ? p : `/api${p}`;
const authHeaders = () => token ? { Authorization: `Bearer ${token}` } : {};
const msg = (id, text, ok = false) => {
  const el = document.getElementById(id);
  el.textContent = text || "";
  el.style.color = ok ? "#047857" : "";
};

async function guardAuth() {
  const res = await fetch(api("/auth/me"), { headers: { ...authHeaders() } });
  if (!res.ok) { window.location.href = "/login.html"; return false; }
  return true;
}

async function loadMine() {
  const grid = document.getElementById("my-designs");
  grid.innerHTML = `<p class="muted">Cargando…</p>`;
  try {
    const res = await fetch(api("/designs/mine"), { headers: { ...authHeaders() } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const items = await res.json();

    if (!items.length) { grid.innerHTML = `<p class="muted">Todavía no subiste diseños.</p>`; return; }

    grid.innerHTML = items.map(x => `
      <article class="card" data-id="${x.id}" style="cursor:pointer">
        <div class="card-media">
          <img src="${x.thumbnail_url || x.image_url}" alt="${x.title}" loading="lazy" />
        </div>
        <div class="card-body">
          <h3>${x.title}</h3>
          ${x.description ? `<p>${x.description}</p>` : ``}
          <p class="muted">${new Date(x.created_at).toLocaleDateString("es-AR")} · 
            <i class="fa-solid fa-heart"></i> ${x.likes ?? 0}
          </p>
        </div>
      </article>
    `).join("");

    grid.querySelectorAll(".card").forEach(card => {
      card.addEventListener("click", () => {
        const id = card.dataset.id;
        location.href = `/design.html?id=${id}`; // siempre por query
      });
    });

  } catch (e) {
    console.error(e);
    grid.innerHTML = `<p class="muted">No se pudieron cargar tus diseños.</p>`;
  }
}

function setupForm() {
  const form = document.getElementById("form-upload");
  const inputFile = form.querySelector('input[name="image"]');
  const inputTitle = form.querySelector('input[name="title"]');
  const preview = document.getElementById("preview");
  const previewImg = document.getElementById("preview-img");

  inputFile.addEventListener("change", () => {
    const f = inputFile.files?.[0];
    if (!f) { preview.style.display = "none"; return; }

    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      msg("msg-upload", "Formato no permitido. Usa JPG, PNG o WEBP."); 
      preview.style.display = "none";
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      msg("msg-upload", "La imagen supera 8 MB.");
      preview.style.display = "none";
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => { previewImg.src = ev.target.result; preview.style.display = "block"; };
    reader.readAsDataURL(f);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg("msg-upload", "");

    const title = inputTitle.value.trim();
    const img = inputFile.files?.[0];
    if (title.length < 3) { msg("msg-upload", "El título es demasiado corto."); return; }
    if (!img) { msg("msg-upload", "Seleccioná una imagen."); return; }

    const fd = new FormData(form);
    try {
      const res = await fetch(api("/designs"), {
        method: "POST",
        headers: { ...authHeaders() },
        body: fd
      });
      const data = await res.json();
      if (!res.ok) throw data;

      msg("msg-upload", "¡Diseño subido y publicado!", true);
      form.reset();
      preview.style.display = "none";
      await loadMine();

    } catch (err) {
      console.error(err);
      msg("msg-upload", err?.error || "No se pudo subir el diseño");
    }
  });
}

(async () => {
  const ok = await guardAuth();
  if (!ok) return;
  setupForm();
  loadMine();
})();
