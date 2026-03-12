// SCRAPYR — AI Web Data Extraction Worker
// Cloudflare Worker | Groq AI | D1 + KV storage
// Part of KRYV Network — kryv.network

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-SCRAPYR-KEY',
  'Content-Type': 'application/json',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS });

// ── AI call via Groq ──────────────────────────────────────────────
async function callGroq(apiKey, systemPrompt, userPrompt) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    }),
  });
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── Fetch + strip HTML to readable text ──────────────────────────
async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ScrapyrBot/1.0; +https://scrapyr.kryv.network)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  const html = await res.text();
  // Strip tags, scripts, styles — keep text and links
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .substring(0, 12000); // Cap at ~3k tokens
  return stripped;
}

// ── Generate job ID ───────────────────────────────────────────────
const jobId = () => `scr_${Math.random().toString(36).slice(2, 10)}`;

// ── Send alert via webhook or ntfy ───────────────────────────────
async function sendAlert(channel, jobId, url, rows) {
  if (!channel) return;
  try {
    if (channel.includes('discord') || channel.includes('slack')) {
      await fetch(channel, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'SCRAPYR',
          content: `📊 **SCRAPYR Job Done**\nJob: \`${jobId}\`\nURL: ${url}\nRows extracted: **${rows}**\nhttps://scrapyr.kryv.network`,
        }),
      });
    } else if (channel.includes('ntfy.sh')) {
      const topic = channel.replace('https://ntfy.sh/', '').replace('http://ntfy.sh/', '');
      await fetch(`https://ntfy.sh/${topic}`, {
        method: 'POST',
        headers: { Title: `SCRAPYR: ${rows} rows from ${url}`, Tags: 'white_check_mark', Priority: 'default' },
        body: `Job ${jobId} completed. ${rows} rows extracted. scrapyr.kryv.network`,
      });
    }
  } catch {}
}

