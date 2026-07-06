CREATE TABLE IF NOT EXISTS product_cost_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_cost_components_product_idx
  ON product_cost_components(product_id, sort_order);

INSERT INTO product_cost_components (product_id, name, amount, sort_order)
SELECT p.id, 'Costos fijos', p.fixed_costs, 0
  FROM products p
 WHERE COALESCE(p.fixed_costs, 0) > 0
   AND NOT EXISTS (
     SELECT 1
       FROM product_cost_components c
      WHERE c.product_id = p.id
   );
