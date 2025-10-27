(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);

  const form = $("#formUpload");
  const sel = $("#selCategory");
  const file = $("#file");
  const preview = $("#preview");
  const mockupWrap = $("#mockupWrap");
  const mockupImg = $("#mockupImg");
  const msg = $("#msg");
  const btn = $("#btnSave");

  const token = localStorage.getItem("token") || "";
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  // ---------- Utils de UI ----------
  function showMsg(text, type = "muted") {
    if (!msg) return;
    msg.className = type;      // "muted" | "error" | "ok"
    msg.textContent = text || "";
  }
  function resetPreview() {
    if (preview) {
      preview.removeAttribute("src");
      preview.style.display = "none";
    }
    if (mockupWrap) mockupWrap.style.display = "none";
    if (mockupImg) mockupImg.removeAttribute("src");
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
      if (data?.mockup_remera && mockupWrap && mockupImg) {
        mockupImg.src = data.mockup_remera;
        mockupWrap.style.display = "block";
      }
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
