// public/js/auth.js
const api = (path) => `/api/auth${path}`;

const formRegister = document.getElementById("form-register");
if (formRegister) {
  formRegister.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(formRegister);
    const payload = Object.fromEntries(f.entries());
    const msg = document.getElementById("msg-register");

    try {
      const res = await fetch(api("/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw data;
      localStorage.setItem("token", data.token);
      msg.textContent = "¡Cuenta creada! Redirigiendo…";
      setTimeout(() => (window.location.href = "/"), 800);
    } catch (err) {
      msg.textContent = err?.error || "Error al registrar";
    }
  });
}

const formLogin = document.getElementById("form-login");
if (formLogin) {
  formLogin.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(formLogin);
    const payload = Object.fromEntries(f.entries());
    const msg = document.getElementById("msg-login");

    try {
      const res = await fetch(api("/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw data;
      localStorage.setItem("token", data.token);
      msg.textContent = "¡Bienvenido!";
      setTimeout(() => (window.location.href = "/"), 500);
    } catch (err) {
      msg.textContent = err?.error || "Error al ingresar";
    }
  });
}
