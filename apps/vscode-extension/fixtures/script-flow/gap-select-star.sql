WITH active_accounts AS (
  SELECT
    account.id,
    account.code,
    account.name
  FROM accounts account
  WHERE account.is_active = true
)
SELECT *
FROM active_accounts acc
WHERE acc.id IN (
  SELECT account_id
  FROM audit_flags
  WHERE severity = 'high'
);
