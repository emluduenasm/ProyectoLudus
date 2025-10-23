// /public/js/admin-users.js
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

/* ------- Estado ------- */
let state = { page: 1, limit: 10, q: "", role: "", sort: "newest" };

/* ------- Controles ------- */
const el = {
  rows: $("#rows"),
  q: $("#q"),
  btnSearch: $("#btnSearch"),
  resultInfo: $("#resultInfo"),
  pageInfo: $("#pageInfo"),
  prev: $("#prev"),
  next: $("#next"),
  fRole: $("#fRole"),
  fSort: $("#fSort"),
  fLimit: $("#fLimit"),
  btnClear: $("#btnClear"),
};

/* ------- Render ------- */
async function loadList() {
  el.rows.innerHTML = `<tr><td colspan="7">Cargando…</td></tr>`;
  const params = new URLSearchParams({
    page: state.page,
    limit: state.limit,
    q: state.q,
    role: state.role,
    sort: state.sort,
  });

  const res = await fetch(api(`/admin/users?${params.toString()}`), {
    headers: { ...auth(), "Accept":"application/json" },
    cache: "no-store"
  });
  if (!res.ok) { el.rows.innerHTML = `<tr><td colspan="7">Error al cargar</td></tr>`; return; }
  const data = await res.json();

  el.resultInfo.textContent = `${data.total} usuario(s)`;
  el.pageInfo.textContent = `Página ${data.page} · ${data.items.length}/${state.limit}`;
  el.prev.disabled = state.page <= 1;
  el.next.disabled = data.page * state.limit >= data.total;

  el.rows.innerHTML = data.items.map(u => `
    <tr data-id="${u.id}" data-banned="${u.banned ? '1':'0'}">
      <td>
        <div><strong>${u.full_name || "—"}</strong> ${u.banned ? '<span class="role-pill" style="background:#fee2e2;color:#991b1b;margin-left:.4rem">Baneado</span>' : ''}</div>
        <div class="muted-sm">${u.persona_dni ? "DNI " + u.persona_dni : ""}</div>
      </td>
      <td>${u.username || "—"}</td>
      <td>${u.email}</td>
      <td>${u.designs_published ?? 0}</td>
      <td><span class="role-pill">${u.role}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString("es-AR")}</td>
      <td class="right">
        <div class="actions">
          <button class="btn" data-action="edit"><i class="fa-solid fa-pen"></i> Editar</button>
          ${u.banned
            ? `<button class="btn" data-action="unban"><i class="fa-solid fa-unlock"></i> Desbanear</button>`
            : `<button class="btn btn-danger" data-action="ban"><i class="fa-solid fa-ban"></i> Banear</button>`}
        </div>
      </td>
    </tr>
  `).join("");

  // listeners
  el.rows.querySelectorAll("button[data-action]").forEach(btn => {
    const tr = btn.closest("tr");
    const id = tr.dataset.id;
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      if (action === "edit")   openEdit(id, tr);
      if (action === "ban")    await confirmBan(id, tr);
      if (action === "unban")  await confirmUnban(id, tr);
      if (action === "del")    await confirmDel(id, tr);
    });
  });
}

/* ------- BAN / UNBAN ------- */
async function confirmBan(id) {
  if (!confirm("¿Banear a este usuario? No podrá iniciar sesión.")) return;
  const reason = prompt("Motivo del baneo (opcional):", "Cuenta baneada por infringir las reglas.") || "";
  try {
    const res = await fetch(api(`/admin/users/${id}/ban`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth() },
      body: JSON.stringify({ reason }),
      cache: "no-store"
    });
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) throw new Error(data?.error || "No se pudo banear");
    await loadList();
  } catch (e) {
    alert(e.message || "No se pudo banear");
  }
}

async function confirmUnban(id) {
  try {
    const res = await fetch(api(`/admin/users/${id}/unban`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...auth() },
      body: JSON.stringify({}),
      cache: "no-store"
    });
    const data = await res.json().catch(()=> ({}));
    if (!res.ok) throw new Error(data?.error || "No se pudo desbanear");
    await loadList();
  } catch (e) {
    alert(e.message || "No se pudo desbanear");
  }
}

/* ------- PATCH helper (editar) ------- */
async function patchUser(id, payload) {
  const res = await fetch(api(`/admin/users/${id}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...auth() },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) throw new Error(data?.error || "PATCH failed");
  return data;
}

/* ------- DELETE opcional ------- */
async function confirmDel(id, tr) {
  if (!confirm("¿Eliminar este usuario?")) return;
  const res = await fetch(api(`/admin/users/${id}`), {
    method: "DELETE",
    headers: { ...auth() },
    cache: "no-store"
  });
  const data = await res.json().catch(()=> ({}));
  if (!res.ok) { alert(data?.error || "No se pudo eliminar"); return; }
  tr.remove();
}

/* ------- Modal Edit ------- */
const dlg = $("#modal");
const form = $("#formEdit");
const msg = $("#msg");

function setForm(user) {
  form.id.value = user.id;
  form.username.value = user.username || "";
  form.role.value = user.role || "buyer";
}

async function openEdit(id, tr) {
  setForm({
    id,
    username: tr.children[1].textContent.trim(),
    role: tr.children[4].innerText.trim(),
  });
  msg.textContent = "";
  dlg.showModal();
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.textContent = "";
  const id = form.id.value;
  const payload = {
    username: form.username.value.trim(),
    role: form.role.value,
  };
  try {
    await patchUser(id, payload);
    dlg.close();
    await loadList();
  } catch (e) {
    msg.textContent = e.message || "No se pudo guardar los cambios";
  }
});

$("#btnClose").addEventListener("click", () => dlg.close());

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
  state.role  = el.fRole.value || "";
  state.sort  = el.fSort.value || "newest";
  state.limit = parseInt(el.fLimit.value || "10", 10);
  state.page  = 1;
  loadList();
}
[el.fRole, el.fSort, el.fLimit].forEach(ctrl => ctrl && ctrl.addEventListener("change", applyFiltersFromUI));

$("#btnClear")?.addEventListener("click", () => {
  el.q.value = "";
  el.fRole.value = "";
  el.fSort.value = "newest";
  el.fLimit.value = "10";
  state = { page: 1, limit: 10, q: "", role:"", sort:"newest" };
  loadList();
});

/* ------- Init ------- */
(async () => {
  const ok = await guardAdmin();
  if (!ok) return;
  if (el.fLimit) el.fLimit.value = String(state.limit);
  await loadList();
})();