// ── Main handler ──────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // Ensure relay table exists
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS relay_articles (id TEXT PRIMARY KEY, title TEXT, slug TEXT, excerpt TEXT, body TEXT, tags TEXT, created_at TEXT)').run().catch(() => {});


    // ══ POST /extract ══════════════════════════════════════════════
    if (request.method === 'POST' && path === '/extract') {
      const body = await request.json();
      const { url: targetUrl, target, format = 'json', schedule, alert_channel } = body;

      if (!targetUrl || !target)
        return json({ error: 'url and target are required' }, 400);

      const id = jobId();

      try {
        // 1. Fetch the page
        const pageText = await fetchPage(targetUrl);

        // 2. AI extracts structured data
        const extracted = await callGroq(
          env.GROQ_API_KEY,
          `You are a web data extraction AI. Given raw webpage text and a description of what to extract, return clean structured JSON.
Rules:
- Return ONLY a JSON object with: { "data": [...], "rows": number, "fields": [...field names], "schema": {...} }
- data is an array of objects
- Each object has the same fields
- Clean the values (no HTML, no excessive whitespace)
- If you can't find the data, return { "data": [], "rows": 0, "fields": [], "error": "Not found" }`,
          `Webpage content:\n${pageText}\n\nExtract: ${target}\n\nReturn structured JSON with the extracted data.`
        );

        const rows = extracted.rows ?? (Array.isArray(extracted.data) ? extracted.data.length : 0);
        const result = { job_id: id, status: 'done', rows, ...extracted, url: targetUrl, format, schedule: schedule || null };

        // 3. Store in KV
        if (env.KV) await env.KV.put(`job:${id}`, JSON.stringify(result), { expirationTtl: 86400 * 30 });

        // 4. Save to D1
        if (env.DB) {
          await env.DB.prepare(
            'INSERT OR IGNORE INTO jobs (id, url, target, format, schedule, status, rows, result_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
          ).bind(id, targetUrl, target, format, schedule || '', 'done', rows, JSON.stringify(extracted.data), new Date().toISOString()).run();
        }

        // 5. Alert
        if (alert_channel) await sendAlert(alert_channel, id, targetUrl, rows);

        return json(result);
      } catch (e) {
        return json({ job_id: id, status: 'error', error: e.message }, 500);
      }
    }

    // ══ GET /jobs/:id ═══════════════════════════════════════════════
    if (request.method === 'GET' && path.startsWith('/jobs/')) {
      const id = path.split('/')[2];
      if (!id) return json({ error: 'job id required' }, 400);
      const val = env.KV ? await env.KV.get(`job:${id}`) : null;
      if (!val) return json({ error: 'Job not found', job_id: id }, 404);
      return json(JSON.parse(val));
    }

    // ══ GET /download/:id.json or :id.csv ═══════════════════════════
    if (request.method === 'GET' && path.startsWith('/download/')) {
      const file = path.split('/')[2] || '';
      const [id, ext] = file.split('.');
      const val = env.KV ? await env.KV.get(`job:${id}`) : null;
      if (!val) return new Response('Not found', { status: 404 });
      const job = JSON.parse(val);
      const data = job.data || [];

      if (ext === 'csv' && data.length > 0) {
        const headers = Object.keys(data[0]).join(',');
        const rows = data.map(r => Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
        return new Response(`${headers}\n${rows}`, {
          headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${id}.csv"`, ...CORS },
        });
      }
      return new Response(JSON.stringify(data, null, 2), {
        headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${id}.json"`, ...CORS },
      });
    }

    // ══ GET /scheduled — list scheduled jobs ════════════════════════
    if (request.method === 'GET' && path === '/scheduled') {
      if (!env.DB) return json({ jobs: [] });
      const { results } = await env.DB.prepare("SELECT id, url, target, format, schedule, status, rows, created_at FROM jobs WHERE schedule != '' ORDER BY created_at DESC LIMIT 50").all();
      return json({ jobs: results });
    }

    // ══ Cron handler — re-run scheduled jobs ════════════════════════
    // Called by Cloudflare scheduled trigger


    // ══ ARTICLE RELAY: POST /relay (RYDEN saves article) ══════════════
    if (request.method === 'POST' && path === '/relay') {
      const body = await request.json().catch(() => ({}));
      const { title, slug, excerpt, body: articleBody, tags } = body;
      if (!title || !articleBody) return json({ error: 'title and body required' }, 400);
      const id = crypto.randomUUID().substring(0, 8);
      await env.DB.prepare(
        'INSERT INTO relay_articles (id, title, slug, excerpt, body, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(id, title, slug || '', excerpt || '', articleBody, JSON.stringify(tags || []), new Date().toISOString()).run().catch(() => {});
      return json({ success: true, id, inkrux_url: `https://inkrux.kryv.network/write?relay=${id}` });
    }

    // ══ ARTICLE RELAY: GET /relay/:id (INKRUX fetches article) ══════
    if (request.method === 'GET' && path.startsWith('/relay/')) {
      const relayId = path.split('/relay/')[1];
      // Create table if not exists
      await env.DB.prepare('CREATE TABLE IF NOT EXISTS relay_articles (id TEXT PRIMARY KEY, title TEXT, slug TEXT, excerpt TEXT, body TEXT, tags TEXT, created_at TEXT)').run().catch(() => {});
      const row = await env.DB.prepare('SELECT * FROM relay_articles WHERE id = ?').bind(relayId).first().catch(() => null);
      if (!row) return json({ error: 'Article not found' }, 404);
      return json({ success: true, article: { ...row, tags: JSON.parse(row.tags || '[]') } });
    }
    return json({ name: 'SCRAPYR API', version: '1.0.0', routes: ['/extract', '/jobs/:id', '/download/:id.json', '/download/:id.csv', '/scheduled'] });
  },

  // ── Cron: re-run scheduled jobs ──────────────────────────────────
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    const { results } = await env.DB.prepare("SELECT * FROM jobs WHERE schedule IS NOT NULL AND schedule != '' LIMIT 20").all();
    for (const job of results) {
      try {
        const pageText = await fetchPage(job.url);
        const extracted = await callGroq(
          env.GROQ_API_KEY,
          'You are a web data extraction AI. Extract structured data and return JSON with { data: [...], rows: number, fields: [...] }',
          `Webpage:\n${pageText}\n\nExtract: ${job.target}`
        );
        const rows = extracted.rows ?? (Array.isArray(extracted.data) ? extracted.data.length : 0);
        await env.DB.prepare('UPDATE jobs SET rows=?, result_json=?, status=?, updated_at=? WHERE id=?')
          .bind(rows, JSON.stringify(extracted.data), 'done', new Date().toISOString(), job.id).run();
        if (env.KV) await env.KV.put(`job:${job.id}`, JSON.stringify({ ...job, data: extracted.data, rows, status: 'done' }), { expirationTtl: 86400 * 30 });
      } catch {}
    }
  },
};
