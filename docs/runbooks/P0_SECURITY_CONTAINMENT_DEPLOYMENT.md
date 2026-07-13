# P0 security containment deployment runbook

This is a reviewed, direct-`psql` emergency change for the exact pre-00009 KhataPro production schema. It is not a normal migration-history operation. It must be run only by the approved operator, reviewer, and incident commander during a confirmed maintenance window. Migration `00009` must remain unapplied.

The SQL preflight proves schema identity through exact object counts, signatures, definitions, policies, grants, and ACL fingerprints. The operator gate below separately proves routing to the one approved Supabase project. Neither control substitutes for the other.

## Hard stops

Stop without running `pg_dump`, `psql`, or `pg_restore` against production if any of these is true:

- the reviewed commit or either SQL checksum differs;
- `KHATAPRO_APPROVED_DATABASE_URL` is missing, malformed, a URI, contains a password, contains an unsupported/duplicate key, or does not identify the approved project exactly;
- `pgpass.conf` is absent or `-w` authentication fails;
- the identity query does not return database `postgres`, role `postgres`, and a non-loopback server address;
- the application maintenance window cannot be confirmed;
- any relevant active write, blocked lock, ungranted target lock, or transaction older than 60 seconds exists;
- neither a confirmed provider recovery checkpoint nor a verified full custom-format backup is available;
- migration `00009` is present or the SQL preflight reports any drift.

Never paste a password, DSN, access token, service-role value, personal data, or financial row into the incident log.

## 1. Process-only connection validation

Open a new PowerShell process. Set the approved keyword DSN only in that process as `KHATAPRO_APPROVED_DATABASE_URL`; authentication must come from `%APPDATA%\postgresql\pgpass.conf`. Do not set or consult any fallback database variable.

Run this entire block before the first database command. It accepts exactly five unquoted `key=value` tokens and no others. The full DSN is never printed.

```powershell
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ApprovedDsn = [Environment]::GetEnvironmentVariable(
  "KHATAPRO_APPROVED_DATABASE_URL",
  [EnvironmentVariableTarget]::Process
)
if ([string]::IsNullOrWhiteSpace($ApprovedDsn)) {
  throw "KHATAPRO_APPROVED_DATABASE_URL is missing or empty in this process."
}
if ($ApprovedDsn -match "://") { throw "URI DSNs are prohibited." }
if ($ApprovedDsn -match '[''"]') { throw "Quoted DSN values are prohibited." }
if ($ApprovedDsn -match "(?i)(^|\s)password=") { throw "Embedded passwords are prohibited." }
if ($ApprovedDsn -match "(?i)(localhost|127\.0\.0\.1|::1)") { throw "Loopback routing is prohibited." }

$Expected = [ordered]@{
  host    = "aws-1-ap-south-1.pooler.supabase.com"
  port    = "5432"
  dbname  = "postgres"
  user    = "postgres.ebcebxwpddltiwrqybqc"
  sslmode = "require"
}
$Tokens = $ApprovedDsn.Trim() -split "\s+"
if ($Tokens.Count -ne $Expected.Count) { throw "The DSN must contain exactly five tokens." }
$Parsed = @{}
foreach ($Token in $Tokens) {
  if ($Token -notmatch "^([a-z][a-z0-9_]*)=([^\s=]+)$") { throw "Invalid keyword DSN token." }
  $Key = $Matches[1]
  $Value = $Matches[2]
  if (-not $Expected.Contains($Key)) { throw "Unsupported DSN key: $Key" }
  if ($Parsed.ContainsKey($Key)) { throw "Duplicate DSN key: $Key" }
  $Parsed[$Key] = $Value
}
foreach ($Key in $Expected.Keys) {
  if (-not $Parsed.ContainsKey($Key)) { throw "Missing DSN key: $Key" }
  if ($Parsed[$Key] -cne $Expected[$Key]) { throw "Approved DSN identity mismatch for: $Key" }
}

$Pgpass = Join-Path $env:APPDATA "postgresql\pgpass.conf"
if (-not (Test-Path -LiteralPath $Pgpass -PathType Leaf)) { throw "pgpass.conf is absent." }
$env:PGPASSFILE = $Pgpass
$ValidatedProductionDsn = $ApprovedDsn.Trim()
```

