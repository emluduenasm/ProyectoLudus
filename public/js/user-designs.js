// /public/js/user-designs.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch] || ch
  ));

  const token = localStorage.getItem("token") || "";
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});
  const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  const MAX_BYTES = 8 * 1024 * 1024;

  const el = {
    rows: $("#rows"),
    resultInfo: $("#resultInfo"),
    modal: $("#modalEdit"),
    form: $("#formEdit"),
    msg: $("#msgEdit"),
    selCategory: $("#selCategory"),
    statusNote: $("#statusNote"),
    previewWrap: $("#wrapPreview"),
    previewImg: $("#editPreview"),
  };

  const state = { items: [], categories: [] };
  const imageInput = el.form?.querySelector('input[name="image"]');

  function showMsg(text, type = "muted-sm") {
    if (!el.msg) return;
    el.msg.textContent = text || "";
    el.msg.className = type;
  }

  function setPreview(src) {
    if (!el.previewWrap || !el.previewImg) return;
    if (src) {
      el.previewImg.src = src;
      el.previewWrap.style.display = "flex";
    } else {
      el.previewImg.removeAttribute("src");
      el.previewWrap.style.display = "none";
    }
  }

  imageInput?.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) {
      setPreview(el.form?.dataset?.image || "");
      return;
    }
    if (!ALLOWED.includes(file.type) || file.size > MAX_BYTES) {
      showMsg("Imagen invalida (JPG, PNG o WEBP, max. 8 MB).", "error");
      imageInput.value = "";
      setPreview(el.form?.dataset?.image || "");
      return;
    }
    showMsg("", "muted-sm");
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result || "");
    reader.onerror = () => setPreview(el.form?.dataset?.image || "");
    reader.readAsDataURL(file);
  });

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
      el.selCategory.innerHTML = `<option value="">Sin categorias disponibles</option>`;
      return;
    }
    el.selCategory.innerHTML = state.categories
      .map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`)
      .join("");
    if (typeof selectedId !== "undefined") {
      el.selCategory.value = String(selectedId);
    }
  }

  function categoryName(id) {
    return esc(state.categories.find((c) => String(c.id) === String(id))?.name || "-");
  }

  function normalizeTags(value = "") {
    const seen = new Set();
    return String(value)
      .split(",")
      .map((tag) => tag.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .map((tag) => tag.slice(0, 32))
      .filter((tag) => {
        const key = tag.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 10);
  }

  function formatTags(tags = []) {
    const list = Array.isArray(tags) ? tags : normalizeTags(tags);
    if (!list.length) return "";
    return `<div class="tag-list">${list.map((tag) => `<span class="tag-chip">${esc(tag)}</span>`).join("")}</div>`;
  }

  function displayStatus(design) {
    const reviewStatus = design.review_status || (design.published ? "approved" : "pending");
    if (reviewStatus === "approved" && !design.published) return "approved_hidden";
    return reviewStatus;
  }

  function statusPill(status) {
    if (status === "approved") {
      return `<span class="status-pill published"><i class="fa-solid fa-circle-check"></i> Publicado</span>`;
    }
    if (status === "approved_hidden") {
      return `<span class="status-pill approved-hidden"><i class="fa-solid fa-eye-slash"></i> Aprobado · oculto</span>`;
    }
    if (status === "rejected") {
      return `<span class="status-pill rejected"><i class="fa-solid fa-circle-xmark"></i> Rechazado</span>`;
    }
    return `<span class="status-pill pending"><i class="fa-solid fa-hourglass-half"></i> En revision</span>`;
  }

  function visibilityButton(design, status) {
    if (status === "approved" && design.published) {
      return `<button class="btn btn-outline" data-action="unpublish"><i class="fa-solid fa-eye-slash"></i> Despublicar</button>`;
    }
    if (status === "approved_hidden") {
      return `<button class="btn btn-primary" data-action="publish"><i class="fa-solid fa-eye"></i> Publicar</button>`;
    }
    return "";
  }

  async function loadDesigns() {
    if (!el.rows) return;
    el.rows.innerHTML = `<tr><td colspan="5">Cargando...</td></tr>`;
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
        el.rows.innerHTML = `<tr><td colspan="5">Todavia no subiste diseños. Podes empezar desde <a class="link" href="/upload.html">Subir diseño</a>.</td></tr>`;
        return;
      }

      el.rows.innerHTML = state.items
        .map((d) => {
          const status = displayStatus(d);
          const rejectedNote = status === "rejected"
            ? `<div class="muted-sm" style="margin-top:.35rem;color:#b91c1c">Rechazado por el equipo. Edita y guarda para reenviarlo a revision.</div>`
            : "";
          const hiddenNote = status === "approved_hidden"
            ? `<div class="muted-sm" style="margin-top:.35rem;color:#1e40af">Aprobado por el equipo, pero no visible en la galeria.</div>`
            : "";
          return `
          <tr data-id="${esc(d.id)}">
            <td>
              <a class="link" href="/design.html?id=${encodeURIComponent(d.id)}" style="display:inline-flex">
                <img class="thumb" src="${esc(d.thumbnail_url || d.image_url)}" alt="${esc(d.title)}"/>
              </a>
            </td>
            <td>
              <div>
                <a class="link" href="/design.html?id=${encodeURIComponent(d.id)}">
                  <strong>${esc(d.title)}</strong>
                </a>
              </div>
              <div class="muted-sm">${new Date(d.created_at).toLocaleDateString("es-AR")} · ${categoryName(d.category_id)}</div>
              ${formatTags(d.tags)}
              ${d.description ? `<div class="muted-sm" style="margin-top:.25rem">${esc(d.description)}</div>` : ""}
              ${rejectedNote}
              ${hiddenNote}
            </td>
            <td>${esc(d.likes ?? 0)}</td>
            <td>${statusPill(status)}</td>
            <td class="right">
              <div class="actions">
                ${visibilityButton(d, status)}
                <button class="btn" data-action="edit"><i class="fa-solid fa-pen"></i> Editar</button>
                <button class="btn btn-danger" data-action="delete"><i class="fa-solid fa-trash"></i> Eliminar</button>
              </div>
            </td>
          </tr>`;
        })
        .join("");

      attachRowListeners();
    } catch (e) {
      console.error(e);
      el.rows.innerHTML = `<tr><td colspan="5">No se pudieron cargar tus diseños.</td></tr>`;
    }
  }

  function attachRowListeners() {
    el.rows.querySelectorAll("button[data-action]").forEach((btn) => {
      const tr = btn.closest("tr");
      const id = tr?.dataset?.id;
      if (!id) return;
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        if (action === "edit") openEdit(id);
        if (action === "delete") confirmDelete(id);
        if (action === "publish") togglePublished(id, true, btn);
        if (action === "unpublish") togglePublished(id, false, btn);
      });
    });
  }

  function findDesign(id) {
    return state.items.find((item) => String(item.id) === String(id));
  }

  function openEdit(id) {
    const design = findDesign(id);
    if (!design || !el.form || !el.modal) return;
    el.form.id.value = design.id;
    el.form.title.value = design.title || "";
    el.form.description.value = design.description || "";
    el.form.tags.value = Array.isArray(design.tags) ? design.tags.join(", ") : "";
    fillCategorySelect(design.category_id);
    el.form.dataset.originalTitle = (design.title || "").trim();
    el.form.dataset.originalDescription = (design.description || "").trim();
    el.form.dataset.originalTags = Array.isArray(design.tags) ? design.tags.join(", ") : "";
    el.form.dataset.originalCategory = String(design.category_id || "");
    el.form.dataset.image = design.thumbnail_url || design.image_url || "";
    el.form.dataset.status = design.review_status || (design.published ? "approved" : "pending");

    if (el.statusNote) {
      const status = displayStatus(design);
      if (status === "rejected") {
        el.statusNote.textContent = "Este diseño fue rechazado. Guarda cambios para reenviarlo a revision.";
      } else if (status === "approved") {
        el.statusNote.textContent = "Este diseño esta publicado. Al guardar cambios volvera a quedar en revision.";
      } else if (status === "approved_hidden") {
        el.statusNote.textContent = "Este diseño esta aprobado y oculto. Si solo lo publicas, no vuelve a moderacion.";
      } else {
        el.statusNote.textContent = "";
      }
    }

    setPreview(el.form.dataset.image);
    if (imageInput) imageInput.value = "";
    showMsg("", "muted-sm");
    el.modal.showModal();
  }

  el.form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!el.form) return;
    const id = el.form.id.value;
    const payload = {
      title: el.form.title.value.trim(),
      description: el.form.description.value.trim(),
      tags: normalizeTags(el.form.tags.value).join(", "),
      category_id: el.form.category_id.value,
    };
    if (!payload.title) {
      showMsg("El titulo es obligatorio.", "error");
      return;
    }

    const originalTitle = el.form.dataset.originalTitle || "";
    const originalDescription = el.form.dataset.originalDescription || "";
    const originalTags = el.form.dataset.originalTags || "";
    const originalCategory = el.form.dataset.originalCategory || "";
    const hasTextChanges =
      payload.title !== originalTitle ||
      payload.description !== originalDescription ||
      payload.tags !== originalTags ||
      String(payload.category_id) !== String(originalCategory);

    const file = imageInput?.files?.[0] || null;
    if (!hasTextChanges && !file) {
      showMsg("Sin cambios", "error");
      return;
    }

    try {
      showMsg("", "muted-sm");
      if (hasTextChanges) {
        const res = await fetch(api(`/designs/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "No se pudo actualizar");
      }

      if (file) {
        await uploadImage(id, file);
      }

      showMsg("Cambios guardados.", "ok");
      el.modal.close();
      await loadDesigns();
    } catch (err) {
      showMsg(err.message || "No se pudo actualizar.", "error");
    }
  });

  $("#btnClose")?.addEventListener("click", () => {
    el.modal?.close();
    showMsg("", "muted-sm");
    setPreview(el.form?.dataset?.image || "");
    if (imageInput) imageInput.value = "";
  });

  async function uploadImage(designId, file) {
    if (!ALLOWED.includes(file.type) || file.size > MAX_BYTES) {
      throw new Error("Imagen invalida (JPG, PNG o WEBP, max. 8 MB)");
    }
    const fd = new FormData();
    fd.append("image", file);
    const res = await fetch(api(`/designs/${designId}/image`), {
      method: "PUT",
      headers: { ...authHeaders() },
      body: fd,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "No se pudo actualizar la imagen");
    return data;
  }

  async function togglePublished(id, published, btn) {
    const design = findDesign(id);
    if (!design) return;
    const message = published
      ? "¿Publicar este diseño aprobado en la galeria?"
      : "¿Despublicar este diseño? Podras volver a publicarlo sin moderacion si no lo modificas.";
    if (!confirm(message)) return;
    try {
      btn.disabled = true;
      const res = await fetch(api(`/designs/${id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ published }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "No se pudo cambiar la publicacion");
      await loadDesigns();
    } catch (err) {
      alert(err.message || "No se pudo cambiar la publicacion.");
      btn.disabled = false;
    }
  }

  async function confirmDelete(id) {
    if (!confirm("¿Eliminar este diseño? Esta accion no se puede deshacer.")) return;
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
