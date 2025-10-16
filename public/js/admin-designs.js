// /public/js/admin-designs.js
const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
const $ = (s, r=document) => r.querySelector(s);
const token = localStorage.getItem("token") || "";
const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});

async function guardAdmin() {
  try {
    const res = await fetch(api("/auth/me"), {
      headers: { ...auth(), "Accept":"application/json" },
      cache: "no-store"
    });
    if (!res.ok) { location.href = "/login.html?next=" + encodeURIComponent(location.pathname); return false; }
    const me = await res.json();
    if (me.role !== "admin") {
      const main = document.querySelector("main") || document.body;
      main.innerHTML = `
        <section class="card" style="max-width:900px;margin:2rem auto;padding:1rem">
          <h1>Acceso denegado</h1>
          <p class="muted">Se requieren permisos de administrador.</p>
          <p style="margin-top:1rem"><a class="btn" href="/"><i class="fa-solid fa-house"></i> Volver</a></p>
        </section>`;
      return false;
    }
    return true;
  } catch {
    location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
    return false;
  }
}

/* ------- Estado de la lista ------- */
let state = { page: 1, limit: 10, q: "" };

async function loadList() {
  const rows = $("#rows");
  rows.innerHTML = `<tr><td colspan="6">Cargando…</td></tr>`;
  const params = new URLSearchParams({ page: state.page, limit: state.limit, q: state.q });
  const res = await fetch(api(`/admin/designs?${params.toString()}`), {
    headers: { ...auth(), "Accept":"application/json" },
    cache: "no-store"
  });
  if (!res.ok) { rows.innerHTML = `<tr><td colspan="6">Error al cargar</td></tr>`; return; }
  const data = await res.json();

  $("#resultInfo").textContent = `${data.total} resultado(s)`;
  $("#pageInfo").textContent = `Página ${data.page} · ${data.items.length}/${state.limit}`;
  $("#prev").disabled = state.page <= 1;
  $("#next").disabled = data.page * state.limit >= data.total;

  rows.innerHTML = data.items.map(d => `
    <tr data-id="${d.id}" data-img="${d.image_url}">
      <td><img class="thumb" src="${d.thumbnail_url || d.image_url}" alt="${d.title}"/></td>
      <td>
        <div><strong>${d.title}</strong></div>
        <div class="muted-sm">${new Date(d.created_at).toLocaleDateString("es-AR")}</div>
      </td>
      <td>${d.designer_name}</td>
      <td>${d.likes}</td>
      <td>
        <label title="${d.published ? 'Publicado' : 'No publicado'}">
          <input type="checkbox" class="switch pub-toggle" ${d.published ? "checked":""}/>
        </label>
      </td>
      <td class="right">
        <div class="actions">
          <button class="btn" data-action="edit"><i class="fa-solid fa-pen"></i> Editar</button>
          <button class="btn" data-action="download"><i class="fa-solid fa-download"></i> Descargar diseño</button>
          <button class="btn btn-danger" data-action="del"><i class="fa-solid fa-trash"></i> Eliminar</button>
        </div>
      </td>
    </tr>
  `).join("");

  // Actions
  rows.querySelectorAll("button[data-action]").forEach(btn => {
    const tr = btn.closest("tr");
    const id = tr.dataset.id;
    const img = tr.dataset.img;
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "edit") openEdit(id, tr);
      if (action === "download") downloadImage(img, id);
      if (action === "del") confirmDel(id, tr);
    });
  });

  // Toggle publicado
  rows.querySelectorAll(".pub-toggle").forEach(chk => {
    const tr = chk.closest("tr");
    const id = tr.dataset.id;
    chk.addEventListener("change", async () => {
      chk.disabled = true;
      try {
        await patchDesign(id, { published: chk.checked });
      } catch(e){
        console.error(e);
        chk.checked = !chk.checked; // revertir si falla
        alert("No se pudo actualizar el estado de publicación.");
      } finally {
        chk.disabled = false;
      }
    });
  });
}

/* ------- Descarga robusta del original ------- */
async function downloadImage(url, id) {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const blob = await res.blob();
    const a = document.createElement("a");
    const ext = (url.split(".").pop() || "jpg").split("?")[0];
    a.href = URL.createObjectURL(blob);
    a.download = `design-${id}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  } catch (e) {
    console.error(e);
    // fallback: abrir en nueva pestaña
    window.open(url, "_blank");
  }
}

/* ------- PATCH helper ------- */
async function patchDesign(id, payload) {
  const res = await fetch(api(`/admin/designs/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth() },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  if (!res.ok) throw new Error("PATCH failed");
  return await res.json();
}

/* ------- Modal Edit ------- */
const dlg = $("#modal");
const form = $("#formEdit");
const msg = $("#msg");

function setForm(design) {
  form.id.value = design.id;
  form.title.value = design.title || "";
  form.description.value = design.description || "";
  form.published.checked = !!design.published;
}

async function openEdit(id, tr) {
  setForm({
    id,
    title: tr.querySelector("strong").textContent,
    description: "",
    published: tr.querySelector(".pub-toggle").checked
  });
  msg.textContent = "";
  dlg.showModal();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";
  const id = form.id.value;
  const payload = {
    title: form.title.value.trim(),
    description: form.description.value.trim(),
    published: form.published.checked
  };
  try {
    await patchDesign(id, payload);
    dlg.close();
    await loadList();
  } catch {
    msg.textContent = "No se pudo guardar los cambios";
  }
});

$("#btnClose").addEventListener("click", () => dlg.close());

/* ------- Delete ------- */
async function confirmDel(id, tr) {
  if (!confirm("¿Eliminar este diseño? Se borrarán también sus likes y archivos.")) return;
  const res = await fetch(api(`/admin/designs/${id}`), { method: "DELETE", headers: { ...auth() }, cache: "no-store" });
  if (!res.ok) { alert("No se pudo eliminar"); return; }
  tr.remove();
}

/* ------- Búsqueda y paginación ------- */
$("#btnSearch").addEventListener("click", () => {
  state.q = $("#q").value.trim();
  state.page = 1;
  loadList();
});
$("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btnSearch").click(); });
$("#prev").addEventListener("click", () => { if (state.page > 1) { state.page--; loadList(); } });
$("#next").addEventListener("click", () => { state.page++; loadList(); });

/* ------- Init ------- */
(async () => {
  const ok = await guardAdmin();
  if (!ok) return;
  await loadList();
})();