Only after that block succeeds, run and assert the database identity. `-w` forbids a password prompt.

```powershell
$Identity = (& psql -w -X --dbname=$ValidatedProductionDsn -At -F "|" -v ON_ERROR_STOP=1 `
  -c "SELECT current_database(), current_user, coalesce(inet_server_addr()::text,'');").Trim()
if ($LASTEXITCODE -ne 0) { throw "Production identity query failed." }
$IdentityParts = $Identity -split "\|", 3
if ($IdentityParts.Count -ne 3) { throw "Unexpected identity-query output." }
if ($IdentityParts[0] -cne "postgres") { throw "Wrong production database." }
if ($IdentityParts[1] -cne "postgres") { throw "Unexpected connected database role." }
if ([string]::IsNullOrWhiteSpace($IdentityParts[2]) -or
    $IdentityParts[2] -in @("127.0.0.1", "::1", "0:0:0:0:0:0:0:1")) {
  throw "Production server address is empty or loopback."
}
```

Every database-connected production command below uses only `$ValidatedProductionDsn`. Do not replace it with an environment-variable reference, empty value, default database, or literal DSN.

## 2. Reviewed artifact and checksum gate

Approved SHA-256 values:

| Artifact | SHA-256 |
|---|---|
| `supabase/migrations/00008k_p0_security_containment.sql` | `3e4cf7de6d2afd409915e68d4c83a94b374e48f90d65b363b5595412b914465f` |
| `supabase/rollback/00008k_p0_security_containment_rollback.sql` | `90e0fa69c136cdb17fc65e7820a17b0cf9f4571770a8615b75ab0a28959a33cb` |

From the reviewed repository root, run:

```powershell
$MigrationPath = (Resolve-Path -LiteralPath "supabase/migrations/00008k_p0_security_containment.sql").Path
$RollbackPath = (Resolve-Path -LiteralPath "supabase/rollback/00008k_p0_security_containment_rollback.sql").Path
$ExpectedMigrationHash = "3e4cf7de6d2afd409915e68d4c83a94b374e48f90d65b363b5595412b914465f"
$ExpectedRollbackHash = "90e0fa69c136cdb17fc65e7820a17b0cf9f4571770a8615b75ab0a28959a33cb"

function Assert-ArtifactHash([string]$Path, [string]$ExpectedHash) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "SQL artifact is absent: $Path" }
  $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($Actual -cne $ExpectedHash) { throw "SQL artifact checksum mismatch: $Path" }
}

Assert-ArtifactHash $MigrationPath $ExpectedMigrationHash
Assert-ArtifactHash $RollbackPath $ExpectedRollbackHash
```

Record the reviewed commit and both verified hashes. Never run a differing migration or rollback file.

## 3. Backup and recovery gate

Set `KHATAPRO_APPROVED_BACKUP_DIR` to an existing, access-controlled absolute directory outside the repository. This block creates a public-schema custom backup and a full custom-format backup, verifies nonzero size, computes SHA-256, and proves both archives can be listed.

```powershell
$BackupRoot = [Environment]::GetEnvironmentVariable(
  "KHATAPRO_APPROVED_BACKUP_DIR",
  [EnvironmentVariableTarget]::Process
)
if ([string]::IsNullOrWhiteSpace($BackupRoot) -or -not [IO.Path]::IsPathRooted($BackupRoot)) {
  throw "Approved backup directory must be a nonempty absolute path."
}
if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
  throw "Approved backup directory does not exist."
}
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$SchemaDump = Join-Path $BackupRoot "khatapro-p0-$Stamp-public-schema.dump"
$FullDump = Join-Path $BackupRoot "khatapro-p0-$Stamp-full.dump"

