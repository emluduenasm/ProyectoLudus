ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fixed_costs NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS site_profit_percent NUMERIC(7,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS designer_commission_type TEXT NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS designer_commission_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS designer_base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS designer_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

UPDATE products
   SET product_cost = COALESCE(NULLIF(product_cost, 0), price, 0),
       designer_base_price = COALESCE(NULLIF(designer_base_price, 0), price, 0)
 WHERE COALESCE(product_cost, 0) = 0
   AND COALESCE(fixed_costs, 0) = 0
   AND COALESCE(site_profit_percent, 0) = 0
   AND COALESCE(designer_commission_value, 0) = 0;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS designer_base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS designer_commission_type TEXT NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS designer_commission_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS designer_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pricing_snapshot JSONB;

UPDATE order_items
   SET designer_base_price = COALESCE(NULLIF(designer_base_price, 0), unit_price, 0)
 WHERE COALESCE(designer_base_price, 0) = 0;
