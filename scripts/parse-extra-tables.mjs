// Parse PostgREST OpenAPI to extract column definitions for additional tables.
import { readFileSync, writeFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync('/home/z/my-project/audit-out/postgrest-openapi.json', 'utf8'));

const EXTRA_TABLES = [
  'purchase_replacements', 'purchase_replacement_items',
  'purchase_payments', 'salesmen', 'vendors', 'accounts',
  'account_categories', 'audit_logs'
];

for (const t of EXTRA_TABLES) {
  const def = spec.definitions?.[t];
  if (!def) {
    console.log(`\n[${t}] MISSING!`);
    continue;
  }
  const props = def.properties || {};
  const required = new Set(def.required || []);
  console.log(`\n[${t}] ${Object.keys(props).length} columns`);
  for (const [name, schema] of Object.entries(props)) {
    const req = required.has(name) ? ' NOT NULL' : ' NULL';
    console.log(`  - ${name} : ${schema.type || '?'}${schema.format ? '/'+schema.format : ''}${req}`);
  }
}