& pg_dump -w --dbname=$ValidatedProductionDsn --format=custom --schema-only --schema=public `
  --file=$SchemaDump
if ($LASTEXITCODE -ne 0) { throw "Schema backup failed." }

& pg_dump -w --dbname=$ValidatedProductionDsn --format=custom --file=$FullDump
if ($LASTEXITCODE -ne 0) { throw "Full backup failed." }

foreach ($Dump in @($SchemaDump, $FullDump)) {
  $Item = Get-Item -LiteralPath $Dump
  if ($Item.Length -le 0) { throw "Backup is empty: $Dump" }
  $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Dump).Hash.ToLowerInvariant()
  $null = & pg_restore --list $Dump
  if ($LASTEXITCODE -ne 0) { throw "pg_restore archive listing failed: $Dump" }
  [pscustomobject]@{ Path = $Dump; Bytes = $Item.Length; Sha256 = $Hash }
}
```

The schema archive includes public functions, ACLs, policies, triggers, and grants. Record paths, nonzero byte sizes, hashes, `pg_dump`/server versions, start/end times, exit codes, and successful `pg_restore --list` results.

Before approval, record either a confirmed Supabase PITR/provider recovery checkpoint with its timestamp and owner, or the verified full dump above. If neither exists, stop.

### Local restore rehearsal

Rehearse only in an empty disposable local database named `khatapro_p0_restore_rehearsal`. In a separate process, obtain a password-free keyword DSN from the local DBA, parse it with the same duplicate/unsupported/password/URI rules, and require `host=localhost`, `dbname=khatapro_p0_restore_rehearsal`, and `user=postgres`. Store it only in `$ValidatedLocalRestoreDsn`; never use `$ValidatedProductionDsn` for a rehearsal restore.

```powershell
$LocalIdentity = (& psql -w -X --dbname=$ValidatedLocalRestoreDsn -At -F "|" -v ON_ERROR_STOP=1 `
  -c "SELECT current_database(), current_user, inet_server_addr()::text;").Trim()
if ($LASTEXITCODE -ne 0 -or $LocalIdentity -notlike "khatapro_p0_restore_rehearsal|postgres|*") {
  throw "Disposable restore target identity failed."
}
& pg_restore -w --exit-on-error --no-owner --dbname=$ValidatedLocalRestoreDsn $FullDump
if ($LASTEXITCODE -ne 0) { throw "Disposable full restore rehearsal failed." }
```

After restore, run the object-count, signature, policy, and row-count checks on the local rehearsal database, record results, then have the local DBA destroy that disposable database. A rehearsal must never target production.

## 4. Maintenance, active-session, and lock gate

The incident commander must place the application and workers in maintenance mode and stop new posting traffic. Require an explicit process confirmation:

```powershell
if ([Environment]::GetEnvironmentVariable(
      "KHATAPRO_MAINTENANCE_CONFIRMED",
      [EnvironmentVariableTarget]::Process
    ) -cne "YES-P0-SECURITY-CONTAINMENT") {
  throw "Application maintenance mode is not confirmed."
}
```

Capture these read-only inventories immediately before deployment:

```powershell
$SessionInventorySql = @'
SELECT pid, usename, application_name, client_addr, state,
       now()-xact_start AS transaction_age, wait_event_type, wait_event,
       left(query,180) AS query_excerpt
FROM pg_stat_activity
WHERE pid <> pg_backend_pid() AND xact_start IS NOT NULL
ORDER BY xact_start;

SELECT pid, usename, application_name, state, wait_event_type, wait_event,
       left(query,180) AS query_excerpt
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
  AND query ~* '\m(profiles|purchases|purchase_payments|purchase_returns|purchase_return_items)\M'
ORDER BY pid;

