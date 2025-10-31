// /public/js/designs.js
(() => {
  const API = (path) => (path.startsWith("/api") ? path : `/api${path}`);
  const form = document.getElementById("designs-filters");
  const grid = document.getElementById("designs-grid");
  const emptyEl = document.getElementById("designs-empty");
  const loadMoreBtn = document.getElementById("load-more-designs");
  const totalEl = document.getElementById("designs-total");
  const activeFilterEl = document.getElementById("designs-active-filter");

  const searchInput = document.getElementById("design-search");
  const categorySelect = document.getElementById("design-category");
  const designerInput = document.getElementById("design-designer");

  if (!form || !grid || !emptyEl) return;

  const state = {
    page: 1,
    limit: 12,
    loading: false,
    total: 0,
    loaded: 0
  };

  const formatNumber = new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 0
  });
  const originalLoadMoreMarkup = loadMoreBtn ? loadMoreBtn.innerHTML : "";

  const getFilters = () => {
    const data = new FormData(form);
    const normalizeDesigner = (value) => {
      if (!value) return "";
      const trimmed = value.toString().trim();
      if (!trimmed) return "";
      return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
    };
    return {
      search: (data.get("search") || "").toString().trim(),
      order: (data.get("order") || "popular").toString(),
      category: (data.get("category") || "").toString().trim(),
      min_likes: (data.get("min_likes") || "0").toString(),
      designer: normalizeDesigner(data.get("designer"))
    };
  };

  const hasActiveFilters = (filters) =>
    Boolean(filters.search) ||
    filters.order !== "popular" ||
    Boolean(filters.category) ||
    Number(filters.min_likes) > 0 ||
    Boolean(filters.designer);

  const setSummary = (filters) => {
    if (totalEl) {
      const showing = Math.min(state.loaded, state.total);
      if (state.total === 0) {
        totalEl.textContent = "Sin resultados";
      } else {
        totalEl.textContent = `Mostrando ${formatNumber.format(showing)} de ${formatNumber.format(state.total)}`;
      }
    }
    if (activeFilterEl) {
      activeFilterEl.style.display = hasActiveFilters(filters) ? "block" : "none";
    }
  };

  const buildCard = (design) => {
    const card = document.createElement("a");
    card.className = "design-card";
    card.href = `/design.html?id=${encodeURIComponent(design.id)}`;
    card.setAttribute("aria-label", `Ver detalle de ${design.title}`);

    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const img = document.createElement("img");
    img.src = design.thumbnail_url || design.image_url;
    img.alt = design.title;
    img.loading = "lazy";
    thumb.appendChild(img);

    const body = document.createElement("div");
    body.className = "body";

    const title = document.createElement("h3");
    title.textContent = design.title;

    const designer = document.createElement("div");
    designer.className = "designer";
    designer.innerHTML = `<i class="fa-solid fa-user" aria-hidden="true"></i> ${design.designer?.name ?? "Anónimo"}`;

    const meta = document.createElement("div");
    meta.className = "meta";
    const likes = document.createElement("span");
    likes.innerHTML = `<i class="fa-solid fa-heart" aria-hidden="true"></i> ${formatNumber.format(design.likes ?? 0)}`;
    const date = document.createElement("span");
    const created = design.created_at ? new Date(design.created_at) : null;
    date.innerHTML = `<i class="fa-solid fa-clock" aria-hidden="true"></i> ${
      created ? created.toLocaleDateString("es-AR") : ""
    }`;
    meta.appendChild(likes);
    meta.appendChild(date);

    if (design.category?.name) {
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = design.category.name;
      body.appendChild(badge);
    }

    body.appendChild(title);
    body.appendChild(designer);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.innerHTML = `<span>Ver diseño <i class="fa-solid fa-arrow-right-long" aria-hidden="true"></i></span>`;

    card.appendChild(thumb);
    card.appendChild(body);
    card.appendChild(actions);

    if (design.designer?.username) {
      designer.innerHTML = `<i class="fa-solid fa-user" aria-hidden="true"></i> @${design.designer.username}`;
      designer.title = design.designer.name ?? design.designer.username;
    }

    return card;
  };

  const setLoading = (loading, append) => {
    state.loading = loading;
    grid.setAttribute("aria-busy", loading ? "true" : "false");
    if (loading && !append) {
      grid.innerHTML = `
        <article class="design-card skeleton" aria-hidden="true">
          <div class="thumb"></div>
          <div class="body">
            <div class="badge"></div>
            <h3></h3>
            <div class="designer"></div>
            <div class="meta"><span></span><span></span></div>
          </div>
        </article>`;
    }
    if (loadMoreBtn) {
      loadMoreBtn.disabled = loading;
      if (loading && append) {
        loadMoreBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando…`;
      } else if (!loading) {
        loadMoreBtn.innerHTML = originalLoadMoreMarkup;
      }
    }
  };

  const renderDesigns = (items, append) => {
    if (!append) {
      grid.innerHTML = "";
    }

    if (!items.length && !append) {
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";
    const fragment = document.createDocumentFragment();
    items.forEach((design) => {
      fragment.appendChild(buildCard(design));
    });
    grid.appendChild(fragment);
  };

  const updateLoadMoreVisibility = () => {
    if (!loadMoreBtn) return;
    const remaining = state.total - state.loaded;
    loadMoreBtn.style.display = remaining > 0 ? "inline-flex" : "none";
  };

  const fetchDesigns = async ({ append = false } = {}) => {
    if (state.loading) return;
    const filters = getFilters();
    const nextPage = append ? state.page + 1 : 1;

    if (!append) {
      state.loaded = 0;
      state.page = 1;
      state.total = 0;
      emptyEl.style.display = "none";
    }

    setLoading(true, append);

    try {
      const params = new URLSearchParams({
        ...filters,
        page: String(nextPage),
        limit: String(state.limit)
      });

      const response = await fetch(API(`/designs?${params.toString()}`), {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("fetch_failed");
      }

      const data = await response.json();
      const items = Array.isArray(data?.designs) ? data.designs : [];

      renderDesigns(items, append);

      state.page = nextPage;
      state.total = data?.total ?? items.length;
      state.loaded += items.length;

      setSummary(filters);
      updateLoadMoreVisibility();
    } catch (error) {
      console.error("No se pudieron cargar los diseños:", error);
      if (!append) {
        grid.innerHTML = "";
        emptyEl.textContent = "No se pudieron cargar los diseños. Intentá nuevamente.";
        emptyEl.style.display = "block";
      }
    } finally {
      setLoading(false, append);
    }
  };

  const loadCategories = async () => {
    if (!categorySelect) return;
    categorySelect.disabled = true;
    categorySelect.innerHTML = `<option value="">Cargando categorías…</option>`;
    try {
      const response = await fetch(API("/categories"), { cache: "no-store" });
      if (!response.ok) throw new Error("categories_fetch_error");
      const items = await response.json();
      const options = ['<option value="">Todas las categorías</option>']
        .concat(
          (items || []).map(
            (item) => `<option value="${item.id}">${item.name}</option>`
          )
        );
      categorySelect.innerHTML = options.join("");
    } catch (error) {
      console.error("No se pudieron cargar las categorías:", error);
      categorySelect.innerHTML = `<option value="">Todas las categorías</option>`;
    } finally {
      categorySelect.disabled = false;
    }
  };

  let searchDebounce = null;
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        fetchDesigns({ append: false });
      }, 280);
    });
  }

  if (designerInput) {
    designerInput.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        fetchDesigns({ append: false });
      }, 280);
    });
  }

  form.addEventListener("change", (event) => {
    if (event.target === searchInput || event.target === designerInput) return;
    fetchDesigns({ append: false });
  });

  if (categorySelect) {
    loadCategories().catch(() => {});
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      fetchDesigns({ append: true });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => fetchDesigns({ append: false }),
      { once: true }
    );
  } else {
    fetchDesigns({ append: false });
  }
})();
