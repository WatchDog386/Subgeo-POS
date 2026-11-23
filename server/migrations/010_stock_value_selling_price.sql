-- 010_stock_value_selling_price.sql — stock is valued at the medicine's selling
-- price (what it brings in), as on the dashboards and reports. The value at
-- cost stays available as stock_cost.
DROP VIEW IF EXISTS v_stock;
CREATE VIEW v_stock AS
SELECT b.code AS chemist, p.id AS product_id, p.sku, p.name, c.name AS category, s.name AS supplier,
       p.stock, p.reorder_level, p.max_stock, p.cost, p.price, p.min_price,
       CASE WHEN p.track_stock = 1 AND p.stock > 0 THEN p.stock * p.price ELSE 0 END AS stock_value,
       CASE WHEN p.track_stock = 1 AND p.stock > 0 THEN p.stock * p.cost ELSE 0 END AS stock_cost,
       CASE WHEN p.track_stock = 1 AND p.stock <= p.reorder_level THEN 1 ELSE 0 END AS below_reorder,
       CASE WHEN p.track_stock = 1 AND p.max_stock IS NOT NULL AND p.stock < p.max_stock THEN p.max_stock - p.stock ELSE 0 END AS to_order
FROM products p
JOIN branches b ON b.id = p.branch_id
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN suppliers s ON s.id = p.supplier_id
WHERE p.active = 1;
