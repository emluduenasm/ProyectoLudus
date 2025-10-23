// /public/js/user-designs.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch
  ));

  const token = localStorage.getItem("token") || "";
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  const el = {
    rows: $("#rows"),
    resultInfo: $("#resultInfo"),
    modal: $("#modalEdit"),
    form: $("#formEdit"),
    msg: $("#msgEdit"),
    selCategory: $("#selCategory"),
  };

  const state = {
    items: [],
    categories: [],
  };

  async function guardUser() {
    if (!token) {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return null;
    }
    try {
      const res = await fetch(api("/auth/me"), {
        headers: { ...authHeaders(), Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 401) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/login.html?next=${next}`;
        return null;
      }
      if (!res.ok) throw new Error();
      return await res.json();
    } catch {
      const next = encodeURIComponent(location.pathname + location.search);
      location.href = `/login.html?next=${next}`;
      return null;
    }
  }

  async function loadCategories() {
    try {
      const res = await fetch(api("/categories"), { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!res.ok) throw new Error();
      state.categories = await res.json();
    } catch {
      state.categories = [];
    }
    fillCategorySelect();
  }

  function fillCategorySelect(selectedId) {
    if (!el.selCategory) return;
    if (!state.categories.length) {
      el.selCategory.innerHTML = `<option value="">Sin categorías disponibles</option>`;
      return;
    }
    el.selCategory.innerHTML = state.categories.map(c =>
      `<option value="${esc(c.id)}">${esc(c.name)}</option>`
    ).join("");
    if (typeof selectedId !== "undefined") {
      el.selCategory.value = String(selectedId);
    }
  }

  function categoryName(id) {
    const name = state.categories.find(c => String(c.id) === String(id))?.name || "—";
    return esc(name);
  }

  function formatStatus(published) {
    return published
      ? `<span class="status-pill published"><i class="fa-solid fa-circle-check"></i> Publicado</span>`
      : `<span class="status-pill pending"><i class="fa-solid fa-hourglass-half"></i> En revisión</span>`;
  }

  async function loadDesigns() {
    if (!el.rows) return;
    el.rows.innerHTML = `<tr><td colspan="5">Cargando…</td></tr>`;
    try {
      const res = await fetch(api("/designs/mine"), {
        headers: { ...authHeaders(), Accept: "application/json" },
        cache: "no-store",
      });
      if (res.status === 401) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/login.html?next=${next}`;
        return;
      }
      if (!res.ok) throw new Error();
      const data = await res.json();
      state.items = Array.isArray(data) ? data : [];

      if (el.resultInfo) {
        el.resultInfo.textContent = `${state.items.length} diseño(s)`;
      }

      if (!state.items.length) {
        el.rows.innerHTML = `<tr><td colspan="5">Todavía no subiste diseños. Podés empezar desde <a class="link" href="/upload.html">Subir diseño</a>.</td></tr>`;
        return;
      }

      el.rows.innerHTML = state.items.map(d => `
        <tr data-id="${esc(d.id)}">
          <td><img class="thumb" src="${esc(d.thumbnail_url || d.image_url)}" alt="${esc(d.title)}"/></td>
          <td>
            <div><strong>${esc(d.title)}</strong></div>
            <div class="muted-sm">${new Date(d.created_at).toLocaleDateString("es-AR")} · ${categoryName(d.category_id)}</div>
            ${d.description ? `<div class="muted-sm" style="margin-top:.25rem">${esc(d.description)}</div>` : ""}
          </td>
          <td>${esc(d.likes ?? 0)}</td>
          <td>${formatStatus(d.published)}</td>
          <td class="right">
            <div class="actions">
              <button class="btn" data-action="edit"><i class="fa-solid fa-pen"></i> Editar</button>
              <button class="btn btn-danger" data-action="delete"><i class="fa-solid fa-trash"></i> Eliminar</button>
            </div>
          </td>
        </tr>
      `).join("");

      attachRowListeners();
    } catch (e) {
      console.error(e);
      el.rows.innerHTML = `<tr><td colspan="5">No se pudieron cargar tus diseños.</td></tr>`;
    }
  }

  function attachRowListeners() {
    el.rows.querySelectorAll("button[data-action]").forEach(btn => {
      const tr = btn.closest("tr");
      const id = tr?.dataset?.id;
      if (!id) return;
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        if (action === "edit") openEdit(id);
        if (action === "delete") confirmDelete(id);
      });
    });
  }

  function findDesign(id) {
    return state.items.find(item => String(item.id) === String(id));
  }

  function openEdit(id) {
    const design = findDesign(id);
    if (!design || !el.form || !el.modal) return;
    el.form.id.value = design.id;
    el.form.title.value = design.title || "";
    el.form.description.value = design.description || "";
    fillCategorySelect(design.category_id);
    el.msg.textContent = "";
    el.msg.className = "muted-sm";
    el.modal.showModal();
  }

  el.form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!el.form) return;
    const id = el.form.id.value;
    const payload = {
      title: el.form.title.value.trim(),
      description: el.form.description.value.trim(),
      category_id: el.form.category_id.value,
    };
    if (!payload.title) {
      el.msg.textContent = "El título es obligatorio.";
      el.msg.className = "error";
      return;
    }

    try {
      el.msg.textContent = "";
      const res = await fetch(api(`/designs/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "No se pudo actualizar");
      el.msg.textContent = "Cambios guardados.";
      el.msg.className = "ok";
      el.modal.close();
      await loadDesigns();
    } catch (err) {
      el.msg.textContent = err.message || "No se pudo actualizar.";
      el.msg.className = "error";
    }
  });

  $("#btnClose")?.addEventListener("click", () => {
    el.modal?.close();
  });

  async function confirmDelete(id) {
    if (!confirm("¿Eliminar este diseño? Esta acción no se puede deshacer.")) return;
    try {
      const res = await fetch(api(`/designs/${id}`), {
        method: "DELETE",
        headers: { ...authHeaders() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "No se pudo eliminar");
      await loadDesigns();
    } catch (err) {
      alert(err.message || "No se pudo eliminar el diseño.");
    }
  }

  (async () => {
    const me = await guardUser();
    if (!me) return;
    await loadCategories();
    await loadDesigns();
  })();
})();
