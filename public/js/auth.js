// /public/js/auth.js
// Maneja registro y login con validación en vivo y redirecciones.
// Endpoints esperados:
//  - POST /api/auth/register
//  - POST /api/auth/login
//  - GET  /api/auth/me

const api = (path) => `/api/auth${path}`;

const safeNextPath = () => {
  const raw = new URLSearchParams(window.location.search).get("next");
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "";
    if (url.pathname === "/login.html" || url.pathname === "/register.html") return "";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "";
  }
};

/* ==========================
   Utilidades DOM / helpers
========================== */
const byName = (form, name) => form.querySelector(`[name="${name}"]`);

const ensureMsg = (input) => {
  // crea (o reutiliza) un <small class="input-msg"> debajo del input
  let el = input.parentElement.querySelector(".input-msg");
  if (!el) {
    el = document.createElement("small");
    el.className = "input-msg";
    input.parentElement.appendChild(el);
  }
  return el;
};

const setError = (input, msg) => {
  const el = ensureMsg(input);
  el.textContent = msg || "";
  el.classList.remove("ok");
  if (msg) {
    el.classList.add("error");
    input.classList.add("is-invalid");
    input.classList.remove("is-valid");
  } else {
    el.classList.remove("error");
    input.classList.remove("is-invalid");
  }
};

const setOK = (input, msg) => {
  const el = ensureMsg(input);
  el.textContent = msg || "";
  el.classList.remove("error");
  el.classList.add("ok");
  input.classList.add("is-valid");
  input.classList.remove("is-invalid");
};

const clearFeedback = (input) => {
  if (!input) return;
  const parent = input.parentElement;
  if (parent) {
    const el = parent.querySelector(".input-msg");
    if (el) {
      el.textContent = "";
      el.classList.remove("error");
      el.classList.remove("ok");
    }
  }
  input.classList.remove("is-valid");
  input.classList.remove("is-invalid");
};

/* ==========================
   Reglas de validación
========================== */
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isUsername = (v) => /^[a-zA-Z0-9._-]{3,30}$/.test(v);
const ARG_PROVINCES = new Set([
  "Buenos Aires",
  "Catamarca",
  "Chaco",
  "Chubut",
  "Ciudad Autonoma de Buenos Aires",
  "Cordoba",
  "Corrientes",
  "Entre Rios",
  "Formosa",
  "Jujuy",
  "La Pampa",
  "La Rioja",
  "Mendoza",
  "Misiones",
  "Neuquen",
  "Rio Negro",
  "Salta",
  "San Juan",
  "San Luis",
  "Santa Cruz",
  "Santa Fe",
  "Santiago del Estero",
  "Tierra del Fuego",
  "Tucuman"
]);
const phoneDigitsAR = (value) => String(value || "").replace(/\D/g, "");
const isPhoneAR = (value) => phoneDigitsAR(value).length === 10;
const normalizePostalCodeAR = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
const isPostalCodeAR = (value) => /^\d{4}$/.test(normalizePostalCodeAR(value)) || /^[A-Z]\d{4}[A-Z]{3}$/.test(normalizePostalCodeAR(value));

