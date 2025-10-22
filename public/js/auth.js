// /public/js/auth.js
// Maneja registro y login con validación en vivo y redirecciones.
// Endpoints esperados:
//  - POST /api/auth/register
//  - POST /api/auth/login
//  - GET  /api/auth/me

const api = (path) => `/api/auth${path}`;

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

/* ==========================
   Reglas de validación
========================== */
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isUsername = (v) => /^[a-zA-Z0-9._-]{3,30}$/.test(v);

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

  function paintMeter(score) {
    const i = meter.querySelector("i");
    const widths = ["0%", "25%", "50%", "75%", "100%"];
    const colors = ["#e5edf5", "#ff6b6b", "#f7c948", "#7ad37a", "#22c55e"];
    i.style.width = widths[score];
    i.style.background = colors[score];
  }

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
      setOK(usePref);
      return true;
    }
  };

  // Validación en vivo
  firstName.addEventListener("input", v.firstName);
  lastName.addEventListener("input", v.lastName);
  dni.addEventListener("input", v.dni);
  username.addEventListener("input", v.username);
  email.addEventListener("input", v.email);
  password.addEventListener("input", v.password);
  usePref.addEventListener("change", v.usePref);

  formRegister.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgGlobal.textContent = "";
    msgGlobal.className = "muted";

    const allOK = [
      v.firstName(), v.lastName(), v.dni(),
      v.username(), v.email(), v.password(), v.usePref()
    ].every(Boolean);

    if (!allOK) {
      msgGlobal.textContent = "Revisá los campos marcados en rojo.";
      msgGlobal.className = "error";
      return;
    }

    const f = new FormData(formRegister);
    // Enviamos tal cual (incluye use_preference)
    const payload = Object.fromEntries(f.entries());

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw data;

      localStorage.setItem("token", data.token);
      msgGlobal.textContent = "¡Cuenta creada! Redirigiendo…";
      msgGlobal.className = "ok";

      // Redirige según preferencia (el backend mapea a rol)
      const next = (payload.use_preference === "upload") ? "/upload.html" : "/";
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

      localStorage.setItem("token", data.token);
      msgGlobal.textContent = "¡Bienvenido!";
      msgGlobal.className = "ok";

      // Redirigir según rol devuelto por el backend
      const next = (data?.user?.role === "designer") ? "/upload.html" : "/";
      setTimeout(() => (window.location.href = next), 600);
    } catch (err) {
      msgGlobal.textContent = err?.error || "Error al ingresar";
      msgGlobal.className = "error";
    }
  });
}
