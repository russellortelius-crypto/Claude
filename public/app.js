const AUTO_REFRESH_MS = 5 * 60 * 1000;
const $ = (id) => document.getElementById(id);

let allArticles = [];

const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const safeUrl = (u) => (/^https?:\/\//i.test(u ?? '') ? u : '#');

function timeAgo(iso) {
  if (!iso) return '';
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- Briefing ----------

// Tiny, escape-first renderer: paragraphs, "- " bullets, **bold**, and [n] citations.
function renderBriefing(text, sources) {
  const inline = (line) =>
    escapeHtml(line)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[(\d+)\]/g, (m, n) => {
        const s = sources[Number(n) - 1];
        return s ? `<sup><a href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener" title="${escapeHtml(s.title)}">[${n}]</a></sup>` : m;
      });

  const out = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)/);
    if (bullet) {
      list ??= [];
      list.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (line) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}

async function loadBriefing() {
  const body = $('briefing-body');
  try {
    const res = await fetch('/api/briefing');
    const data = await res.json();
    if (data.status !== 'ok') {
      body.innerHTML = `<p class="muted">${escapeHtml(data.message ?? 'Briefing unavailable.')}</p>`;
      $('briefing-sources').hidden = true;
      return;
    }
    const { content, sources = [], model, created_at } = data.briefing;
    body.innerHTML = renderBriefing(content, sources);
    $('briefing-source-list').innerHTML = sources
      .map((s) => `<li><a href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a> <span class="muted">— ${escapeHtml(s.source)}</span></li>`)
      .join('');
    $('briefing-sources').hidden = sources.length === 0;
    $('briefing-meta').textContent =
      `Generated ${timeAgo(created_at)}${model ? ` by ${model}` : ''} from the headlines listed under "Sources used". ` +
      'Language-model summaries can contain errors; check the original reporting.';
  } catch {
    body.innerHTML = '<p class="muted">Briefing unavailable.</p>';
  }
}

// ---------- Articles ----------

function renderArticles() {
  const q = $('search').value.trim().toLowerCase();
  const outlet = $('source').value;
  const shown = allArticles.filter(
    (a) => (!outlet || a.source === outlet) && (!q || `${a.title} ${a.description ?? ''}`.toLowerCase().includes(q)),
  );

  $('articles').innerHTML = shown
    .map(
      (a) => `<li class="article">
        <h3><a href="${escapeHtml(safeUrl(a.url))}" target="_blank" rel="noopener">${escapeHtml(a.title)}</a></h3>
        <div class="meta"><span class="outlet">${escapeHtml(a.source ?? '')}</span>${
          a.published_at ? `<time datetime="${escapeHtml(a.published_at)}" title="${escapeHtml(new Date(a.published_at).toLocaleString())}">${timeAgo(a.published_at)}</time>` : ''
        }</div>
        ${a.description ? `<p>${escapeHtml(a.description)}</p>` : ''}
      </li>`,
    )
    .join('');
  $('empty').hidden = shown.length > 0 || allArticles.length === 0;
}

function populateOutlets() {
  const select = $('source');
  const current = select.value;
  const outlets = [...new Set(allArticles.map((a) => a.source).filter(Boolean))].sort();
  select.innerHTML =
    '<option value="">All outlets</option>' +
    outlets.map((o) => `<option${o === current ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('');
}

async function loadNews() {
  try {
    const res = await fetch('/api/news');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allArticles = data.articles ?? [];
    populateOutlets();
    renderArticles();

    const errors = $('feed-errors');
    errors.hidden = !data.errors?.length;
    if (data.errors?.length) errors.textContent = `Some sources could not be reached: ${data.errors.join('; ')}`;
    if (!allArticles.length) $('articles').innerHTML = '<li class="muted">No reports available right now.</li>';

    $('mode').textContent =
      data.mode === 'supabase' ? 'Stored in Supabase and refreshed every 30 minutes.' : 'Fetched live from news feeds.';
    $('updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    $('updated').textContent = 'Could not load news';
  }
}

async function loadAll() {
  const btn = $('reload');
  btn.disabled = true;
  await Promise.all([loadNews(), loadBriefing()]);
  btn.disabled = false;
}

$('search').addEventListener('input', renderArticles);
$('source').addEventListener('change', renderArticles);
$('reload').addEventListener('click', loadAll);
setInterval(loadAll, AUTO_REFRESH_MS);
loadAll();
