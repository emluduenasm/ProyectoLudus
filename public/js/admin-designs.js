// /public/js/admin-designs.js
const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
const $ = (s, r=document) => r.querySelector(s);
const token = localStorage.getItem("token") || "";
const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});

let CATEGORIES = [];

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
let state = {
  page: 1,
  limit: 10,
  q: "",
  category: "",
  published: "",
  sort: "newest",
  from: "",
  to: ""
};

/* ------- Controles ------- */
const el = {
  rows: $("#rows"),
  q: $("#q"),
  btnSearch: $("#btnSearch"),
  resultInfo: $("#resultInfo"),
  pageInfo: $("#pageInfo"),
  prev: $("#prev"),
  next: $("#next"),
  fCategory: $("#fCategory"),
  fPublished: $("#fPublished"),
  fSort: $("#fSort"),
  fFrom: $("#fFrom"),
  fTo: $("#fTo"),
  fLimit: $("#fLimit"),
  btnClear: $("#btnClear"),
};

/* ------- Categorías ------- */
async function loadCategories() {
  const res = await fetch(api("/categories"), { cache: "no-store" });
  CATEGORIES = res.ok ? await res.json() : [];
  // Filtro
  if (el.fCategory) {
    const opts = [`<option value="">Todas</option>`].concat(
      CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`)
    ).join("");
    el.fCategory.innerHTML = opts;
  }
}

function categoryNameById(id) {
  return CATEGORIES.find(c => String(c.id) === String(id))?.name || "—";
}

/* ------- Render ------- */
async function loadList() {
  el.rows.innerHTML = `<tr><td colspan="7">Cargando…</td></tr>`;
  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit,
    q: state.q,
    category: state.category,
    published: state.published,
    sort: state.sort,
    from: state.from,
    to: state.to
  });

  const res = await fetch(api(`/admin/designs?${params.toString()}`), {
    headers: { ...auth(), "Accept":"application/json" },
    cache: "no-store"
  });
  if (!res.ok) { el.rows.innerHTML = `<tr><td colspan="7">Error al cargar</td></tr>`; return; }
  const data = await res.json();

  el.resultInfo.textContent = `${data.total} resultado(s)`;
  el.pageInfo.textContent = `Página ${data.page} · ${data.items.length}/${state.limit}`;
  el.prev.disabled = state.page <= 1;
  el.next.disabled = data.page * state.limit >= data.total;

  el.rows.innerHTML = data.items.map(d => `
    <tr data-id="${d.id}" data-img="${d.image_url}" data-cat="${d.category_id}">
      <td><img class="thumb" src="${d.thumbnail_url || d.image_url}" alt="${d.title}"/></td>
      <td>
        <div><strong>${d.title}</strong></div>
        <div class="muted-sm">${new Date(d.created_at).toLocaleDateString("es-AR")}</div>
      </td>
      <td>${d.designer_name}</td>
      <td>${d.category_name || categoryNameById(d.category_id)}</td>
      <td>${d.likes}</td>
      <td>
        <label title="${d.published ? 'Publicado' : 'No publicado'}">
          <input type="checkbox" class="switch pub-toggle" ${d.published ? "checked":""}/>
        </label>
      </td>
      <td class="right">
        <div class="actions">
          <button class="btn" data-action="edit"><i class="fa-solid fa-pen"></i> Editar</button>
          <!-- Botón de descarga removido para ADMIN -->
          <button class="btn btn-danger" data-action="del"><i class="fa-solid fa-trash"></i> Eliminar</button>
        </div>
      </td>
    </tr>
  `).join("");

  // Actions
  el.rows.querySelectorAll("button[data-action]").forEach(btn => {
    const tr = btn.closest("tr");
    const id = tr.dataset.id;
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "edit") openEdit(id, tr);
      // if (action === "download") ...  <- eliminado
      if (action === "del") confirmDel(id, tr);
    });
  });

  // Toggle publicado
  el.rows.querySelectorAll(".pub-toggle").forEach(chk => {
    const tr = chk.closest("tr");
    const id = tr.dataset.id;
    chk.addEventListener("change", async () => {
      chk.disabled = true;
      try {
        await patchDesign(id, { published: chk.checked });
      } catch(e){
        console.error(e);
        chk.checked = !chk.checked;
        alert("No se pudo actualizar el estado de publicación.");
      } finally {
        chk.disabled = false;
      }
    });
  });
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
const selCat = $("#selCategory");

function fillCategorySelect(selectedId) {
  selCat.innerHTML = CATEGORIES.map(c =>
    `<option value="${c.id}" ${String(c.id)===String(selectedId)?'selected':''}>${c.name}</option>`
  ).join("");
}

function setForm(design) {
  form.id.value = design.id;
  form.title.value = design.title || "";
  form.description.value = design.description || "";
  form.published.checked = !!design.published;
  fillCategorySelect(design.category_id || design.cat);
}

async function openEdit(id, tr) {
  setForm({
    id,
    title: tr.querySelector("strong").textContent,
    description: "",
    published: tr.querySelector(".pub-toggle").checked,
    category_id: tr.dataset.cat,
    cat: tr.dataset.cat
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
    published: form.published.checked,
    category_id: selCat.value
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
el.btnSearch.addEventListener("click", () => {
  state.q = el.q.value.trim();
  state.page = 1;
  loadList();
});
el.q.addEventListener("keydown", (e) => { if (e.key === "Enter") el.btnSearch.click(); });
el.prev.addEventListener("click", () => { if (state.page > 1) { state.page--; loadList(); } });
el.next.addEventListener("click", () => { state.page++; loadList(); });

/* ------- Filtros ------- */
function applyFiltersFromUI() {
  state.category  = el.fCategory.value || "";
  state.published = el.fPublished.value;     // "", "1", "0"
  state.sort      = el.fSort.value || "newest";
  state.from      = el.fFrom.value || "";
  state.to        = el.fTo.value || "";
  state.limit     = parseInt(el.fLimit.value || "10", 10);
  state.page      = 1;
  loadList();
}

[el.fCategory, el.fPublished, el.fSort, el.fFrom, el.fTo, el.fLimit]
  .forEach(ctrl => ctrl && ctrl.addEventListener("change", applyFiltersFromUI));

$("#btnClear")?.addEventListener("click", () => {
  el.q.value = "";
  el.fCategory.value = "";
  el.fPublished.value = "";
  el.fSort.value = "newest";
  el.fFrom.value = "";
  el.fTo.value = "";
  el.fLimit.value = "10";
  state = { page: 1, limit: 10, q: "", category:"", published:"", sort:"newest", from:"", to:"" };
  loadList();
});

/* ------- Init ------- */
(async () => {
  const ok = await guardAdmin();
  if (!ok) return;
  await loadCategories();
  // set initial UI
  if (el.fLimit) el.fLimit.value = String(state.limit);
  await loadList();
})();
