(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (value = "") =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const wrap = $("#designerContent");
  const backBtn = $("#btnBack");
  const params = new URLSearchParams(location.search);
  const alias = (params.get("alias") || "").trim();
  const state = {
    categories: [],
    debounce: null,
    filters: {
      search: (params.get("search") || "").trim(),
      order: params.get("order") || "popular",
      category: (params.get("category") || "").trim(),
      min_likes: params.get("min_likes") || "0"
    }
  };

  setupBackButton();

  function setupBackButton() {
    if (!backBtn) return;

    let target = "/designers.html";
    const returnTo = params.get("returnTo");

    if (returnTo) {
      try {
        const url = new URL(returnTo, location.origin);
        if (url.origin === location.origin && url.pathname !== "/designer.html") {
          target = `${url.pathname}${url.search}${url.hash}`;
        }
      } catch {}
    } else if (document.referrer) {
      try {
        const ref = new URL(document.referrer);
        if (ref.origin === location.origin && ref.pathname !== "/designer.html") {
          target = `${ref.pathname}${ref.search}${ref.hash}`;
        }
      } catch {}
    }

    backBtn.href = target;
    backBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      location.href = target;
    });
  }

  function renderError(message) {
    if (!wrap) return;
    wrap.innerHTML = `<div class="error-box">${esc(message || "No se pudo cargar el perfil.")}</div>`;
  }

  function tagsMarkup(tags = []) {
    if (!Array.isArray(tags) || !tags.length) return "";
    return `<div class="tag-list">${tags.map((tag) => `<span class="tag-chip">${esc(tag)}</span>`).join("")}</div>`;
  }

  function categoryOptions(selectedId = "") {
    return ['<option value="">Todas las categorias</option>']
      .concat(
        state.categories.map(
          (category) =>
            `<option value="${esc(category.id)}" ${String(category.id) === String(selectedId) ? "selected" : ""}>${esc(category.name)}</option>`
        )
      )
      .join("");
  }

  function hasActiveFilters(filters) {
    return Boolean(filters.search) ||
      filters.order !== "popular" ||
      Boolean(filters.category) ||
      Number(filters.min_likes) > 0;
  }

  function getFiltersFromForm() {
    const form = $("#designer-design-filters");
    if (!form) return { ...state.filters };
    const data = new FormData(form);
    return {
      search: (data.get("search") || "").toString().trim(),
      order: (data.get("order") || "popular").toString(),
      category: (data.get("category") || "").toString().trim(),
      min_likes: (data.get("min_likes") || "0").toString()
    };
  }

  function buildProfileUrl(filters) {
    const query = new URLSearchParams();
    if (filters.search) query.set("search", filters.search);
    if (filters.order && filters.order !== "popular") query.set("order", filters.order);
    if (filters.category) query.set("category", filters.category);
    if (Number(filters.min_likes) > 0) query.set("min_likes", filters.min_likes);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return api(`/designers/profile/${encodeURIComponent(alias)}${suffix}`);
  }

  function designCard(d) {
    return `
      <a class="design-card" href="/design.html?id=${encodeURIComponent(d.id)}">
        <div class="thumb">
          <img src="${esc(d.thumbnail_url || d.image_url)}" alt="${esc(d.title)}"/>
        </div>
        <div class="body">
          <div class="title">${esc(d.title)}</div>
          <div class="meta">
            <span><i class="fa-solid fa-heart"></i> ${esc(d.likes ?? 0)}</span>
            ${d.category_name ? `<span>${esc(d.category_name)}</span>` : ""}
          </div>
          ${tagsMarkup(d.tags)}
          <span class="muted" style="font-size:.78rem">${new Date(d.created_at).toLocaleDateString("es-AR")}</span>
        </div>
      </a>
    `;
  }

  function renderProfile(data, filters) {
    const info = data.designer || {};
    const designs = Array.isArray(data.designs) ? data.designs : [];
    const likesText = `${info.stats?.likes_published ?? 0} like${(info.stats?.likes_published ?? 0) === 1 ? "" : "s"}`;
    const designsText = `${info.stats?.designs_published ?? designs.length} diseño${(info.stats?.designs_published ?? designs.length) === 1 ? "" : "s"}`;
    const active = hasActiveFilters(filters);

    wrap.innerHTML = `
      <section class="designer-hero">
        <div class="designer-avatar">
          <img src="${esc(info.avatar_url || "/img/uploads/avatars/default.png")}" alt="Avatar de ${esc(info.username || "diseñador")}"/>
        </div>
        <div class="designer-meta">
          <div>
            <h1 style="margin:0">${esc(info.username || "diseñador")}</h1>
            ${info.display_name && info.display_name !== info.username ? `<p class="muted" style="margin-top:.25rem">${esc(info.display_name)}</p>` : ""}
          </div>
          <div class="designer-stats">
            <span><i class="fa-solid fa-images"></i> ${esc(designsText)}</span>
            <span><i class="fa-solid fa-heart"></i> ${esc(likesText)}</span>
          </div>
          ${info.member_since ? `<p class="muted" style="font-size:.9rem">En la comunidad desde ${new Date(info.member_since).toLocaleDateString("es-AR")}</p>` : ""}
        </div>
      </section>

      <section class="designer-designs">
        <div class="designer-designs-head">
          <h2>Diseños publicados</h2>
          <span class="muted-sm">${designs.length} resultado${designs.length === 1 ? "" : "s"}</span>
        </div>

        <form class="filters-card designer-filters" id="designer-design-filters">
          <div class="field">
            <label for="designer-design-search">Buscar diseño</label>
            <input type="search" id="designer-design-search" name="search" placeholder="Titulo, descripcion o tag" value="${esc(filters.search)}" autocomplete="off"/>
          </div>
          <div class="field half">
            <label for="designer-design-order">Ordenar por</label>
            <select id="designer-design-order" name="order">
              <option value="popular" ${filters.order === "popular" ? "selected" : ""}>Popularidad</option>
              <option value="newest" ${filters.order === "newest" ? "selected" : ""}>Mas recientes</option>
              <option value="oldest" ${filters.order === "oldest" ? "selected" : ""}>Mas antiguos</option>
              <option value="alpha" ${filters.order === "alpha" ? "selected" : ""}>Titulo A-Z</option>
            </select>
          </div>
          <div class="field half">
            <label for="designer-design-category">Categoria</label>
            <select id="designer-design-category" name="category">
              ${categoryOptions(filters.category)}
            </select>
          </div>
          <div class="field half">
            <label for="designer-design-min-likes">Likes minimos</label>
            <select id="designer-design-min-likes" name="min_likes">
              <option value="0" ${String(filters.min_likes) === "0" ? "selected" : ""}>Todos</option>
              <option value="5" ${String(filters.min_likes) === "5" ? "selected" : ""}>5+ likes</option>
              <option value="10" ${String(filters.min_likes) === "10" ? "selected" : ""}>10+ likes</option>
              <option value="25" ${String(filters.min_likes) === "25" ? "selected" : ""}>25+ likes</option>
            </select>
          </div>
          <div class="meta">
            <div>${active ? "Filtrando resultados" : "Todos los diseños"}</div>
            <button type="button" class="btn btn-outline" id="designer-design-clear" ${active ? "" : "disabled"}>
              <i class="fa-solid fa-eraser"></i> Limpiar
            </button>
          </div>
        </form>

        ${designs.length
          ? `<div class="design-grid">${designs.map(designCard).join("")}</div>`
          : `<p class="muted designer-empty">No encontramos diseños con esos filtros.</p>`}
      </section>
    `;

    attachFilterListeners();
  }

  function attachFilterListeners() {
    const form = $("#designer-design-filters");
    if (!form) return;
    const searchInput = $("#designer-design-search", form);
    const clearBtn = $("#designer-design-clear", form);

    searchInput?.addEventListener("input", () => {
      clearTimeout(state.debounce);
      state.debounce = setTimeout(() => {
        loadProfile(getFiltersFromForm());
      }, 280);
    });

    form.addEventListener("change", (event) => {
      if (event.target === searchInput) return;
      loadProfile(getFiltersFromForm());
    });

    clearBtn?.addEventListener("click", () => {
      loadProfile({
        search: "",
        order: "popular",
        category: "",
        min_likes: "0"
      });
    });
  }

  async function loadCategories() {
    try {
      const res = await fetch(api("/categories"), { cache: "no-store" });
      if (!res.ok) throw new Error("categories_fetch_error");
      state.categories = await res.json();
    } catch {
      state.categories = [];
    }
  }

  async function loadProfile(filters = state.filters) {
    state.filters = { ...filters };
    if (!alias) {
      renderError("Alias no especificado.");
      return;
    }
    if (!wrap) return;
    if (!$("#designer-design-filters")) {
      wrap.innerHTML = `<div class="card" style="padding:1.5rem">Cargando perfil de <strong>${esc(alias)}</strong>...</div>`;
    }
    try {
      const res = await fetch(buildProfileUrl(state.filters), { cache: "no-store" });
      if (res.status === 404) {
        renderError("No encontramos a este diseñador.");
        return;
      }
      if (!res.ok) throw new Error("No se pudo cargar el perfil.");
      const data = await res.json();
      renderProfile(data, state.filters);
    } catch (err) {
      renderError(err?.message || "No se pudo cargar el perfil.");
    }
  }

  async function boot() {
    await loadCategories();
    await loadProfile();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
