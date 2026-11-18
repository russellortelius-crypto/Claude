// News sources and a dependency-free RSS/Atom parser that runs in Workers.

const GOOGLE_NEWS_QUERY =
  '("Persian Gulf" OR "Strait of Hormuz" OR "Gulf of Oman" OR Iran) (conflict OR military OR strike OR navy OR tanker OR attack) when:2d';

// `filter: true` means the feed is general-purpose, so items are kept only
// if they mention the region (see RELEVANCE below).
export const FEEDS = [
  {
    name: 'Google News',
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(GOOGLE_NEWS_QUERY)}&hl=en-US&gl=US&ceid=US:en`,
    filter: false,
  },
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml', filter: true },
  { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', filter: true },
  { name: 'The Guardian', url: 'https://www.theguardian.com/world/middleeast/rss', filter: true },
];

export const RELEVANCE =
  /\b(persian gulf|gulf of oman|arabian gulf|strait of hormuz|hormuz|iran|iranian|tehran|irgc|revolutionary guards?|houthis?|bahrain|qatar|kuwait|uae|emirati|united arab emirates|saudi|oman|iraq|centcom|fifth fleet|tankers?)\b/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

function clean(raw) {
  if (!raw) return '';
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  s = decodeEntities(s); // descriptions are often entity-encoded HTML
  s = s.replace(/<[^>]+>/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function toIso(date) {
  const t = Date.parse(clean(date));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseFeed(xml, sourceName) {
  const items = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];

  for (const block of blocks) {
    let title = clean(tag(block, 'title'));
    let link = clean(tag(block, 'link'));
    if (!link) {
      // Atom: <link href="..." rel="alternate"/>
      const m = block.match(/<link[^>]*href="([^"]+)"/i);
      link = m ? decodeEntities(m[1]) : '';
    }
    if (!title || !/^https?:\/\//i.test(link)) continue;

    // Google News puts the outlet in <source> and appends " - Outlet" to titles.
    const outlet = clean(tag(block, 'source'));
    if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3));

    let description = clean(tag(block, 'description') || tag(block, 'summary'));
    if (description === title || description.startsWith(title)) description = '';

    items.push({
      url: link,
      title,
      source: outlet || sourceName,
      description: description.slice(0, 500) || null,
      published_at: toIso(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated')),
    });
  }
  return items;
}

async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': 'GulfNewsMonitor/0.1 (+rss reader)', Accept: 'application/rss+xml, application/xml, text/xml' },
    cf: { cacheTtl: 300 },
  });
  if (!res.ok) throw new Error(`${feed.name}: HTTP ${res.status}`);
  const items = parseFeed(await res.text(), feed.name);
  return feed.filter ? items.filter((i) => RELEVANCE.test(`${i.title} ${i.description ?? ''}`)) : items;
}

// Fetch every feed in parallel; a failing source is reported, not fatal.
export async function fetchAllFeeds(feeds = FEEDS) {
  const results = await Promise.allSettled(feeds.map(fetchFeed));
  const errors = [];
  const seenUrls = new Set();
  const seenTitles = new Set();
  const articles = [];

  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      errors.push(String(r.reason?.message ?? r.reason));
      return;
    }
    for (const a of r.value) {
      const titleKey = a.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      if (seenUrls.has(a.url) || seenTitles.has(titleKey)) continue;
      seenUrls.add(a.url);
      seenTitles.add(titleKey);
      articles.push(a);
    }
  });

  articles.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
  return { articles, errors };
}
