// NVIDIA API (build.nvidia.com) — OpenAI-compatible chat completions.

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'meta/llama-3.3-70b-instruct';
const MAX_SOURCES = 25;

export const isConfigured = (env) => Boolean(env.NVIDIA_API_KEY);

const SYSTEM_PROMPT = `You are a careful news editor writing a situation briefing on the conflict in the Persian Gulf region.
Rules:
- Use ONLY the numbered headlines and snippets provided. Do not add facts from memory.
- Cite sources inline with their bracketed numbers, e.g. [3] or [2][5].
- Stay neutral. Attribute claims to the party making them ("Iran's foreign ministry said…").
- Flag contradictions between sources and say when something is unconfirmed.
- Format: one short summary paragraph, then 4–7 bullet points ("- ") of key developments, most significant first.
- Under 300 words. No headings, no preamble.`;

export async function generateBriefing(env, articles) {
  const sources = articles.slice(0, MAX_SOURCES);
  const list = sources
    .map((a, i) => {
      const when = a.published_at ? new Date(a.published_at).toUTCString() : 'date unknown';
      return `[${i + 1}] ${a.title} — ${a.source}, ${when}${a.description ? `\n${a.description}` : ''}`;
    })
    .join('\n\n');

  const model = env.NVIDIA_MODEL || DEFAULT_MODEL;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Current time: ${new Date().toUTCString()}\n\nSources:\n\n${list}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`NVIDIA API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  // Some reasoning models emit <think>…</think> before the answer.
  const content = (data.choices?.[0]?.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  if (!content) throw new Error('NVIDIA API returned an empty briefing');

  return {
    content,
    model,
    sources: sources.map(({ title, url, source }) => ({ title, url, source })),
    created_at: new Date().toISOString(),
  };
}
