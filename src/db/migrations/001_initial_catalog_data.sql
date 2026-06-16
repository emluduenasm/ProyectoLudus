CREATE EXTENSION IF NOT EXISTS pgcrypto;

WITH seed_categories(name, slug, description) AS (
  VALUES
    ('Ilustración digital', 'ilustracion-digital', 'Arte vectorial, retratos digitales y gráficos coloridos.'),
    ('Tipografía & frases', 'tipografia', 'Lettering, frases motivacionales y caligrafía moderna.'),
    ('Naturaleza y botánica', 'naturaleza', 'Flores, hojas y paisajes relajantes.'),
    ('Geométrico / abstracto', 'abstracto', 'Figuras geométricas, gradientes y composiciones audaces.'),
    ('Geek & retro', 'geek', 'Videojuegos, nostalgia pixel art y cultura pop.'),
    ('Otros', 'otros', 'Categoría comodín para diseños experimentales.')
)
INSERT INTO categories (name, slug, description, active)
SELECT name, slug, description, TRUE
FROM seed_categories
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  active = TRUE,
  updated_at = NOW();

WITH seed_personas(first_name, last_name, dni) AS (
  VALUES
    ('Lucía', 'Admin', '90000001'),
    ('Mariana', 'Creativa', '90000002'),
    ('Juan', 'Pérez', '91000001'),
    ('María', 'López', '91000002'),
    ('Ana', 'Martínez', '91000003'),
    ('Pedro', 'García', '91000004'),
    ('Laura', 'Sánchez', '91000005'),
    ('Carlos', 'Ruiz', '91000006'),
    ('Sofía', 'Gómez', '91000007'),
    ('Alejandro', 'Torres', '91000008'),
    ('Andrea', 'Ramírez', '91000009'),
    ('Luis', 'Fernández', '91000010'),
    ('Marta', 'Díaz', '91000011'),
    ('Fernando', 'Ortiz', '91000012')
)
INSERT INTO personas (first_name, last_name, dni)
SELECT first_name, last_name, dni
FROM seed_personas
ON CONFLICT (dni) DO NOTHING;

