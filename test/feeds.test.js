import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, RELEVANCE } from '../src/feeds.js';

test('parses RSS items, strips CDATA/HTML and Google News outlet suffix', () => {
  const xml = `<rss><channel>
    <item>
      <title><![CDATA[Tanker struck near Strait of Hormuz - Example Wire]]></title>
      <link>https://example.com/a?x=1&amp;y=2</link>
      <pubDate>Tue, 17 Nov 2026 08:00:00 GMT</pubDate>
      <description>&lt;p&gt;Officials said &amp;quot;no casualties&amp;quot;.&lt;/p&gt;</description>
      <source url="https://example.com">Example Wire</source>
    </item>
    <item><title>No link</title></item>
  </channel></rss>`;
  const [a, ...rest] = parseFeed(xml, 'Fallback');
  assert.equal(rest.length, 0);
  assert.equal(a.title, 'Tanker struck near Strait of Hormuz');
  assert.equal(a.url, 'https://example.com/a?x=1&y=2');
  assert.equal(a.source, 'Example Wire');
  assert.equal(a.description, 'Officials said "no casualties".');
  assert.equal(a.published_at, '2026-11-17T08:00:00.000Z');
});

test('parses Atom entries', () => {
  const xml = `<feed><entry><title>Gulf update</title><link rel="alternate" href="https://example.org/b"/>
    <updated>2026-11-17T10:00:00Z</updated><summary>Short summary</summary></entry></feed>`;
  const [a] = parseFeed(xml, 'Atom Source');
  assert.equal(a.url, 'https://example.org/b');
  assert.equal(a.source, 'Atom Source');
  assert.equal(a.description, 'Short summary');
});

test('relevance filter', () => {
  assert.ok(RELEVANCE.test('Iranian navy seizes vessel'));
  assert.ok(RELEVANCE.test('Shipping through Hormuz resumes'));
  assert.ok(!RELEVANCE.test('Football transfer news'));
});
