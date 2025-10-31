// /public/js/designers.js
(() => {
  const API = (path) => (path.startsWith("/api") ? path : `/api${path}`);
  const form = document.getElementById("designer-filters");
  const grid = document.getElementById("designers-grid");
  const emptyEl = document.getElementById("designers-empty");
  const loadMoreBtn = document.getElementById("load-more");
  const totalEl = document.getElementById("designer-total");
  const activeFilterEl = document.getElementById("designer-active-filter");
  const searchInput = document.getElementById("designer-search");
  const categorySelect = document.getElementById("designer-category");

  if (!form || !grid || !emptyEl) return;

  const state = {
    page: 1,
    limit: 12,
    loading: false,
    total: 0,
    loaded: 0
  };

  const formatNumber = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });
  const originalLoadMoreMarkup = loadMoreBtn ? loadMoreBtn.innerHTML : "";

  const getFilters = () => {
    const data = new FormData(form);
    return {
      search: (data.get("search") || "").toString().trim(),
      order: (data.get("order") || "popular").toString(),
      min_designs: (data.get("min_designs") || "0").toString(),
      min_likes: (data.get("min_likes") || "0").toString(),
      category: (data.get("category") || "").toString().trim()
    };
  };

  const hasActiveFilters = (filters) =>
    Boolean(filters.search) ||
    filters.order !== "popular" ||
    Number(filters.min_designs) > 0 ||
    Number(filters.min_likes) > 0 ||
    Boolean(filters.category);

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

  const buildCard = (designer) => {
    const card = document.createElement("a");
    card.className = "designer-card";
    card.href = `/designer.html?alias=${encodeURIComponent(designer.username || designer.id)}`;
    card.setAttribute("aria-label", `Ver perfil de ${designer.display_name}`);

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const img = document.createElement("img");
    img.src = designer.avatar_url;
    img.alt = `Avatar de ${designer.display_name}`;
    img.loading = "lazy";
    avatar.appendChild(img);

    const name = document.createElement("h3");
    name.textContent = designer.display_name;

    card.appendChild(avatar);
    card.appendChild(name);

    if (designer.username) {
      const username = document.createElement("div");
      username.className = "username";
      username.textContent = `@${designer.username}`;
      card.appendChild(username);
    }
    const stats = document.createElement("div");
    stats.className = "stats";
    stats.innerHTML = `
      <span title="Diseños"><i class="fa-solid fa-palette" aria-hidden="true"></i> ${formatNumber.format(designer.stats?.designs ?? 0)}</span>
      <span title="Me gusta"><i class="fa-solid fa-heart" aria-hidden="true"></i> ${formatNumber.format(designer.stats?.likes ?? 0)}</span>
    `;
    card.appendChild(stats);

    return card;
  };

  const setLoading = (loading, append) => {
    state.loading = loading;
    grid.setAttribute("aria-busy", loading ? "true" : "false");
    if (loading && !append) {
      grid.innerHTML = `
        <article class="designer-card skeleton" aria-hidden="true">
          <div class="avatar"></div>
          <h3></h3>
          <div class="username"></div>
          <div class="stats">
            <span></span>
            <span></span>
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

  const renderDesigners = (items, append) => {
    if (!append) {
      grid.innerHTML = "";
    }

    if (!items.length && !append) {
      emptyEl.style.display = "block";
      return;
    }

    emptyEl.style.display = "none";
    const fragment = document.createDocumentFragment();
    items.forEach((designer) => {
      fragment.appendChild(buildCard(designer));
    });
    grid.appendChild(fragment);
  };

  const updateLoadMoreVisibility = () => {
    if (!loadMoreBtn) return;
    const remaining = state.total - state.loaded;
    loadMoreBtn.style.display = remaining > 0 ? "inline-flex" : "none";
  };

  const fetchDesigners = async ({ append = false } = {}) => {
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

      const response = await fetch(API(`/designers?${params.toString()}`), {
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error("fetch_failed");
      }

      const data = await response.json();
      const items = Array.isArray(data?.designers) ? data.designers : [];

      renderDesigners(items, append);

      state.page = nextPage;
      state.total = data?.total ?? items.length;
      state.loaded += items.length;

      setSummary(filters);
      updateLoadMoreVisibility();
    } catch (error) {
      console.error("No se pudieron cargar los diseñadores:", error);
      if (!append) {
        grid.innerHTML = "";
        emptyEl.textContent = "No se pudieron cargar los diseñadores. Intentá nuevamente.";
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
            (item) =>
              `<option value="${item.id}">${item.name}</option>`
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
        fetchDesigners({ append: false });
      }, 280);
    });
  }

  form.addEventListener("change", (event) => {
    if (event.target === searchInput) return;
    fetchDesigners({ append: false });
  });

  if (categorySelect) {
    loadCategories().catch(() => {});
  }

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      fetchDesigners({ append: true });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      () => fetchDesigners({ append: false }),
      { once: true }
    );
  } else {
    fetchDesigners({ append: false });
  }
})();