// Nombres/apellidos: letras (incluye acentos/ñ/ü), espacios, apóstrofe y guion
const nameRegex = /^[\p{L}ÁÉÍÓÚáéíóúÑñÜü' -]{2,80}$/u;
const isName = (v) => nameRegex.test(v.trim());

// DNI exactamente 8 dígitos
const isDNI = (v) => /^\d{8}$/.test(v);

/* Fuerza de contraseña */
const hasUpper = (s) => /[A-Z]/.test(s);
const hasLower = (s) => /[a-z]/.test(s);
const hasDigit  = (s) => /\d/.test(s);
const passwordScore = (p) => {
  let s = 0;
  if (p.length >= 8) s++;
  if (hasUpper(p) && hasLower(p)) s++;
  if (hasDigit(p)) s++;
  if (p.length >= 12) s++;
  return Math.min(4, Math.max(0, s));
};

/* ==========================
   Registro (usa #registerForm)
========================== */
const formRegister = document.getElementById("registerForm");
if (formRegister) {
  const firstName = byName(formRegister, "first_name");
  const lastName  = byName(formRegister, "last_name");
  const dni       = byName(formRegister, "dni");
  const username  = byName(formRegister, "username");
  const email     = byName(formRegister, "email");
  const password  = byName(formRegister, "password");
  const usePref   = byName(formRegister, "use_preference");
  const phone     = byName(formRegister, "phone");
  const country   = byName(formRegister, "country");
  const province  = byName(formRegister, "province");
  const city      = byName(formRegister, "city");
  const street    = byName(formRegister, "street");
  const streetNumber = byName(formRegister, "street_number");
  const postalCode = byName(formRegister, "postal_code");
  const payoutAlias = byName(formRegister, "payout_alias");
  const payoutCbu = byName(formRegister, "payout_cbu");
  const shippingFields = Array.from(formRegister.querySelectorAll(".shipping-field, #shippingFields"));
  const payoutFields = Array.from(formRegister.querySelectorAll(".payout-field, #payoutFields"));
  const avatarInput = byName(formRegister, "avatar");
  const avatarPreviewBox = document.getElementById("avatarPreview");
  const avatarPreviewImg = document.getElementById("avatarPreviewImg");
  const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png"];
  const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
  let avatarPreviewToken = 0;

  // Mensaje global (lo creo si no existe)
  let msgGlobal = document.getElementById("msg-register");
  if (!msgGlobal) {
    msgGlobal = document.createElement("p");
    msgGlobal.id = "msg-register";
    msgGlobal.className = "muted";
    // lo agrego al final del formulario
    const actions = formRegister.querySelector(".form-actions") || formRegister;
    actions.appendChild(msgGlobal);
  }

  // Medidor visual de contraseña (barra simple)
  const meter = document.createElement("div");
  meter.className = "pw-meter";
  meter.innerHTML = "<i></i>";
  // estilo básico por si no existía en CSS (no pisa tus estilos si ya están)
  meter.style.height = "6px";
  meter.style.borderRadius = "999px";
  meter.style.background = "#e5edf5";
  meter.style.marginTop = "6px";
  meter.querySelector("i").style.display = "block";
  meter.querySelector("i").style.height = "100%";
  meter.querySelector("i").style.width = "0%";
  meter.querySelector("i").style.borderRadius = "999px";
  meter.querySelector("i").style.transition = "width .2s ease";
  password.parentElement.appendChild(meter);

  const clearAvatarPreview = () => {
    avatarPreviewToken++;
    if (avatarPreviewImg) {
      avatarPreviewImg.removeAttribute("src");
    }
    if (avatarPreviewBox) avatarPreviewBox.hidden = true;
  };

  const showAvatarPreview = (file) => {
    if (!avatarPreviewImg || !avatarPreviewBox) return;
    const token = ++avatarPreviewToken;
    const reader = new FileReader();
    reader.onload = () => {
      if (token !== avatarPreviewToken) return;
      if (typeof reader.result === "string") {
        avatarPreviewImg.src = reader.result;
        avatarPreviewImg.alt = file.name || "Avatar";
        avatarPreviewBox.hidden = false;
      }
    };
    reader.onerror = () => {
      clearAvatarPreview();
    };
    reader.readAsDataURL(file);
  };

  function paintMeter(score) {
    const i = meter.querySelector("i");
    const widths = ["0%", "25%", "50%", "75%", "100%"];
    const colors = ["#e5edf5", "#ff6b6b", "#f7c948", "#7ad37a", "#22c55e"];
    i.style.width = widths[score];
    i.style.background = colors[score];
  }

  const wantsPayout = () => usePref.value === "upload";
  const setGroupVisible = (items, visible) => {
    items.forEach((el) => {
      el.hidden = !visible;
      el.querySelectorAll?.("input, textarea, select").forEach((input) => {
        input.disabled = !visible;
      });
    });
  };
  const syncPreferenceFields = () => {
    const needPayout = wantsPayout();
    setGroupVisible(shippingFields, true);
    setGroupVisible(payoutFields, needPayout);
    [phone, country, province, city, street, streetNumber, postalCode]
      .filter(Boolean)
      .forEach((input) => {
        input.required = true;
      });
    [payoutAlias, payoutCbu].filter(Boolean).forEach((input) => {
      input.required = false;
      if (!needPayout) clearFeedback(input);
    });
  };
  const requiredText = (input, label, min = 2, max = 120) => {
    const val = input.value.trim();
    if (val.length < min || val.length > max) {
      setError(input, `${label} requerido`);
      return false;
    }
    setOK(input);
    return true;
  };

  const v = {
    firstName(){ 
      const val = firstName.value.trim();
      if (!isName(val)) return setError(firstName, "Solo letras/espacios (2–80)");
      setOK(firstName);
      return true;
    },
    lastName(){
      const val = lastName.value.trim();
      if (!isName(val)) return setError(lastName, "Solo letras/espacios (2–80)");
      setOK(lastName);
      return true;
    },
    dni(){
      dni.value = dni.value.replace(/\D/g, "").slice(0, 8); // fuerza dígitos, máx 8
      const val = dni.value;
      if (!isDNI(val)) return setError(dni, "DNI debe tener exactamente 8 dígitos");
      setOK(dni);
      return true;
    },
    username(){
      const val = username.value.trim();
      if (!isUsername(val)) return setError(username, "Alias inválido (3–30: letras, números, . _ -)");
      setOK(username);
      return true;
    },
    email(){
      const val = email.value.trim();
      if (!isEmail(val)) return setError(email, "Email inválido");
      setOK(email);
      return true;
    },
    password(){
      const p = password.value;
      const score = passwordScore(p);
      paintMeter(score);
      if (p.length < 8)   return setError(password, "Mínimo 8 caracteres");
      if (!hasUpper(p))   return setError(password, "Debe incluir una mayúscula");
      if (!hasLower(p))   return setError(password, "Debe incluir una minúscula");
      if (!hasDigit(p))   return setError(password, "Debe incluir un número");
      setOK(password, score >= 3 ? "Fuerte" : "Aceptable");
      return true;
    },
    usePref(){
      if (!usePref.value) return setError(usePref, "Seleccioná una opción");
      syncPreferenceFields();
      setOK(usePref);
      return true;
    },
    shipping(){
      phone.value = phoneDigitsAR(phone.value).slice(0, 10);
      postalCode.value = normalizePostalCodeAR(postalCode.value);
      const ok = [
        isPhoneAR(phone.value) ? (setOK(phone), true) : (setError(phone, "Telefono argentino: 10 digitos, sin 0 ni 15"), false),
        requiredText(country, "Pais", 2, 80),
        ARG_PROVINCES.has(province.value) ? (setOK(province), true) : (setError(province, "Selecciona una provincia"), false),
        requiredText(city, "Localidad", 2, 80),
        requiredText(street, "Calle", 2, 120),
        requiredText(streetNumber, "Altura", 1, 20),
        isPostalCodeAR(postalCode.value) ? (setOK(postalCode), true) : (setError(postalCode, "Codigo postal invalido"), false)
      ];
      return ok.every(Boolean);
    },
    payout(){
      if (!wantsPayout()) return true;
      const alias = payoutAlias.value.trim();
      const cbu = payoutCbu.value.replace(/\D/g, "");
      payoutCbu.value = cbu;
      clearFeedback(payoutAlias);
      clearFeedback(payoutCbu);
      if (!alias && !cbu) {
        setError(payoutAlias, "Carga alias o CBU/CVU");
        setError(payoutCbu, "Carga alias o CBU/CVU");
        return false;
      }
      if (alias && !/^[A-Za-z0-9._-]{6,30}$/.test(alias)) {
        setError(payoutAlias, "Alias invalido (6-30: letras, numeros, . _ -)");
        return false;
      }
      if (cbu && !/^\d{22}$/.test(cbu)) {
        setError(payoutCbu, "CBU/CVU debe tener 22 digitos");
        return false;
      }
      if (alias) setOK(payoutAlias);
      if (cbu) setOK(payoutCbu);
      return true;
    },
  };

  if (avatarInput) {
    v.avatar = () => {
      const file = avatarInput.files[0];
      if (!file) {
        clearAvatarPreview();
        return setError(avatarInput, "Subí una foto en JPG o PNG (máx 2 MB).");
      }
      if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
        clearAvatarPreview();
        avatarInput.value = "";
        setError(avatarInput, "Solo se admite JPG o PNG.");
        return false;
      }
      if (file.size > MAX_AVATAR_SIZE) {
        clearAvatarPreview();
        avatarInput.value = "";
        setError(avatarInput, "El archivo debe pesar menos de 2 MB.");
        return false;
      }
      showAvatarPreview(file);
      setOK(avatarInput, "Archivo listo");
      return true;
    };
  }

  // Validación en vivo
  firstName.addEventListener("input", v.firstName);
  lastName.addEventListener("input", v.lastName);
  dni.addEventListener("input", v.dni);
  username.addEventListener("input", v.username);
  email.addEventListener("input", v.email);
  password.addEventListener("input", v.password);
  usePref.addEventListener("change", v.usePref);
  [phone, country, province, city, street, streetNumber, postalCode]
    .filter(Boolean)
    .forEach((input) => input.addEventListener("input", v.shipping));
  [payoutAlias, payoutCbu]
    .filter(Boolean)
    .forEach((input) => input.addEventListener("input", v.payout));
  if (avatarInput && v.avatar) {
    avatarInput.addEventListener("change", () => v.avatar());
  }

  formRegister.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgGlobal.textContent = "";
    msgGlobal.className = "muted";

    const validations = [
      v.firstName(), v.lastName(), v.dni(),
      v.username(), v.email(), v.password(), v.usePref(), v.shipping(), v.payout()
    ];

    if (typeof v.avatar === "function") {
      validations.push(v.avatar());
    }

    const allOK = validations.every(Boolean);

    if (!allOK) {
      msgGlobal.textContent = "Revisá los campos marcados en rojo.";
      msgGlobal.className = "error";
      return;
    }

    const f = new FormData(formRegister);

    try {
          // Pre-chequeo para evitar 409 por duplicados (user-friendly)
    const pre = await checkUnique({
      emailVal: email.value.trim().toLowerCase(),
      dniVal: dni.value.replace(/\D/g, ""),
      usernameVal: username.value.trim(),
    });

    if (pre) {
      let dupMsg = "";
      if (pre.email_taken)    { setError(email, "Este email ya está registrado."); dupMsg = "Email ya registrado."; }
      if (pre.dni_taken)      { setError(dni, "Este DNI ya está registrado."); dupMsg = dupMsg || "DNI ya registrado."; }
      if (pre.username_taken) { setError(username, "Este alias ya está en uso."); dupMsg = dupMsg || "Alias ya en uso."; }
      if (dupMsg) {
        msgGlobal.textContent = dupMsg;
        msgGlobal.className = "error";
        return; // no enviamos
      }
    }


      const res = await fetch(api("/register"), {
        method: "POST",
        body: f
      });
      const data = await res.json();
      if (!res.ok) throw data;

      localStorage.setItem("token", data.token);
      msgGlobal.textContent = "¡Cuenta creada! Redirigiendo…";
      msgGlobal.className = "ok";

      // Redirige según preferencia (el backend mapea a rol)
      const prefValue = usePref.value;
      const isUpload = prefValue === "upload";
      const next = isUpload ? "/upload.html" : "/";
      setTimeout(() => (window.location.href = next), 700);
    } catch (err) {
      msgGlobal.textContent = err?.error || "Error al registrar";
      msgGlobal.className = "error";
      if (err?.details) {
        // Marca campos con errores devueltos por el backend (Zod)
        err.details.forEach((d) => {
          const path = Array.isArray(d.path) ? d.path[0] : d.path;
          const input = byName(formRegister, path);
          if (input) setError(input, d.message);
        });
      }
    }
  });

    // ------- Verificación remota (email/dni/username) con debounce -------
  const debounce = (fn, ms = 350) => {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  };

  async function checkUnique({ emailVal, dniVal, usernameVal }) {
    // Armamos la query solo con lo que tenga formato válido para evitar 400s.
    const params = new URLSearchParams();
    if (emailVal && isEmail(emailVal)) params.set("email", emailVal);
    if (dniVal && isDNI(dniVal))       params.set("dni", dniVal);
    if (usernameVal && isUsername(usernameVal)) params.set("username", usernameVal);

    if ([...params.keys()].length === 0) return null; // nada para verificar

    try {
      const res = await fetch(api(`/check?${params.toString()}`), { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json(); // { email_taken, dni_taken, username_taken }
    } catch {
      return null;
    }
  }

  const liveUniqueCheck = debounce(async () => {
    const emailVal    = email.value.trim().toLowerCase();
    const dniVal      = dni.value.replace(/\D/g, "");
    const usernameVal = username.value.trim();

    const result = await checkUnique({ emailVal, dniVal, usernameVal });
    if (!result) return;

    // Respetamos primero las validaciones de formato: solo mostramos "tomado" si el formato es válido.
    if (isEmail(emailVal) && result.email_taken) {
      setError(email, "Este email ya está registrado.");
    } else if (isEmail(emailVal)) {
      setOK(email);
    }

    if (isDNI(dniVal) && result.dni_taken) {
      setError(dni, "Este DNI ya está registrado.");
    } else if (isDNI(dniVal)) {
      setOK(dni);
    }

    if (isUsername(usernameVal) && result.username_taken) {
      setError(username, "Este alias ya está en uso.");
    } else if (isUsername(usernameVal)) {
      setOK(username);
    }
  }, 400);

  // Disparamos la verificación remota solamente cuando el valor tiene formato válido
  email.addEventListener("input", () => { v.email() && liveUniqueCheck(); });
  dni.addEventListener("input",   () => { v.dni()   && liveUniqueCheck(); });
  username.addEventListener("input", () => { v.username() && liveUniqueCheck(); });
  if (avatarInput) {
    formRegister.addEventListener("reset", () => {
      clearAvatarPreview();
      clearFeedback(avatarInput);
    });
  }
  syncPreferenceFields();

}

/* ==========================
   Login (sin cambios)
========================== */
const formLogin = document.getElementById("form-login");
if (formLogin) {
  const email = byName(formLogin, "email");
  const password = byName(formLogin, "password");
  const msgGlobal = document.getElementById("msg-login") || (() => {
    const p = document.createElement("p");
    p.id = "msg-login";
    p.className = "muted";
    formLogin.appendChild(p);
    return p;
  })();

  const v = {
    email(){ 
      const val = email.value.trim();
      if (!isEmail(val)) return setError(email, "Email inválido");
      setOK(email);
      return true;
    },
    password(){
      const p = password.value;
      if (p.length < 8) return setError(password, "Contraseña inválida");
      setOK(password);
      return true;
    }
  };

  email.addEventListener("input", v.email);
  password.addEventListener("input", v.password);

  formLogin.addEventListener("submit", async (e) => {
  e.preventDefault();
  msgGlobal.textContent = "";
  msgGlobal.className = "muted";

  if (![v.email(), v.password()].every(Boolean)) {
    msgGlobal.textContent = "Revisá los campos marcados en rojo.";
    msgGlobal.className = "error";
    return;
  }

  try {
    // 1) Login
    const res = await fetch(api("/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: email.value.trim(),
        password: password.value
      })
    });
    const data = await res.json();
    if (!res.ok) throw data;

    // 2) Guardar token
    localStorage.setItem("token", data.token);
    msgGlobal.textContent = "¡Bienvenido!";
    msgGlobal.className = "ok";

    // 3) Obtener rol con /me (porque /login no lo devuelve)
    let role = null;
    let usePreference = null;
    try {
      const meRes = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${data.token}`, "Accept": "application/json" },
        cache: "no-store"
      });
      if (meRes.ok) {
        const me = await meRes.json();
        // según si usas controlador u rutas clásicas, me puede venir como { user:{...} } o directo
        const currentUser = me?.user || me || {};
        role = currentUser.role || null;
        usePreference = currentUser.use_preference || null;
      }
    } catch { /* ignorar: si falla, caemos al default */ }

    // 4) Redirección por rol
    let next = "/designs.html";
    if (role === "admin")        next = "/admin/users.html";
    else if (usePreference === "upload" || role === "designer") next = "/upload.html";
    else if (usePreference === "buy" || role === "buyer") next = "/designs.html";
    next = safeNextPath() || next;
    // buyers y otros → home
    setTimeout(() => (window.location.href = next), 300);
  } catch (err) {
    msgGlobal.textContent = err?.error || "Error al ingresar";
    msgGlobal.className = "error";
  }
});


}
