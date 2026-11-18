import { fetchAllFeeds } from './feeds.js';
import * as db from './supabase.js';
import * as llm from './nvidia.js';

const NEWS_TTL = 10 * 60; // seconds — live-feed mode only
const BRIEFING_TTL = 30 * 60; // seconds — no-database mode only

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    try {
      if (request.method === 'GET' && pathname === '/api/news') return json(await getNews(env, ctx));
      if (request.method === 'GET' && pathname === '/api/briefing') return json(await getBriefing(env, ctx));
      if (request.method === 'GET' && pathname === '/api/status') return json(status(env));
      if (request.method === 'POST' && pathname === '/api/refresh') return handleRefresh(request, env);
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong. Check the Worker logs.' }, 500);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(refresh(env).then((r) => console.log('scheduled refresh', JSON.stringify(r))));
  },
};

function status(env) {
  return {
    supabase: db.isConfigured(env),
    nvidia: llm.isConfigured(env),
    model: llm.isConfigured(env) ? env.NVIDIA_MODEL : null,
  };
}

// ---------- News ----------

async function getNews(env, ctx) {
  if (db.isConfigured(env)) {
    const articles = await db.listArticles(env);
    if (articles.length) return { mode: 'supabase', articles, errors: [] };
    // Fresh database: serve live feeds now and fill the table in the background.
    ctx.waitUntil(refresh(env).catch((e) => console.error('initial refresh failed', e)));
  }
  const live = await cached(ctx, 'news-v1', NEWS_TTL, () => fetchAllFeeds(), (v) => v.articles.length > 0);
  return { mode: 'live', ...live };
}

// ---------- Briefing ----------

async function getBriefing(env, ctx) {
  if (!llm.isConfigured(env)) {
    return { status: 'not_configured', message: 'Add NVIDIA_API_KEY to enable AI briefings.' };
  }
  if (db.isConfigured(env)) {
    const briefing = await db.latestBriefing(env);
    if (briefing) return { status: 'ok', briefing };
  }
  // No database (or none written yet): generate on demand, cached.
  try {
    const briefing = await cached(ctx, 'briefing-v1', BRIEFING_TTL, async () => {
      const { articles } = await getNews(env, ctx);
      if (!articles.length) throw new Error('No articles available to summarize');
      return llm.generateBriefing(env, articles);
    });
    return { status: 'ok', briefing };
  } catch (err) {
    console.error('briefing failed', err);
    return { status: 'error', message: 'The AI briefing could not be generated right now.' };
  }
}

// ---------- Ingestion (cron + manual) ----------

async function refresh(env) {
  const { articles, errors } = await fetchAllFeeds();
  const result = { fetched: articles.length, inserted: 0, briefing: false, errors };
  if (!db.isConfigured(env)) return result;

  const inserted = await db.insertArticles(env, articles);
  result.inserted = inserted?.length ?? 0;

  // Only spend an LLM call when something new arrived (or no briefing exists yet).
  if (llm.isConfigured(env) && (result.inserted > 0 || !(await db.latestBriefing(env)))) {
    const latest = await db.listArticles(env, 25);
    if (latest.length) {
      await db.insertBriefing(env, await llm.generateBriefing(env, latest));
      result.briefing = true;
    }
  }
  return result;
}

async function handleRefresh(request, env) {
  if (!env.ADMIN_TOKEN) return json({ error: 'Set ADMIN_TOKEN to enable manual refresh.' }, 403);
  if (request.headers.get('Authorization') !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: 'Unauthorized' }, 401);
  return json(await refresh(env));
}

// ---------- Helpers ----------

const memory = new Map(); // per-isolate fallback; Cache API is a no-op on *.workers.dev

async function cached(ctx, key, ttlSeconds, produce, shouldCache = () => true) {
  const now = Date.now();
  const mem = memory.get(key);
  if (mem && mem.expires > now) return mem.value;

  const cacheKey = new Request(`https://cache.internal/${key}`);
  const hit = await caches.default.match(cacheKey);
  if (hit) return hit.json();

  const value = await produce();
  if (shouldCache(value)) {
    memory.set(key, { value, expires: now + ttlSeconds * 1000 });
    const res = new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttlSeconds}` },
    });
    ctx.waitUntil(caches.default.put(cacheKey, res));
  }
  return value;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
