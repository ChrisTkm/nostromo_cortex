WITH
region_sales AS (
    SELECT region, SUM(amount) AS total
    FROM transactions
    GROUP BY region
),
top_regions AS (
    SELECT region, total
    FROM region_sales
    WHERE total > 1000
)
SELECT r.region, r.total, t.target
FROM top_regions r
JOIN targets t ON r.region = t.region
ORDER BY r.total DESC;