SELECT blocked.pid AS blocked_pid, blocker.pid AS blocker_pid,
       blocked.wait_event_type, blocked.wait_event,
       left(blocked.query,160) AS blocked_query,
       left(blocker.query,160) AS blocker_query
FROM pg_stat_activity blocked
CROSS JOIN LATERAL unnest(pg_blocking_pids(blocked.pid)) blocker_pid
JOIN pg_stat_activity blocker ON blocker.pid=blocker_pid
ORDER BY blocked.pid, blocker.pid;

SELECT c.relname, l.locktype, l.mode, l.granted, l.pid,
       a.usename, a.state, a.wait_event_type, a.wait_event
FROM pg_locks l
JOIN pg_class c ON c.oid=l.relation
LEFT JOIN pg_stat_activity a ON a.pid=l.pid
WHERE c.relnamespace='public'::regnamespace
  AND c.relname IN ('profiles','purchases','purchase_payments','purchase_returns','purchase_return_items')
ORDER BY c.relname,l.granted,l.mode,l.pid;
'@
$SessionInventorySql | & psql -w -X --dbname=$ValidatedProductionDsn -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw "Session/lock inventory failed." }

$StopCountsSql = @'
SELECT
  (SELECT count(*) FROM pg_stat_activity
   WHERE pid<>pg_backend_pid() AND xact_start IS NOT NULL
     AND now()-xact_start > interval '60 seconds') AS long_transactions,
  (SELECT count(*) FROM pg_stat_activity
   WHERE pid<>pg_backend_pid() AND state='active'
     AND query ~* '\m(profiles|purchases|purchase_payments|purchase_returns|purchase_return_items)\M'
     AND query ~* '(insert|update|delete|merge|post_|record_|create_stock_movement)') AS active_relevant_writes,
  (SELECT count(*) FROM pg_stat_activity
   WHERE pid<>pg_backend_pid() AND cardinality(pg_blocking_pids(pid))>0) AS blocked_sessions,
  (SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
   WHERE NOT l.granted AND c.relnamespace='public'::regnamespace
     AND c.relname IN ('profiles','purchases','purchase_payments','purchase_returns','purchase_return_items'))
     AS ungranted_target_locks;
'@
$StopCounts = ($StopCountsSql | & psql -w -X --dbname=$ValidatedProductionDsn -At -F "|" -v ON_ERROR_STOP=1).Trim()
if ($LASTEXITCODE -ne 0) { throw "Session stop-count query failed." }
if ($StopCounts -cne "0|0|0|0") { throw "Unsafe active-session/lock state: $StopCounts" }
```

The documented threshold is 60 seconds. Any unexpected active posting transaction, blocked session, ungranted relevant lock, nonzero stop tuple, or inability to confirm maintenance mode is a hard stop. Do not terminate sessions without separate incident-commander authorization.

## 5. Apply

Recheck the exact migration hash immediately before execution, then run the file directly. Do not insert a migration-history row.

```powershell
Assert-ArtifactHash $MigrationPath $ExpectedMigrationHash
& psql -w -X --dbname=$ValidatedProductionDsn -v ON_ERROR_STOP=1 --file=$MigrationPath
if ($LASTEXITCODE -ne 0) { throw "P0 containment migration failed; keep maintenance mode and investigate." }
```

The file is transactional, has 5-second lock and 30-second statement timeouts, and has no `CASCADE`. Its preflight accepts only the exact baseline or this file's exact contained state. On failure, do not retry until the error is classified as transient locking or reviewed schema drift.

## 6. Immediate database verification

Run the following read-only checks and attach their output to the incident record:

```powershell
$PostflightSql = @'
BEGIN READ ONLY;
SELECT
 (SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind IN ('r','p')) AS tables,
 (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace) AS functions,
 (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) AS triggers,
 (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
  WHERE c.relnamespace='public'::regnamespace) AS policies;

