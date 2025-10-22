// /public/js/auth-ui.js
(() => {
  const api = (p) => (p.startsWith("/api") ? p : `/api${p}`);
  const $ = (s, r = document) => r.querySelector(s);

  const token = localStorage.getItem("token") || "";
  const authHeaders = () => (token ? { Authorization: `Bearer ${token}` } : {});

  function renderHeader(me) {
    // Este header asume la estructura que ya tienes en todas las páginas.
    // Si el HTML difiere, ajusta los selectores.
    const nav = document.querySelector(".menu");
    if (!nav) return;

    // Limpio duplicados de botones si re-renderizo
    nav.querySelectorAll(".ui-slot").forEach((n) => n.remove());

    if (me) {
      // Botón "Subir diseño"
      const up = document.createElement("a");
      up.href = "/upload.html";
      up.className = "btn btn-primary ui-slot";
      up.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Subir diseño`;
      nav.appendChild(up);

      // Hola, nombre (más visible)
      const hola = document.createElement("span");
      // CAMBIO ÚNICO: antes "ui-slot muted"
      hola.className = "ui-slot user-chip";
      hola.style.marginLeft = "0.75rem";
      hola.textContent = `Hola, ${me.username || me.name || me.email}`;
      nav.appendChild(hola);

      // Salir
      const out = document.createElement("a");
      out.href = "#";
      out.className = "btn ui-slot";
      out.style.marginLeft = "0.5rem";
      out.innerHTML = `<i class="fa-solid fa-right-from-bracket"></i> Salir`;
      out.addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.removeItem("token");
        location.href = "/";
      });
      nav.appendChild(out);
    } else {
      const a1 = document.createElement("a");
      a1.href = "/login.html";
      a1.className = "btn ui-slot";
      a1.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Iniciar sesión`;
      nav.appendChild(a1);

      const a2 = document.createElement("a");
      a2.href = "/register.html";
      a2.className = "btn btn-primary ui-slot";
      a2.style.marginLeft = "0.5rem";
      a2.innerHTML = `<i class="fa-solid fa-user-plus"></i> Registrarse`;
      nav.appendChild(a2);
    }
  }

  function show403() {
    const main = document.querySelector("main") || document.body;
    main.innerHTML = `
      <section class="card" style="max-width:900px;margin:2rem auto;padding:1rem">
        <h1 style="margin-bottom:.5rem">Acceso denegado</h1>
        <p class="muted">Necesitas permisos de administrador para ver esta página.</p>
        <p style="margin-top:1rem">
          <a class="btn" href="/"><i class="fa-solid fa-house"></i> Volver al inicio</a>
        </p>
      </section>`;
  }

  async function getMe() {
    if (!token) return null;
    try {
      const res = await fetch(api("/auth/me"), {
        headers: { ...authHeaders(), "Accept": "application/json" },
        cache: "no-store"         // <- evita 304 / caché
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async function boot() {
    const me = await getMe();
    renderHeader(me);

    // Reglas para /admin
    const isAdminPage = location.pathname.startsWith("/admin/");
    if (isAdminPage) {
      if (!me) {
        // no logueado -> ir a login con retorno
        const next = encodeURIComponent(location.pathname + location.search);
        location.href = `/login.html?next=${next}`;
        return;
      }
      if (me.role !== "admin") {
        // logueado sin rol -> mostrar 403, NO redirigir al home
        show403();
        return;
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const chk = document.querySelector('#accept_terms');
    const submit = document.querySelector('#registerForm button[type="submit"]');
    if (chk && submit) {
      submit.disabled = !chk.checked;
      chk.addEventListener('change', () => submit.disabled = !chk.checked);
    }
  });

})();
