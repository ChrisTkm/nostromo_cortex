-- Abre este archivo en Script Flow para ver un warning de CTE sin uso.
-- Esperado: unused_totals recibe una flecha/nota con color de CTE.

WITH unused_totals AS (
  SELECT id, name
  FROM accounts
)
SELECT 1;
