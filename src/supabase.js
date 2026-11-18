// Minimal Supabase client over PostgREST — plain fetch, no SDK, so it runs anywhere Workers do.

export const isConfigured = (env) => Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

function authHeaders(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  // New-style keys (sb_secret_…) go in `apikey` only; legacy JWT keys also go in Authorization.
  return key.startsWith('sb_') ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
}

async function rest(env, path, init = {}) {
  const base = env.SUPABASE_URL.replace(/\/+$/, '');
  const res = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(env), ...init.headers },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export function listArticles(env, limit = 60) {
  return rest(
    env,
    `articles?select=url,title,source,description,published_at&order=published_at.desc.nullslast&limit=${limit}`,
  );
}

// Inserts new articles, skipping URLs already stored. Returns only the rows actually inserted.
export async function insertArticles(env, rows) {
  if (!rows.length) return [];
  return rest(env, 'articles?on_conflict=url', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(rows),
  });
}

export async function latestBriefing(env) {
  const rows = await rest(env, 'briefings?select=content,model,sources,created_at&order=created_at.desc&limit=1');
  return rows?.[0] ?? null;
}

export function insertBriefing(env, briefing) {
  return rest(env, 'briefings', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(briefing),
  });
}
