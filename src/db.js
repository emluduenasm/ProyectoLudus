// src/db.js  (versión sin CITEXT)
import "dotenv/config";
import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

const DEFAULT_AVATAR = "/img/uploads/avatars/default.png";
const CATEGORY_SEED = [
  {
    name: "Ilustración digital",
    slug: "ilustracion-digital",
    description: "Arte vectorial, retratos digitales y gráficos coloridos."
  },
  {
    name: "Tipografía & frases",
    slug: "tipografia",
    description: "Lettering, frases motivacionales y caligrafía moderna."
  },
  {
    name: "Naturaleza y botánica",
    slug: "naturaleza",
    description: "Flores, hojas y paisajes relajantes."
  },
  {
    name: "Geométrico / abstracto",
    slug: "abstracto",
    description: "Figuras geométricas, gradientes y composiciones audaces."
  },
  {
    name: "Geek & retro",
    slug: "geek",
    description: "Videojuegos, nostalgia pixel art y cultura pop."
  },
  {
    name: "Otros",
    slug: "otros",
    description: "Categoría comodín para diseños experimentales."
  }
];

const USER_SEED = [
  {
    email: "admin@ludus.dev",
    username: "admin",
    name: "Lucía Admin",
    role: "admin",
    display_name: "Lucía Admin",
    avatar: "/img/disenador1.jpg",
    password: process.env.SEED_ADMIN_PASSWORD || "admin1234",
    use_preference: "upload",
    persona: { first_name: "Lucía", last_name: "Admin", dni: "90000001" }
  },
  {
    email: "creativa@ludus.dev",
    username: "creativa",
    name: "Mariana Creativa",
    role: "designer",
    display_name: "Mariana Creativa",
    avatar: "/img/disenador2.jpg",
    password: process.env.SEED_DESIGNER_PASSWORD || "designer123",
    use_preference: "upload",
    persona: { first_name: "Mariana", last_name: "Creativa", dni: "90000002" }
  }
];

const DESIGN_SEED = [
  {
    title: "Flores en Azules",
    description: "Ilustración botánica pensada para remeras y tote bags.",
    image_url: "/img/diseno1.jpg",
    category_slug: "naturaleza",
    designer_username: "creativa"
  },
  {
    title: "Tipografía Urban",
    description: "Lettering moderno ideal para buzos o posters.",
    image_url: "/img/diseno4.jpg",
    category_slug: "tipografia",
    designer_username: "creativa"
  },
  {
    title: "Geometría Pastel",
    description: "Composición abstracta en tonos pastel para mates o tazas.",
    image_url: "/img/diseno7.jpg",
    category_slug: "abstracto",
    designer_username: "creativa"
  },
  {
    title: "Retro Pixels",
    description: "Personaje retro inspirado en los videojuegos de 8 bits.",
    image_url: "/img/diseno3.jpg",
    category_slug: "geek",
    designer_username: "creativa"
  }
];

const cleanDni = (value) => (value ?? "").toString().replace(/\D/g, "").slice(0, 20);
const lower = (value) => (typeof value === "string" ? value.trim().toLowerCase() : "");

const bootstrap = async () => {
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  } catch {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'buyer',
      use_preference TEXT DEFAULT 'buy',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS designers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS designs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      designer_id UUID NOT NULL REFERENCES designers(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL,
      thumbnail_url TEXT,
      published BOOLEAN NOT NULL DEFAULT false,
      review_status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      image_url TEXT,
      published BOOLEAN NOT NULL DEFAULT false,
      mockup_config JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS products_published_idx ON products (published);
  `);

  await pool.query(`
    ALTER TABLE products
      ADD COLUMN IF NOT EXISTS mockup_config JSONB;
  `);
  await pool.query(`
    UPDATE products
       SET mockup_config = jsonb_build_object(
         'width_pct', 0.45,
         'height_pct', 0.45,
         'top_pct', 0.18,
         'left_pct', 0.5,
         'blend', 'multiply'
       )
     WHERE mockup_config IS NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_product_mockups (
      design_id UUID REFERENCES designs(id) ON DELETE CASCADE,
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (design_id, product_id)
    );
  `);

  await pool.query(`
    INSERT INTO products (name, description, price, stock, image_url, published, mockup_config)
    SELECT 'Remera básica',
           'Remera blanca lista para personalizar con tus diseños.',
           14999,
           25,
           '/img/productos/producto-remera.jpg',
           TRUE,
           jsonb_build_object('width_pct',0.45,'height_pct',0.45,'top_pct',0.18,'left_pct',0.5,'blend','multiply')
    WHERE NOT EXISTS (
      SELECT 1 FROM products WHERE LOWER(name) = 'remera básica'
    );
  `);

  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
  `);
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS review_status TEXT DEFAULT 'pending';
  `);
  await pool.query(`
    UPDATE designs
      SET review_status = CASE
        WHEN published = TRUE THEN 'approved'
        ELSE COALESCE(review_status, 'pending')
      END;
  `);
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_number TEXT NOT NULL UNIQUE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      design_id UUID NOT NULL REFERENCES designs(id) ON DELETE RESTRICT,
      product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
      designer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      design_title TEXT NOT NULL,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0),
      unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS design_likes (
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      design_id UUID NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, design_id)
    );
    CREATE INDEX IF NOT EXISTS idx_design_likes_design ON design_likes (design_id);
  `);
};

