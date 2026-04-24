WITH ledger_totals AS (
  SELECT
    entry.account_id,
    SUM(entry.debit - entry.credit) AS net_total
  FROM ledger_entries entry
  GROUP BY entry.account_id
),
active_accounts AS (
  SELECT
    account.id,
    account.code,
    account.name
  FROM accounts account
  WHERE account.is_active = true
)
SELECT
  acc.code,
  acc.name,
  totals.net_total,
  latest_post.last_posted_at
FROM active_accounts acc
LEFT JOIN ledger_totals totals
  ON totals.account_id = acc.id
INNER JOIN (
  SELECT
    account_id,
    MAX(posted_at) AS last_posted_at
  FROM ledger_entries
  GROUP BY account_id
) latest_post
  ON latest_post.account_id = acc.id
WHERE acc.id IN (
  SELECT account_id
  FROM audit_flags
  WHERE severity = 'high'
);
