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

  const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
  const MAX_BYTES = 4 * 1024 * 1024;
  let currentAvatar = "/img/disenador1.jpg";

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

  function applyProfile(data) {
    if (!data) return;
    const designer = data.designer || {};
    const persona = data.persona || {};
    const user = data.user || {};

    if (form) {
      if (form.username) form.username.value = user.username || "";
      if (form.email) form.email.value = user.email || "";
      form.first_name.value = persona.first_name || "";
      form.last_name.value = persona.last_name || "";
      form.dni.value = persona.dni || "";
    }

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

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!token) {
      redirectLogin();
      return;
    }
    const payload = {
      username: form.username.value.trim(),
      first_name: form.first_name.value.trim(),
      last_name: form.last_name.value.trim(),
      dni: form.dni.value.trim()
    };
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