WITH classified(kind,signature) AS (VALUES
 ('report','public.account_ledger(text,text,date,date)'),
 ('report','public.day_book(text,date,date,text)'),
 ('report','public.negative_stock_report(text)'),
 ('report','public.pending_stock_report(text)'),
 ('report','public.report_balance_sheet(text,date)'),
 ('report','public.report_cash_flow(text,date,date)'),
 ('report','public.report_customer_outstanding(text)'),
 ('report','public.report_expense_summary(text,date,date)'),
 ('report','public.report_inventory_valuation(text)'),
 ('report','public.report_profit_loss(text,date,date)'),
 ('report','public.report_sales_summary(text,date,date)'),
 ('report','public.report_vendor_outstanding(text)'),
 ('report','public.rider_dashboard_summary(text,text)'),
 ('report','public.rider_ledger(text,text,date,date)'),
 ('report','public.trial_balance(text,date,date)'),
 ('report','public.vendor_ledger(text,text,date,date)'),
 ('mutation','public.assign_rider_to_order(text,text,text,uuid)'),
 ('mutation','public.cancel_voucher(text,uuid,text)'),
 ('mutation','public.confirm_cod_submission(text,text,numeric,text,numeric,text,uuid)'),
 ('mutation','public.create_cod_submission(text,text,jsonb,text,numeric,text,uuid)'),
 ('mutation','public.create_stock_movement(text,text,text,integer,text,date,uuid,numeric)'),
 ('mutation','public.mark_order_delivered(text,text,numeric,text,text,uuid)'),
 ('mutation','public.mark_order_returned(text,text,text,uuid)'),
 ('mutation','public.post_advance_application(text,text,text,numeric,date,text,uuid)'),
 ('mutation','public.post_contra_entry(text,date,text,text,numeric,text,text,uuid)'),
 ('mutation','public.post_expense_batch(text,date,text,jsonb,text,text,uuid)'),
 ('mutation','public.post_journal_voucher(text,date,text,jsonb,text,uuid)'),
 ('mutation','public.post_payment_voucher(text,date,text,text,numeric,text,text,text,uuid)'),
 ('mutation','public.post_purchase(text,text,date,text,jsonb,jsonb,numeric,numeric,text,uuid)'),
 ('mutation','public.post_purchase_replacement(text,text,jsonb,date,text,uuid)'),
 ('mutation','public.post_purchase_return(text,text,jsonb,text,text,date,text,uuid)'),
 ('mutation','public.post_receipt_voucher(text,date,text,text,numeric,text,text,text,uuid)'),
 ('mutation','public.post_sale(text,text,date,jsonb,jsonb,text,text,text,text,text,text,text,uuid)'),
 ('mutation','public.post_sales_return(text,text,date,text,uuid)'),
 ('mutation','public.post_vendor_advance(text,text,text,numeric,date,text,uuid)'),
 ('mutation','public.post_vendor_payment(text,text,text,numeric,date,text,text,uuid)'),
 ('mutation','public.post_voucher(text,text,date,text,jsonb,text,text,uuid)'),
 ('mutation','public.recalculate_product_cost(text)'),
 ('mutation','public.reject_cod_submission(text,text,uuid,text)'),
 ('mutation','public.reverse_voucher_safe(text,text,uuid,text)'),
 ('mutation','public.update_delivery_status(text,text,text,text,uuid)'))
SELECT role_name,kind,count(*) FILTER(WHERE has_function_privilege(role_name,signature,'EXECUTE')) AS executable
FROM classified CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) r(role_name)
GROUP BY role_name,kind ORDER BY role_name,kind;

SELECT count(*) AS public_executable_security_definer
FROM pg_proc p
WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
  AND has_function_privilege('public',p.oid,'EXECUTE');