WITH seed_users(email, username, name, role, use_preference, avatar_url, dni, password) AS (
  VALUES
    ('admin@ludus.dev', 'admin', 'Lucía Admin', 'admin', 'upload', '/img/disenador1.jpg', '90000001', current_setting('app.seed_admin_password', true)),
    ('creativa@ludus.dev', 'creativa', 'Mariana Creativa', 'designer', 'upload', '/img/disenador2.jpg', '90000002', current_setting('app.seed_designer_password', true)),
    ('juan.perez@legacy.ludus.local', 'juan-perez', 'Juan Pérez', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000001', encode(gen_random_bytes(18), 'hex')),
    ('maria.lopez@legacy.ludus.local', 'maria-lopez', 'María López', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000002', encode(gen_random_bytes(18), 'hex')),
    ('ana.martinez@legacy.ludus.local', 'ana-martinez', 'Ana Martínez', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000003', encode(gen_random_bytes(18), 'hex')),
    ('pedro.garcia@legacy.ludus.local', 'pedro-garcia', 'Pedro García', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000004', encode(gen_random_bytes(18), 'hex')),
    ('laura.sanchez@legacy.ludus.local', 'laura-sanchez', 'Laura Sánchez', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000005', encode(gen_random_bytes(18), 'hex')),
    ('carlos.ruiz@legacy.ludus.local', 'carlos-ruiz', 'Carlos Ruiz', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000006', encode(gen_random_bytes(18), 'hex')),
    ('sofia.gomez@legacy.ludus.local', 'sofia-gomez', 'Sofía Gómez', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000007', encode(gen_random_bytes(18), 'hex')),
    ('alejandro.torres@legacy.ludus.local', 'alejandro-torres', 'Alejandro Torres', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000008', encode(gen_random_bytes(18), 'hex')),
    ('andrea.ramirez@legacy.ludus.local', 'andrea-ramirez', 'Andrea Ramírez', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000009', encode(gen_random_bytes(18), 'hex')),
    ('luis.fernandez@legacy.ludus.local', 'luis-fernandez', 'Luis Fernández', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000010', encode(gen_random_bytes(18), 'hex')),
    ('marta.diaz@legacy.ludus.local', 'marta-diaz', 'Marta Díaz', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000011', encode(gen_random_bytes(18), 'hex')),
    ('fernando.ortiz@legacy.ludus.local', 'fernando-ortiz', 'Fernando Ortiz', 'designer', 'upload', '/img/uploads/avatars/default.png', '91000012', encode(gen_random_bytes(18), 'hex'))
)
INSERT INTO users (name, username, email, password_hash, role, use_preference, persona_id, banned, avatar_url)
SELECT su.name,
       su.username,
       su.email,
       crypt(su.password, gen_salt('bf')),
       su.role,
       su.use_preference,
       p.id,
       FALSE,
       su.avatar_url
FROM seed_users su
LEFT JOIN personas p ON p.dni = su.dni
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(su.email)
);

WITH seed_designers(email, display_name, avatar_url) AS (
  VALUES
    ('admin@ludus.dev', 'Lucía Admin', '/img/disenador1.jpg'),
    ('creativa@ludus.dev', 'Mariana Creativa', '/img/disenador2.jpg'),
    ('juan.perez@legacy.ludus.local', 'Juan Pérez', '/img/uploads/avatars/default.png'),
    ('maria.lopez@legacy.ludus.local', 'María López', '/img/uploads/avatars/default.png'),
    ('ana.martinez@legacy.ludus.local', 'Ana Martínez', '/img/uploads/avatars/default.png'),
    ('pedro.garcia@legacy.ludus.local', 'Pedro García', '/img/uploads/avatars/default.png'),
    ('laura.sanchez@legacy.ludus.local', 'Laura Sánchez', '/img/uploads/avatars/default.png'),
    ('carlos.ruiz@legacy.ludus.local', 'Carlos Ruiz', '/img/uploads/avatars/default.png'),
    ('sofia.gomez@legacy.ludus.local', 'Sofía Gómez', '/img/uploads/avatars/default.png'),
    ('alejandro.torres@legacy.ludus.local', 'Alejandro Torres', '/img/uploads/avatars/default.png'),
    ('andrea.ramirez@legacy.ludus.local', 'Andrea Ramírez', '/img/uploads/avatars/default.png'),
    ('luis.fernandez@legacy.ludus.local', 'Luis Fernández', '/img/uploads/avatars/default.png'),
    ('marta.diaz@legacy.ludus.local', 'Marta Díaz', '/img/uploads/avatars/default.png'),
    ('fernando.ortiz@legacy.ludus.local', 'Fernando Ortiz', '/img/uploads/avatars/default.png')
)
INSERT INTO designers (user_id, display_name, avatar_url)
SELECT u.id, sd.display_name, sd.avatar_url
FROM seed_designers sd
JOIN users u ON LOWER(u.email) = LOWER(sd.email)
ON CONFLICT (user_id)
DO UPDATE SET
  display_name = EXCLUDED.display_name,
  avatar_url = COALESCE(NULLIF(EXCLUDED.avatar_url, ''), designers.avatar_url);

INSERT INTO products (
  name,
  description,
  price,
  stock,
  image_url,
  published,
  curve_x_pct,
  curve_y_pct,
  curve_top_pct,
  curve_bottom_pct,
  curve_left_pct,
  curve_right_pct,
  mockup_config
)
SELECT
  'Remera básica',
  'Remera blanca lista para personalizar con tus diseños.',
  14999,
  25,
  '/img/productos/producto-remera.jpg',
  TRUE,
  0,
  0,
  0,
  0,
  0,
  0,
  jsonb_build_object(
    'width_pct', 0.45,
    'height_pct', 0.45,
    'top_pct', 0.5,
    'left_pct', 0.5,
    'curve_top_pct', 0,
    'curve_bottom_pct', 0,
    'curve_left_pct', 0,
    'curve_right_pct', 0,
    'curve_x_pct', 0,
    'curve_y_pct', 0,
    'blend', 'multiply'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM products WHERE LOWER(name) = 'remera básica'
);

WITH seed_designs(title, description, image_url, category_slug, designer_email, created_at) AS (
  VALUES
    ('Flores en Azules', 'Ilustración botánica pensada para remeras y tote bags.', '/img/diseno1.jpg', 'naturaleza', 'creativa@ludus.dev', NULL::timestamptz),
    ('Tipografía Urban', 'Lettering moderno ideal para buzos o posters.', '/img/diseno4.jpg', 'tipografia', 'creativa@ludus.dev', NULL::timestamptz),
    ('Geometría Pastel', 'Composición abstracta en tonos pastel para mates o tazas.', '/img/diseno7.jpg', 'abstracto', 'creativa@ludus.dev', NULL::timestamptz),
    ('Retro Pixels', 'Personaje retro inspirado en los videojuegos de 8 bits.', '/img/diseno3.jpg', 'geek', 'creativa@ludus.dev', NULL::timestamptz),
    ('Robotik', 'Diseño importado desde la landing estática histórica.', '/img/diseno1.jpg', 'otros', 'juan.perez@legacy.ludus.local', '2023-04-01'::timestamptz),
    ('Samurai Warrior', 'Diseño importado desde la landing estática histórica.', '/img/diseno2.jpg', 'otros', 'maria.lopez@legacy.ludus.local', '2023-06-15'::timestamptz),
    ('Floreados', 'Diseño importado desde la landing estática histórica.', '/img/diseno3.jpg', 'otros', 'ana.martinez@legacy.ludus.local', '2023-09-10'::timestamptz),
    ('Colección Invierno', 'Diseño importado desde la landing estática histórica.', '/img/diseno4.jpg', 'otros', 'pedro.garcia@legacy.ludus.local', '2023-12-20'::timestamptz),
    ('Colección Exclusiva', 'Diseño importado desde la landing estática histórica.', '/img/diseno5.jpg', 'otros', 'laura.sanchez@legacy.ludus.local', '2023-03-05'::timestamptz),
    ('Colección Limitada', 'Diseño importado desde la landing estática histórica.', '/img/diseno6.jpg', 'otros', 'carlos.ruiz@legacy.ludus.local', '2023-02-28'::timestamptz),
    ('Colección Elegante', 'Diseño importado desde la landing estática histórica.', '/img/diseno7.jpg', 'otros', 'sofia.gomez@legacy.ludus.local', '2023-01-17'::timestamptz),
    ('Colección Casual', 'Diseño importado desde la landing estática histórica.', '/img/diseno8.jpg', 'otros', 'alejandro.torres@legacy.ludus.local', '2023-07-22'::timestamptz),
    ('Colección Formal', 'Diseño importado desde la landing estática histórica.', '/img/diseno9.jpg', 'otros', 'andrea.ramirez@legacy.ludus.local', '2023-05-30'::timestamptz),
    ('Colección Moderna', 'Diseño importado desde la landing estática histórica.', '/img/diseno10.jpg', 'otros', 'luis.fernandez@legacy.ludus.local', '2023-11-12'::timestamptz),
    ('Colección Retro', 'Diseño importado desde la landing estática histórica.', '/img/diseno11.jpg', 'otros', 'marta.diaz@legacy.ludus.local', '2023-08-18'::timestamptz),
    ('Colección Juvenil', 'Diseño importado desde la landing estática histórica.', '/img/diseno12.jpg', 'otros', 'fernando.ortiz@legacy.ludus.local', '2023-06-25'::timestamptz)
)
INSERT INTO designs (
  designer_id,
  title,
  description,
  image_url,
  thumbnail_url,
  published,
  review_status,
  category_id,
  created_at,
  updated_at
)
SELECT d.id,
       sd.title,
       sd.description,
       sd.image_url,
       sd.image_url,
       TRUE,
       'approved',
       c.id,
       COALESCE(sd.created_at, NOW()),
       COALESCE(sd.created_at, NOW())
FROM seed_designs sd
JOIN users u ON LOWER(u.email) = LOWER(sd.designer_email)
JOIN designers d ON d.user_id = u.id
LEFT JOIN categories c ON c.slug = sd.category_slug
WHERE NOT EXISTS (
  SELECT 1
  FROM designs existing
  WHERE LOWER(existing.title) = LOWER(sd.title)
    AND existing.designer_id = d.id
);
