(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);

  const form = $("#formUpload");
  const sel = $("#selCategory");
  const file = $("#file");
  const preview = $("#preview");
  const previewGrid = $("#previewGrid");
  const msg = $("#msg");
  const btn = $("#btnSave");
  const titleInput = form?.elements?.title || $("#formUpload input[name='title']");
  const descInput = form?.elements?.description || $("#formUpload textarea[name='description']");

  const token = localStorage.getItem("token") || "";
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});
  let previewSeq = 0;

  // ---------- Utils de UI ----------
  function showMsg(text, type = "muted") {
    if (!msg) return;
    msg.className = type;      // "muted" | "error" | "ok"
    msg.textContent = text || "";
  }
  function clearMockupCards() {
    if (!previewGrid) return;
    previewGrid.querySelectorAll("[data-mockup-card]").forEach((card) => card.remove());
  }
  const showMockupLoading = (seq) => {
    if (!previewGrid) return;
    let card = previewGrid.querySelector("[data-mockup-loading]");
    if (!card) {
      card = document.createElement("div");
      card.className = "preview-card";
      card.dataset.mockupLoading = "1";
      const title = document.createElement("h4");
      title.textContent = "Generando mockups…";
      const text = document.createElement("p");
      text.className = "muted";
      text.style.margin = "0";
      text.textContent = "Esto puede demorar unos segundos.";
      const spinner = document.createElement("div");
      spinner.className = "loading-spinner";
      card.appendChild(title);
      card.appendChild(text);
      card.appendChild(spinner);
      previewGrid.appendChild(card);
    }
    if (typeof seq !== "undefined") card.dataset.seq = String(seq);
  };
  const hideMockupLoading = (seq) => {
    if (!previewGrid) return;
    const card = previewGrid.querySelector("[data-mockup-loading]");
    if (!card) return;
    if (seq && card.dataset.seq && card.dataset.seq !== String(seq)) return;
    card.remove();
  };
  const ensureFieldMsg = (input) => {
    if (!input || !input.parentElement) return null;
    let small = input.parentElement.querySelector(".input-msg");
    if (!small) {
      small = document.createElement("small");
      small.className = "input-msg";
      input.parentElement.appendChild(small);
    }
    return small;
  };
  const fieldError = (input, text) => {
    const small = ensureFieldMsg(input);
    if (small) {
      small.textContent = text || "";
      small.classList.remove("ok");
      small.classList.add("error");
    }
    input?.classList.add("is-invalid");
    input?.classList.remove("is-valid");
    return false;
  };
  const fieldOK = (input, text = "") => {
    const small = ensureFieldMsg(input);
    if (small) {
      small.textContent = text;
      small.classList.remove("error");
      small.classList.add("ok");
    }
    input?.classList.remove("is-invalid");
    input?.classList.add("is-valid");
    return true;
  };
  const fieldNeutral = (input) => {
    const small = ensureFieldMsg(input);
    if (small) {
      small.textContent = "";
      small.classList.remove("error");
      small.classList.remove("ok");
    }
    input?.classList.remove("is-invalid");
    input?.classList.remove("is-valid");
  };

  function resetPreview() {
    if (preview) {
      preview.removeAttribute("src");
      preview.style.display = "none";
    }
    clearMockupCards();
    hideMockupLoading();
  }

  function renderMockupCards(items) {
    clearMockupCards();
    if (!previewGrid || !Array.isArray(items)) return;
    items.forEach((item) => {
      if (!item?.image) return;
      const productName = item.product_name || "Mockup";
      const card = document.createElement("div");
      card.className = "preview-card";
      card.dataset.mockupCard = "1";
      const title = document.createElement("h4");
      title.textContent = productName;
      const img = document.createElement("img");
      img.className = "preview-img";
      img.src = item.image;
      img.alt = `Mockup ${productName}`;
      img.style.display = "block";
      card.appendChild(title);
      card.appendChild(img);
      previewGrid.appendChild(card);
    });
  }

  async function updateMockupPreview(file, seq) {
    if (!previewGrid) return;
    clearMockupCards();
    showMockupLoading(seq);

    const fd = new FormData();
    fd.append("image", file);

    try {
      const res = await fetch(api("/designs/mockup-preview"), {
        method: "POST",
        headers: { ...authHeaders() },
        body: fd,
      });

      if (res.status === 401) {
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/login.html?next=${next}`;
        return;
      }

      if (!res.ok) throw new Error("No se pudo generar el mockup.");
      const data = await safeJSON(res);

      if (seq !== previewSeq) return; // respuesta desactualizada

      if (Array.isArray(data?.mockups)) {
        renderMockupCards(data.mockups);
      } else if (data?.mockup) {
        renderMockupCards([{ product_name: "Mockup", image: data.mockup }]);
      }
      hideMockupLoading(seq);
    } catch (err) {
      if (seq === previewSeq) {
        clearMockupCards();
        showMsg("No se pudo generar la vista previa del mockup. Podés continuar con la carga.", "muted");
        hideMockupLoading(seq);
      }
    }
  }

  // ---------- Vista previa (modo seguro con FileReader) ----------
  const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

  const validateFile = () => {
    const f = file?.files?.[0];
    if (!f) {
      resetPreview();
      return fieldError(file, "Seleccioná una imagen.");
    }

    if (!ALLOWED.includes(f.type)) {
      showMsg("Formato no permitido. Usá JPG, PNG o WEBP.", "error");
      file.value = "";
      resetPreview();
      return fieldError(file, "Formato no permitido.");
    }

    if (f.size > MAX_BYTES) {
      showMsg("La imagen supera los 8 MB.", "error");
      file.value = "";
      resetPreview();
      return fieldError(file, "El archivo supera los 8 MB.");
    }

    fieldOK(file, "Imagen lista.");
    return f;
  };

  file?.addEventListener("change", () => {
    showMsg("", "muted");

    const f = validateFile();
    if (!f) return;

    const seq = ++previewSeq;
    const reader = new FileReader();
    reader.onload = (e) => {
      preview.src = e.target.result;
      preview.alt = "Vista previa";
      preview.style.display = "block";
      // console.log("Vista previa cargada correctamente");
    };
    reader.onerror = () => {
      showMsg("No se pudo generar la vista previa.", "error");
      resetPreview();
    };
    reader.readAsDataURL(f);
    updateMockupPreview(f, seq);
  });

  // ---------- Categorías ----------
  async function loadCategories() {
    try {
      const res = await fetch(api("/categories"), { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("no-ok");
      const cats = await res.json();
      fillCats(cats);
    } catch {
      // Fallback por si el endpoint no existe aún
      fillCats([
        { id: "abstracto", name: "Abstracto" },
        { id: "tipografia", name: "Tipografía" },
        { id: "animales", name: "Animales" },
        { id: "naturaleza", name: "Naturaleza" },
        { id: "deportes", name: "Deportes" },
        { id: "gaming", name: "Gaming" },
        { id: "otros", name: "Otros" },
      ]);
    }
  }

  function fillCats(cats = []) {
    sel.innerHTML = '<option value="">Elegí una categoría</option>';
    cats.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id || c.category_id || c.value || c.slug || c.name;
      opt.textContent = c.name || c.title || String(opt.value);
      sel.appendChild(opt);
    });
  }

  // ---------- Validaciones ----------
  const validators = {
    title: () => {
      const value = titleInput?.value.trim() || "";
      if (value.length < 3) return fieldError(titleInput, "Mínimo 3 caracteres.");
      return fieldOK(titleInput);
    },
    description: () => {
      const value = descInput?.value.trim() || "";
      if (value.length < 10) return fieldError(descInput, "Describí tu diseño en al menos 10 caracteres.");
      return fieldOK(descInput);
    },
    category: () => {
      if (!sel?.value) return fieldError(sel, "Elegí una categoría.");
      return fieldOK(sel);
    },
    image: () => !!validateFile(),
  };

  titleInput?.addEventListener("input", validators.title);
  descInput?.addEventListener("input", validators.description);
  sel?.addEventListener("change", validators.category);

  // ---------- Envío ----------
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("", "muted");

    const valResults = [
      validators.title?.(),
      validators.description?.(),
      validators.category?.(),
      validators.image?.(),
    ];
    if (valResults.some((v) => v === false)) {
      showMsg("Revisá los campos marcados.", "error");
      return;
    }

    const fd = new FormData(form);

    btn.disabled = true;
    const oldTxt = btn.textContent;
    btn.textContent = "Guardando…";

    try {
      const res = await fetch(api("/designs"), {
        method: "POST",
        headers: { ...authHeaders() }, // no agregamos Content-Type para que el boundary lo maneje el navegador
        body: fd,
      });

      if (!res.ok) {
        const t = await safeText(res);
        throw new Error(t || `Error ${res.status}`);
      }

      const data = await safeJSON(res);
      const notice = data?.message || "Tu diseño fue enviado y quedará en revisión.";
      showMsg(notice, "ok");
      form.reset();
      resetPreview();
      [titleInput, descInput, sel, file].forEach((input) => input && fieldNeutral(input));
      if (sel) sel.selectedIndex = 0;
    } catch (err) {
      showMsg(err?.message || "No se pudo guardar el diseño.", "error");
      // console.error(err);
    } finally {
      btn.disabled = false;
      btn.textContent = oldTxt;
    }
  });

  function safeJSON(res) { return res.clone().json().catch(() => ({})); }
  function safeText(res) { return res.clone().text().catch(() => ""); }

  // boot
  loadCategories();
})();