const runSupplementalMigrations = async () => {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS personas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      first_name TEXT NOT NULL,
      last_name  TEXT NOT NULL,
      dni        VARCHAR(20) UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS categories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username   TEXT;
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS persona_id UUID REFERENCES personas(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (LOWER(username));
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS use_preference TEXT DEFAULT 'buy';
  `);
  await pool.query(`
    ALTER TABLE users ALTER COLUMN use_preference SET DEFAULT 'buy';
  `);
  await pool.query(`
    UPDATE users SET use_preference = COALESCE(use_preference, 'buy');
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await pool.query(`
    ALTER TABLE users ALTER COLUMN banned SET DEFAULT FALSE;
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT;
  `);
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
  `);

  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id);
  `);
  await pool.query(`
    ALTER TABLE designs
      ADD COLUMN IF NOT EXISTS published_backup BOOLEAN DEFAULT FALSE;
  `);
  await pool.query(`
    ALTER TABLE designs
      ALTER COLUMN published SET DEFAULT FALSE;
  `);
};

async function ensureDefaultCategories(client) {
  for (const cat of CATEGORY_SEED) {
    const name = cat.name?.trim();
    const slug = lower(cat.slug);
    if (!name || !slug) continue;
    await client.query(
      `INSERT INTO categories (name, slug, description)
       VALUES ($1,$2,$3)
       ON CONFLICT (slug)
       DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         active = TRUE,
         updated_at = NOW()`,
      [name, slug, cat.description || ""]
    );
  }
}

async function ensurePersonaRecord(client, persona = {}) {
  const dni = cleanDni(persona.dni);
  if (!dni) return null;
  const existing = await client.query(
    `SELECT id FROM personas WHERE dni = $1 LIMIT 1`,
    [dni]
  );
  if (existing.rowCount) return existing.rows[0].id;
  const inserted = await client.query(
    `INSERT INTO personas (first_name, last_name, dni)
     VALUES ($1,$2,$3)
     RETURNING id`,
    [
      persona.first_name?.trim() || "Nombre",
      persona.last_name?.trim() || "Demo",
      dni
    ]
  );
  return inserted.rows[0].id;
}

async function ensureSeedUsers(client) {
  const designerMap = new Map();
  for (const seed of USER_SEED) {
    const email = lower(seed.email);
    if (!email) continue;
    const existing = await client.query(
      `SELECT id, persona_id FROM users WHERE LOWER(email)=LOWER($1) LIMIT 1`,
      [email]
    );

    let userId = existing.rows[0]?.id || null;
    let personaId = existing.rows[0]?.persona_id || null;

    if (!personaId && seed.persona) {
      personaId = await ensurePersonaRecord(client, seed.persona);
      if (userId && personaId) {
        await client.query(`UPDATE users SET persona_id=$1 WHERE id=$2`, [
          personaId,
          userId
        ]);
      }
    }

    if (!userId) {
      const persona = seed.persona
        ? await ensurePersonaRecord(client, seed.persona)
        : null;
      const hash = await bcrypt.hash(seed.password || "changeme123", 10);
      const inserted = await client.query(
        `INSERT INTO users (id, name, username, email, password_hash, role, use_preference, persona_id, banned)
         VALUES (gen_random_uuid(), $1,$2,$3,$4,$5,$6,$7,FALSE)
         RETURNING id`,
        [
          seed.name || seed.display_name || "Usuario Demo",
          seed.username,
          email,
          hash,
          seed.role || "buyer",
          seed.use_preference || (seed.role === "designer" ? "upload" : "buy"),
          persona
        ]
      );
      userId = inserted.rows[0].id;
    }

    const shouldCreateDesigner = seed.role !== "buyer";
    if (shouldCreateDesigner) {
      const designer = await client.query(
        `INSERT INTO designers (user_id, display_name, avatar_url)
         VALUES ($1,$2,$3)
         ON CONFLICT (user_id)
         DO UPDATE SET
           display_name = EXCLUDED.display_name,
           avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), designers.avatar_url)
         RETURNING id`,
        [
          userId,
          seed.display_name || seed.name || seed.username || "Diseñador",
          seed.avatar || DEFAULT_AVATAR
        ]
      );
      const key = lower(seed.username) || email;
      designerMap.set(key, designer.rows[0].id);
      designerMap.set(email, designer.rows[0].id);
    }
  }
  return designerMap;
}

async function ensureSeedDesigns(client, { categoryMap, designerMap }) {
  if (!designerMap || !designerMap.size) return;
  for (const design of DESIGN_SEED) {
    const title = design.title?.trim();
    const designerId =
      designerMap.get(lower(design.designer_username)) ||
      designerMap.get(lower(design.designer_email));
    if (!title || !designerId) continue;

    const catId =
      categoryMap.get(lower(design.category_slug)) ||
      categoryMap.get("otros") ||
      null;

    await client.query(
      `INSERT INTO designs (designer_id, title, description, image_url, thumbnail_url, published, review_status, category_id)
       SELECT $1,$2,$3,$4,$5, TRUE, 'approved', $6
       WHERE NOT EXISTS (
         SELECT 1 FROM designs WHERE LOWER(title) = LOWER($2)
       )`,
      [
        designerId,
        title,
        (design.description || "").trim(),
        design.image_url || "/img/diseno1.jpg",
        design.thumbnail_url || design.image_url || "/img/diseno1.jpg",
        catId
      ]
    );
  }
}

async function buildCategoryMap(client) {
  const { rows } = await client.query(
    `SELECT id, LOWER(slug) AS slug FROM categories`
  );
  const map = new Map();
  for (const row of rows) {
    if (row.slug) map.set(row.slug, row.id);
  }
  return map;
}

const seedInitialData = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureDefaultCategories(client);
    const designerMap = await ensureSeedUsers(client);
    const categoryMap = await buildCategoryMap(client);
    await ensureSeedDesigns(client, { categoryMap, designerMap });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("seedInitialData", err);
  } finally {
    client.release();
  }
};

try {
  await bootstrap();
  await runSupplementalMigrations();
  await seedInitialData();
} catch (err) {
  console.error("Error bootstrap DB:", err);
}
