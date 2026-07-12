// Fetch PostgREST OpenAPI spec — exposes ALL tables, columns, procedures
// with their parameter signatures.
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('/home/z/my-project/.env.local', 'utf8')
    .split('\n')
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const [k, ...rest] = l.split('=');
      return [k.trim(), rest.join('=').trim()];
    })
);

const url = env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/';
const key = env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(url, {
  headers: {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Accept': 'application/openapi+json'
  }
});
const text = await res.text();
writeFileSync('/home/z/my-project/audit-out/postgrest-openapi.json', text);
console.log('Status:', res.status, 'Bytes:', text.length);
// Quick summary
const spec = JSON.parse(text);
const paths = Object.keys(spec.paths || {});
console.log('Total paths:', paths.length);
const tablePaths = paths.filter(p => !p.startsWith('/rpc/'));
const rpcPaths = paths.filter(p => p.startsWith('/rpc/'));
console.log('Table paths:', tablePaths.length);
console.log('RPC paths:', rpcPaths.length);
console.log('RPCs:', rpcPaths.map(p => p.replace('/rpc/','')));
