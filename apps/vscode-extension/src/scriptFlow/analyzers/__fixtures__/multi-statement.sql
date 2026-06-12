CREATE TABLE orders (id INT, customer_id INT, total DECIMAL);

INSERT INTO orders (id, customer_id, total) VALUES (1, 42, 99.95);

WITH high_value AS (
    SELECT id, total FROM orders WHERE total > 50
)
SELECT h.id, h.total
FROM high_value h
ORDER BY h.total DESC;
