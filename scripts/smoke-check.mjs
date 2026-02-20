#!/usr/bin/env node

const base = process.env.APP_BASE_URL || 'http://localhost:3000';

async function check(path, expected = [200]) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  const ok = expected.includes(res.status);
  const body = await res.text();
  if (!ok) {
    throw new Error(`${path} -> ${res.status}; expected ${expected.join(',')}; body=${body.slice(0, 200)}`);
  }
  return { path, status: res.status };
}

(async () => {
  const checks = [];
  checks.push(await check('/health', [200]));
  checks.push(await check('/api/auth/me', [401]));
  checks.push(await check('/auth/google', [302]));

  console.log('Smoke checks passed:');
  for (const c of checks) console.log(`- ${c.path}: ${c.status}`);
})().catch((e) => {
  console.error('Smoke check failed:', e.message || e);
  process.exit(1);
});
