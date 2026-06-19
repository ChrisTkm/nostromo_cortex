WITH base AS (
  SELECT
    entry.account_id,
    SUM(entry.debit - entry.credit) AS net_total
  FROM ledger_entries entry
  GROUP BY entry.account_id
)
SELECT
  acc.code,
  totals.net_total
FROM accounts acc
JOIN base totals
WHERE acc.is_active = true;