SELECT has_table_privilege('anon','public.profiles','UPDATE') AS anon_table_update,
 has_table_privilege('authenticated','public.profiles','UPDATE') AS authenticated_table_update,
 has_column_privilege('authenticated','public.profiles','display_name','UPDATE') AS display_update,
 has_column_privilege('authenticated','public.profiles','phone','UPDATE') AS phone_update,
 has_column_privilege('authenticated','public.profiles','role_id','UPDATE') AS role_update,
 has_table_privilege('service_role','public.profiles','UPDATE') AS service_admin;

SELECT p.proname,p.proowner::regrole,p.prosecdef,p.proconfig,p.proacl,md5(p.prosrc)
FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
 AND p.proname IN ('_contain_purchase_payment_tenant','_contain_purchase_return_header','_contain_purchase_return_item','_reconcile_return_header_total')
ORDER BY p.proname;
ROLLBACK;
'@
$PostflightSql | & psql -w -X --dbname=$ValidatedProductionDsn -v ON_ERROR_STOP=1
if ($LASTEXITCODE -ne 0) { throw "Post-deployment database verification failed." }
```

Expected: `39/57/25/54`; PUBLIC-executable security-definer functions `11`; anon mutation/report `0/0`; authenticated mutation/report `0/0`; service role `25/16`; profile table UPDATE false/false, display/phone true/true, protected role false, service administration true. The four helpers must be owned by `postgres`, be SECURITY DEFINER, use `pg_catalog, public, pg_temp`, have no direct caller EXECUTE, and retain their reviewed body hashes.

## 7. Controlled application smoke matrix

Use only the approved test business and approved reversible test records. Never use real customer/vendor records without formal operator approval. Capture the application action, RPC/database identifiers, balanced voucher evidence, relevant ledger/stock result, timestamps, and cleanup outcome. Any unexpected error, tenant mismatch, imbalance, privilege leak, duplicate, unreversible fixture, or protected-profile edit is a stop/rollback candidate.

| Workflow | Expected outcome | Evidence to capture | Cleanup/reversal | Stop/rollback condition |
|---|---|---|---|---|
| Counter/online sale | Normal posting succeeds through the server path; totals, stock and voucher balance agree. | Sale/invoice ID, RPC success, voucher debit=credit, stock movement IDs. | Approved sale-return/cancel procedure. | Posting denial, imbalance, wrong tenant, or stock mismatch. |
| Receipt voucher | Receipt posts and customer allocation/ledger result remains correct. | Receipt/voucher IDs, balanced lines, customer ledger delta. | Approved voucher reversal. | RPC denial, allocation error, imbalance, or duplicate. |
| Normal purchase | Purchase with valid initial `purchase_payment` rows succeeds. | Purchase/payment/voucher IDs, paid/outstanding totals, stock-in. | Approved purchase reversal/return protocol. | Initial payments rejected, overpay accepted, imbalance, or stock mismatch. |
| Vendor advance | Valid active same-business vendor/account with NULL purchase succeeds. | Advance/payment/voucher IDs and vendor ledger delta. | Approved reversal/application cleanup. | NULL path rejected when valid, linked advance accepted, or cross-tenant account accepted. |
| Vendor later payment | Valid linked amount within locked outstanding succeeds. | Payment/voucher IDs and before/after outstanding. | Approved voucher/payment reversal. | NULL purchase accepted, overpay accepted, or tenant/vendor mismatch accepted. |
| Valid vendor-refund purchase return | Source item, source price/product and active same-business refund account succeed. | Return/item/voucher/stock IDs and returned quantity. | Approved return reversal protocol. | Forged source, bad account, excess quantity, or item drift accepted. |
| Reduce-payable return | NULL settlement account succeeds and payable is reduced. | Return/voucher IDs and vendor payable ledger delta. | Approved return reversal protocol. | Supplied unrelated account accepted or payable result wrong. |
| Purchase replacement | Existing replacement path completes without guard regression. | Replacement/voucher/stock IDs and original/replacement linkage. | Approved replacement reversal. | Posting denial, tenant mismatch, imbalance, or stock mismatch. |
| General voucher | Balanced approved voucher posts and reverses. | Voucher ID, line totals, ledger delta. | `reverse_voucher_safe`/approved reversal. | Mutation denial, imbalance, or reversal failure. |
| Delivery assignment/status | Rider assignment and controlled status transition succeed. | Order/rider IDs, before/after status and audit record. | Restore through approved status workflow. | RPC denial, illegal transition, or cross-business change. |
| COD collection/allocation/settlement | Submission, allocation and settlement preserve net ledger balances. | Submission/item/voucher IDs and rider/COD ledger totals. | Approved rejection/reversal protocol. | Allocation mismatch, imbalance, duplicate, or tenant leak. |
| Profit & Loss | Report opens through server role and totals match the controlled fixture. | Parameters, response success, expected totals. | None; read-only. | Access denial, anonymous access, or wrong totals. |
| Balance Sheet | Report opens and balances. | As-of date, response success, assets=liabilities+equity evidence. | None; read-only. | Access denial, anonymous access, or imbalance. |
| Trial Balance and ledgers | Trial balance and representative account/vendor/rider ledgers open and reconcile. | Parameters, response success, debit/credit and ledger totals. | None; read-only. | Access denial, anonymous access, or reconciliation mismatch. |
| Profile display name/phone | Authenticated user can update only own approved display fields. | Before/after permitted columns and unchanged protected columns. | Restore prior display values. | Permitted fields denied or protected field changes. |
| Owner/admin profile administration | Server-side owner/admin workflow can update role/business/active state as approved. | Admin action, audit evidence, protected before/after values. | Restore approved test profile state. | Service administration denied, unaudited change, or direct authenticated bypass. |

Keep maintenance mode active through all mandatory smoke tests. Clean up through normal application reversal workflows; do not directly repair the four historical over-return groups, the 27 purchase outstanding inconsistencies, COD mismatches, or any other historical data in this deployment.

## 8. Rollback decision and command

Rollback requires incident-commander approval when exact postflight counts differ, required service-role workflows fail, profile administration is blocked, a guard rejects a confirmed legitimate workflow, or lock/latency impact cannot be mitigated. Rollback reopens the captured pre-containment RPC/profile privileges; keep traffic stopped until a corrected forward containment is ready.

Before rollback, reconfirm production identity, maintenance mode, the `0|0|0|0` session/lock stop tuple, and the rollback checksum. The rollback SQL independently refuses any contained-state drift.

```powershell
Assert-ArtifactHash $RollbackPath $ExpectedRollbackHash
& psql -w -X --dbname=$ValidatedProductionDsn -v ON_ERROR_STOP=1 --file=$RollbackPath
if ($LASTEXITCODE -ne 0) { throw "P0 rollback failed or refused drift; keep maintenance mode and escalate." }
```

After rollback, expect `39/53/21/54`, all four containment pairs absent, zero profile column ACLs, the captured profile table ACL restored, all 41 target raw RPC ACLs restored exactly, policies/definitions/data unchanged, and migration `00009` still absent. Repeat the read-only inventory and preserve all logs.

## 9. Remaining risk and incident record

Eleven pre-existing PUBLIC-executable SECURITY DEFINER helpers remain intentionally unchanged: four RLS identity helpers (`current_profile`, `current_business_id`, `has_permission`, `is_owner`), six numbering helpers, and `no_owner_exists`. They require a separate authorization/RLS/bootstrap compatibility project. This emergency change also does not reconcile historical financial inconsistencies.

Record: ticket/change ID; project ref; deployer/reviewer/incident commander; reviewed commit and SQL hashes; maintenance start/end; client/server versions; identity assertion result without DSN; backup paths/sizes/hashes/archive-list results and recovery checkpoint; all session/lock, preflight, postflight and smoke outputs; command exit codes; timeout events; fixture IDs; cleanup/reversal evidence; exception text; rollback decision/approver/timestamps; final state; and explicit confirmation that migration `00009` remained unapplied.