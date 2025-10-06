// /public/js/auth.js
const api = (path) => `/api/auth${path}`;

/* Utilidades DOM */
const byName = (form, name) => form.querySelector(`[name="${name}"]`);
const ensureMsg = (input) => {
  // busca un .input-msg después del input o lo crea
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

/* Reglas */
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isUsername = (v) => /^[a-zA-Z0-9._-]{3,30}$/.test(v);
const isDNI = (v) => /^\d{8}$/.test(v);
const hasUpper = (s) => /[A-Z]/.test(s);
const hasLower = (s) => /[a-z]/.test(s);
const hasDigit = (s) => /\d/.test(s);
const nameRegex = /^[\p{L}ÁÉÍÓÚáéíóúÑñÜü' -]{2,80}$/u;
const isName = (v) => nameRegex.test(v.trim());

/* Fuerza contraseña: 2/3/4 */
const passwordScore = (p) => {
  let s = 0;
  if (p.length >= 8) s++;
  if (hasUpper(p) && hasLower(p)) s++;
  if (hasDigit(p)) s++;
  if (p.length >= 12) s++;
  return Math.min(4, Math.max(0, s));
};

/* --- Registro --- */
const formRegister = document.getElementById("form-register");
if (formRegister) {
  const firstName = byName(formRegister, "first_name");
  const lastName  = byName(formRegister, "last_name");
  const dni       = byName(formRegister, "dni");
  const username  = byName(formRegister, "username");
  const email     = byName(formRegister, "email");
  const password  = byName(formRegister, "password");
  const role      = byName(formRegister, "role");
  const usePref   = byName(formRegister, "usePreference");
  const msgGlobal = document.getElementById("msg-register");

  // medidor de contraseña
  const meter = document.createElement("div");
  meter.className = "pw-meter";
  meter.innerHTML = "<i></i>";
  password.parentElement.appendChild(meter);

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
    // fuerza a dígitos y recorta a 8 mientras escribe
    dni.value = dni.value.replace(/\D/g, "").slice(0, 8);
    const val = dni.value;
    if (!isDNI(val)) return setError(dni, "DNI debe tener exactamente 8 dígitos");
    setOK(dni);
    return true;
  },
    username(){
      const v = username.value.trim();
      if (!isUsername(v)) return setError(username, "Alias inválido (3-30: letras, números, ._-)");
      setOK(username);
      return true;
    },
    email(){
      const v = email.value.trim();
      if (!isEmail(v)) return setError(email, "Email inválido");
      setOK(email);
      return true;
    },
    password(){
      const p = password.value;
      const score = passwordScore(p);
      meter.dataset.score = String(score);
      if (p.length < 8) return setError(password, "Mínimo 8 caracteres");
      if (!hasUpper(p)) return setError(password, "Debe incluir una mayúscula");
      if (!hasLower(p)) return setError(password, "Debe incluir una minúscula");
      if (!hasDigit(p)) return setError(password, "Debe incluir un número");
      setOK(password, score >= 3 ? "Fuerte" : "Aceptable");
      return true;
    },
    role(){ setOK(role); return true; },
    usePref(){ setOK(usePref); return true; }
  };

  // listeners en vivo
  firstName.addEventListener("input", v.firstName);
  lastName.addEventListener("input", v.lastName);
  dni.addEventListener("input", v.dni);
  username.addEventListener("input", v.username);
  email.addEventListener("input", v.email);
  password.addEventListener("input", v.password);

  formRegister.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgGlobal.textContent = "";

    const allOK = [
      v.firstName(), v.lastName(), v.dni(),
      v.username(), v.email(), v.password(), v.role(), v.usePref()
    ].every(Boolean);

    if (!allOK) {
      msgGlobal.textContent = "Revisa los campos marcados en rojo.";
      return;
    }

    const f = new FormData(formRegister);
    const payload = Object.fromEntries(f.entries());

    try {
      const res = await fetch(api("/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw data;
      localStorage.setItem("token", data.token);
      msgGlobal.textContent = "¡Cuenta creada! Redirigiendo…";
      setTimeout(() => (window.location.href = "/"), 700);
    } catch (err) {
      msgGlobal.textContent = err?.error || "Error al registrar";
      if (err?.details) {
        // marca campos con errores de zod si vinieran
        err.details.forEach((d) => {
          const path = Array.isArray(d.path) ? d.path[0] : d.path;
          const input = byName(formRegister, path);
          if (input) setError(input, d.message);
        });
      }
    }
  });
}

/* --- Login --- */
const formLogin = document.getElementById("form-login");
if (formLogin) {
  const email = byName(formLogin, "email");
  const password = byName(formLogin, "password");
  const msgGlobal = document.getElementById("msg-login");

  const v = {
    email(){ 
      const v = email.value.trim();
      if (!isEmail(v)) return setError(email, "Email inválido");
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

    if (![v.email(), v.password()].every(Boolean)) {
      msgGlobal.textContent = "Revisa los campos marcados en rojo.";
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
      setTimeout(() => (window.location.href = "/"), 600);
    } catch (err) {
      msgGlobal.textContent = err?.error || "Error al ingresar";
    }
  });
}
