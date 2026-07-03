(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);

  const token = localStorage.getItem("token") || "";
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  const form = $("#formProfile");
  const msgProfile = $("#msgProfile");
  const avatarForm = $("#formAvatar");
  const avatarFile = $("#avatarFile");
  const avatarPreview = $("#avatarPreview");
  const msgAvatar = $("#msgAvatar");
  const statDesigns = $("#statDesigns");
  const statLikes = $("#statLikes");
  const payoutSection = $("#payoutSection");

  const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  const MAX_BYTES = 4 * 1024 * 1024;
  const POSTAL_RE = /^\d{4}$|^[A-Z]\d{4}[A-Z]{3}$/;
  let currentAvatar = "/img/disenador1.jpg";
  let payoutVisible = false;

  function redirectLogin() {
    const next = encodeURIComponent(location.pathname + location.search);
    location.href = `/login.html?next=${next}`;
  }

  function showMsg(node, text, type) {
    if (!node) return;
    node.textContent = text || "";
    node.classList.remove("ok", "error");
    if (type) node.classList.add(type);
  }

  function digits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizePostal(value) {
    return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  function setField(name, value) {
    if (form?.[name]) form[name].value = value || "";
  }

  function shouldShowPayout(user, designer) {
    const preference = user?.use_preference || "buy";
    return (
      user?.role === "designer" ||
      preference === "upload" ||
      Number(designer?.stats?.designs || 0) > 0
    );
  }

  function syncPayoutVisibility(user, designer) {
    payoutVisible = shouldShowPayout(user, designer);
    if (payoutSection) {
      payoutSection.style.display = payoutVisible ? "grid" : "none";
    }
  }

  function applyProfile(data) {
    if (!data) return;
    const designer = data.designer || {};
    const persona = data.persona || {};
    const user = data.user || {};
    const address = data.address || {};

    if (form) {
      setField("username", user.username);
      setField("email", user.email);
      setField("use_preference", user.use_preference || "buy");
      setField("first_name", persona.first_name);
      setField("last_name", persona.last_name);
      setField("dni", persona.dni);
      setField("phone", address.phone);
      setField("country", address.country || "Argentina");
      setField("province", address.province);
      setField("city", address.city);
      setField("street", address.street);
      setField("street_number", address.street_number);
      setField("floor_apartment", address.floor_apartment);
      setField("postal_code", address.postal_code);
      setField("notes", address.notes);
      setField("payout_alias", designer.payout_alias);
      setField("payout_cbu", designer.payout_cbu);
    }

    syncPayoutVisibility(user, designer);

    currentAvatar = designer.avatar_url || currentAvatar;
    if (avatarPreview) {
      avatarPreview.src = currentAvatar;
    }
    if (avatarFile) avatarFile.value = "";

    if (statDesigns) {
      statDesigns.textContent = designer.stats?.designs ?? 0;
    }
    if (statLikes) {
      statLikes.textContent = designer.stats?.likes ?? 0;
    }
  }

  async function loadProfile() {
    if (!token) {
      redirectLogin();
      return;
    }
    showMsg(msgProfile, "", "");
    try {
      const res = await fetch(api("/designers/me"), {
        headers: { Accept: "application/json", ...authHeaders() },
        cache: "no-store"
      });
      if (res.status === 401) {
        redirectLogin();
        return;
      }
      if (!res.ok) throw new Error("No se pudo cargar tu perfil.");
      const data = await res.json();
      applyProfile(data);
    } catch (e) {
      showMsg(msgProfile, e.message || "Error al cargar tu perfil.", "error");
    }
  }

  form?.use_preference?.addEventListener("change", () => {
    syncPayoutVisibility({ use_preference: form.use_preference.value }, {});
  });

  form?.phone?.addEventListener("input", () => {
    form.phone.value = digits(form.phone.value).slice(0, 10);
  });

  form?.payout_cbu?.addEventListener("input", () => {
    form.payout_cbu.value = digits(form.payout_cbu.value).slice(0, 22);
  });

  form?.postal_code?.addEventListener("blur", () => {
    form.postal_code.value = normalizePostal(form.postal_code.value);
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!token) {
      redirectLogin();
      return;
    }

    const phone = digits(form.phone.value);
    const postalCode = normalizePostal(form.postal_code.value);
    const payload = {
      username: form.username.value.trim(),
      email: form.email.value.trim().toLowerCase(),
      use_preference: form.use_preference.value,
      phone,
      country: form.country.value.trim() || "Argentina",
      province: form.province.value,
      city: form.city.value.trim(),
      street: form.street.value.trim(),
      street_number: form.street_number.value.trim(),
      floor_apartment: form.floor_apartment.value.trim(),
      postal_code: postalCode,
      notes: form.notes.value.trim()
    };

    if (!payload.username) {
      showMsg(msgProfile, "El alias no puede quedar vacio.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
      showMsg(msgProfile, "Ingresá un email válido.", "error");
      return;
    }
    if (!/^\d{10}$/.test(phone)) {
      showMsg(msgProfile, "El teléfono debe tener 10 dígitos.", "error");
      return;
    }
    if (!payload.province || !payload.city || !payload.street || !payload.street_number) {
      showMsg(msgProfile, "Completá provincia, localidad, calle y altura.", "error");
      return;
    }
    if (!POSTAL_RE.test(postalCode)) {
      showMsg(msgProfile, "Ingresá un código postal válido.", "error");
      return;
    }

    if (payoutVisible) {
      payload.payout_alias = form.payout_alias.value.trim();
      payload.payout_cbu = digits(form.payout_cbu.value);
      if (!payload.payout_alias && !payload.payout_cbu) {
        showMsg(msgProfile, "Completá alias o CBU para poder cobrar comisiones.", "error");
        return;
      }
      if (payload.payout_alias && !/^[A-Za-z0-9._-]{6,30}$/.test(payload.payout_alias)) {
        showMsg(msgProfile, "El alias de cobro debe tener entre 6 y 30 caracteres.", "error");
        return;
      }
      if (payload.payout_cbu && !/^\d{22}$/.test(payload.payout_cbu)) {
        showMsg(msgProfile, "El CBU/CVU debe tener 22 dígitos.", "error");
        return;
      }
    }

    showMsg(msgProfile, "", "");
    try {
      const res = await fetch(api("/designers/me"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        redirectLogin();
        return;
      }
      if (!res.ok) throw new Error(data?.error || "No se pudieron guardar los cambios.");
      applyProfile(data);
      window.dispatchEvent(new CustomEvent("ludus:user-preference-updated"));
      showMsg(msgProfile, "Cambios guardados.", "ok");
    } catch (err) {
      showMsg(msgProfile, err.message || "No se pudieron guardar los cambios.", "error");
    }
  });

  avatarFile?.addEventListener("change", () => {
    showMsg(msgAvatar, "", "");
    const file = avatarFile.files?.[0];
    if (!file) {
      if (avatarPreview) avatarPreview.src = currentAvatar;
      return;
    }
    if (!ALLOWED.includes(file.type)) {
      showMsg(msgAvatar, "Formato no permitido. Usá JPG, PNG o WEBP.", "error");
      avatarFile.value = "";
      if (avatarPreview) avatarPreview.src = currentAvatar;
      return;
    }
    if (file.size > MAX_BYTES) {
      showMsg(msgAvatar, "La imagen supera los 4 MB permitidos.", "error");
      avatarFile.value = "";
      if (avatarPreview) avatarPreview.src = currentAvatar;
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      if (avatarPreview) avatarPreview.src = ev.target?.result || currentAvatar;
    };
    reader.onerror = () => {
      showMsg(msgAvatar, "No se pudo generar la vista previa.", "error");
      if (avatarPreview) avatarPreview.src = currentAvatar;
    };
    reader.readAsDataURL(file);
  });

  avatarForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!token) {
      redirectLogin();
      return;
    }
    const file = avatarFile?.files?.[0];
    if (!file) {
      showMsg(msgAvatar, "Seleccioná una imagen.", "error");
      return;
    }
    showMsg(msgAvatar, "", "");
    const fd = new FormData();
    fd.append("avatar", file);
    try {
      const res = await fetch(api("/designers/me/avatar"), {
        method: "PUT",
        headers: { ...authHeaders() },
        body: fd
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        redirectLogin();
        return;
      }
      if (!res.ok) throw new Error(data?.error || "No se pudo actualizar la imagen.");
      if (data?.avatar_url) {
        currentAvatar = data.avatar_url;
        if (avatarPreview) {
          avatarPreview.src = `${currentAvatar}?t=${Date.now()}`;
        }
      }
      avatarFile.value = "";
      showMsg(msgAvatar, "Imagen actualizada.", "ok");
    } catch (err) {
      showMsg(msgAvatar, err.message || "No se pudo actualizar la imagen.", "error");
    }
  });

  loadProfile();
})();
