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

  function resetPreview() {
    if (preview) {
      preview.removeAttribute("src");
      preview.style.display = "none";
    }
    clearMockupCards();
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
    } catch (err) {
      if (seq === previewSeq) {
        clearMockupCards();
        showMsg("No se pudo generar la vista previa del mockup. Podés continuar con la carga.", "muted");
      }
    }
  }

  // ---------- Vista previa (modo seguro con FileReader) ----------
  const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

  file?.addEventListener("change", () => {
    showMsg("", "muted");

    const f = file.files?.[0];
    if (!f) {
      resetPreview();
      return;
    }

    if (!ALLOWED.includes(f.type)) {
      showMsg("Formato no permitido. Usá JPG, PNG o WEBP.", "error");
      file.value = "";
      resetPreview();
      return;
    }

    if (f.size > MAX_BYTES) {
      showMsg("La imagen supera los 8 MB.", "error");
      file.value = "";
      resetPreview();
      return;
    }

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
    sel.innerHTML = "";
    cats.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id || c.category_id || c.value || c.slug || c.name;
      opt.textContent = c.name || c.title || String(opt.value);
      sel.appendChild(opt);
    });
  }

  // ---------- Envío ----------
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    showMsg("", "muted");

    const f = file?.files?.[0];
    if (!f) {
      showMsg("Seleccioná una imagen.", "error");
      return;
    }
    if (!ALLOWED.includes(f.type) || f.size > MAX_BYTES) {
      showMsg("Imagen inválida. Verificá formato y tamaño (máx. 8 MB).", "error");
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
