// /public/js/admin-designs.js
const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
const $ = (s, r=document) => r.querySelector(s);
const token = localStorage.getItem("token") || "";
const auth = () => (token ? { Authorization: `Bearer ${token}` } : {});
const esc = (s) => String(s ?? "").replace(/[&<>""]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",""":"&quot;","'":"&#39;"}[ch] || ch));
const escAttr = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  reviewSection: $("#reviewSection"),
  reviewList: $("#reviewList"),
  reviewEmpty: $("#reviewEmpty"),
  reviewCount: $("#reviewCount"),
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

/* ------- En revisión ------- */
async function loadReviewQueue() {
  if (!el.reviewSection) return;
  try {
    const params = new URLSearchParams({
      page: 1,
      limit: 50,
      published: "0",
      sort: "newest",
    });
    const res = await fetch(api(`/admin/designs?${params.toString()}`), {
      headers: { ...auth(), Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("No se pudo cargar la revisión");
    const data = await res.json();
    renderReviewQueue(data.items || []);
  } catch (e) {
    console.error(e);
    el.reviewSection.style.display = "block";
    el.reviewList.innerHTML = `<p class="muted-sm">No se pudo cargar la bandeja de revisión.</p>`;
    el.reviewEmpty.style.display = "none";
    if (el.reviewCount) el.reviewCount.textContent = "";
  }
}

function renderReviewQueue(items) {
  if (!el.reviewSection) return;
  const hasItems = items.length > 0;
  el.reviewSection.style.display = "block";
  if (el.reviewCount) el.reviewCount.textContent = hasItems ? `${items.length} pendiente(s)` : "";
  el.reviewEmpty.style.display = hasItems ? "none" : "block";
  if (!hasItems) {
    el.reviewList.innerHTML = "";
    return;
  }
  el.reviewList.innerHTML = items.map(d => `
    <article class="review-card" data-id="${d.id}">
      <img class="thumb" src="${esc(d.thumbnail_url || d.image_url)}" alt="${esc(d.title)}"/>
      <div>
        <h3>${esc(d.title)}</h3>
        <div class="review-meta">
          ${new Date(d.created_at).toLocaleDateString("es-AR")} · ${(d.category_name || categoryNameById(d.category_id))}
          · Likes: ${d.likes ?? 0}
        </div>
        ${d.designer_name ? `<div class="review-meta" style="margin-top:.2rem">Diseñador: ${d.designer_name}</div>` : ""}
        ${d.description ? `<p class="muted-sm" style="margin-top:.4rem">${d.description}</p>` : ""}
      </div>
      <div class="review-actions">
        <button class="btn btn-success" data-action="publish"><i class="fa-solid fa-circle-check"></i> Publicar</button>
        <button class="btn btn-danger" data-action="reject"><i class="fa-solid fa-xmark"></i> Rechazar</button>
      </div>
    </article>
  `).join("");

  el.reviewList.querySelectorAll("button[data-action]").forEach(btn => {
    const card = btn.closest(".review-card");
    const id = card?.dataset?.id;
    if (!id) return;
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      if (action === "publish") await publishDesign(id, btn);
      if (action === "reject") await rejectDesign(id);
    });
  });
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
  if (!res.ok) { el.rows.innerHTML = `<tr><td colspan="7">Error al cargar</td></tr>`; await loadReviewQueue(); return; }
  const data = await res.json();

  el.resultInfo.textContent = `${data.total} resultado(s)`;
  el.pageInfo.textContent = `Página ${data.page} · ${data.items.length}/${state.limit}`;
  el.prev.disabled = state.page <= 1;
  el.next.disabled = data.page * state.limit >= data.total;

  el.rows.innerHTML = data.items.map(d => `
    <tr data-id="${d.id}" data-img="${d.image_url}" data-cat="${d.category_id}" data-status="${d.review_status || (d.published ? 'approved' : 'pending')}" data-desc="${escAttr(d.description)}">
      <td><img class="thumb" src="${esc(d.thumbnail_url || d.image_url)}" alt="${esc(d.title)}"/></td>
      <td>
        <div><strong>${esc(d.title)}</strong></div>
        <div class="muted-sm">${new Date(d.created_at).toLocaleDateString("es-AR")}</div>
      </td>
      <td>
        <div><strong>${esc(d.designer_username || d.designer_name || "—")}</strong></div>
        ${d.designer_banned ? `<div><span class="designer-badge-banned">Baneado</span></div>` : ""}
        ${(d.designer_full_name || d.designer_dni)
          ? `<div class="muted-sm">${[
              d.designer_full_name || "",
              d.designer_dni ? `DNI ${d.designer_dni}` : ""
            ].filter(Boolean).join(" · ")}</div>`
          : ""}
      </td>
      <td>${esc(d.category_name || categoryNameById(d.category_id))}</td>
      <td>${d.likes ?? 0}</td>
      <td>
        <div style="display:flex;flex-direction:column;gap:.35rem;align-items:flex-start">
          ${
            d.review_status === "approved"
              ? `<span class="status-pill published"><i class="fa-solid fa-circle-check"></i> Publicado</span>`
              : d.review_status === "rejected"
                ? `<span class="status-pill rejected"><i class="fa-solid fa-circle-xmark"></i> Rechazado</span>`
                : `<span class="status-pill pending"><i class="fa-solid fa-hourglass-half"></i> En revisión</span>`
          }
          ${d.review_status === "rejected"
            ? ""
            : `<label title="${d.published ? 'Publicado' : 'No publicado'}">
                <input type="checkbox" class="switch pub-toggle" ${d.published ? "checked":""}/>
              </label>`}
        </div>
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
        await patchDesign(id, { published: chk.checked, review_status: chk.checked ? 'approved' : 'pending' });
        await loadList();
      } catch(e){
        console.error(e);
        chk.checked = !chk.checked;
        alert("No se pudo actualizar el estado de publicación.");
      } finally {
        chk.disabled = false;
      }
    });
  });

  await loadReviewQueue();
}

/* ------- PATCH helper ------- */
async function patchDesign(id, payload) {
  const res = await fetch(api(`/admin/designs/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth() },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "No se pudo actualizar");
  return data;
}

async function publishDesign(id, btn) {
  if (btn) btn.disabled = true;
  try {
    await patchDesign(id, { published: true });
    await loadList();
  } catch (e) {
    alert(e.message || "No se pudo publicar el diseño.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function rejectDesign(id) {
  if (!confirm("¿Rechazar este diseño? Se eliminará definitivamente.")) return;
  try {
    const res = await fetch(api(`/admin/designs/${id}`), {
      method: "DELETE",
      headers: { ...auth() },
      cache: "no-store"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "No se pudo rechazar");
    await loadList();
  } catch (e) {
    alert(e.message || "No se pudo rechazar el diseño.");
  }
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
  form.dataset.status = design.review_status || "pending";
  fillCategorySelect(design.category_id || design.cat);
}

async function openEdit(id, tr) {
  const toggle = tr.querySelector(".pub-toggle");
  const status = tr.dataset.status || "pending";
  setForm({
    id,
    title: tr.querySelector("strong").textContent.trim(),
    description: tr.dataset.desc ? tr.dataset.desc : "",
    published: toggle ? toggle.checked : status === "approved",
    category_id: tr.dataset.cat,
    cat: tr.dataset.cat,
    review_status: status
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
    category_id: selCat.value,
    review_status: form.published.checked ? "approved" : (form.dataset.status === "rejected" ? "rejected" : "pending")
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
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { alert(data?.error || "No se pudo eliminar"); return; }
  await loadList();
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
