// server.js — ZipFit Find-My-Fit on Railway.
//
// Serves the static quiz from the root directory and exposes ONE backend endpoint:
//   POST /api/fit-quiz/submit
// which receives the lead + quiz answers and fans them out to:
//   • Klaviyo               (upserts a profile + tracks "Fit Quiz Completed" event)
//   • Shopify Admin API     (creates/updates a customer, tags with the match)
//   • Odoo (XML-RPC)        (creates a crm.lead row)
//
// Env vars (set in Railway → Variables):
//   KLAVIYO_API_KEY        Private API key (pk_live_…)
//   KLAVIYO_LIST_ID        Optional — list ID to subscribe opt-in leads to
//   QUIZ_URL               Public URL of this quiz (e.g. https://fit.zipfit.com)
//                          Used to build the shareable result link stored on the profile
//                          as fit_quiz_result_url — insert {{ person.fit_quiz_result_url }}
//                          in your Klaviyo email templates.
//   SHOPIFY_STORE_DOMAIN   e.g. zipfit.myshopify.com
//   SHOPIFY_ADMIN_TOKEN    Custom App admin API access token (write_customers)
//   ODOO_URL               e.g. https://zipfit.odoo.com
//   ODOO_DB                Odoo database name
//   ODOO_USER              Odoo login (email)
//   ODOO_API_KEY           Odoo API key (Settings → Users → Developer)
//   ALLOWED_ORIGINS        Comma-separated list of allowed origins for CORS
//                          (e.g. https://zipfit.com,https://www.zipfit.com)
//
// Anything not set is treated as "skip that integration" — the endpoint still
// returns 200 and logs the payload, so you can deploy this BEFORE wiring keys.

import express from 'express';
import morgan from 'morgan';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(morgan('tiny'));

// ── CORS ──────────────────────────────────────────────────────────────────
// Same-origin works without CORS (when iframed from the same domain), but if
// you embed the quiz on shopify-hosted pages and POST cross-origin, list the
// allowed origins via ALLOWED_ORIGINS.
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Static frontend ───────────────────────────────────────────────────────
app.use(express.static(join(__dirname, '.'), {
  // Most files change with each deploy — keep cache short so users get updates.
  maxAge: '5m',
  // Tiny SPA, so let index resolve trailing-slash requests cleanly.
  extensions: ['html'],
}));

// Health check for Railway.
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// ── Lead submit endpoint ──────────────────────────────────────────────────
app.post('/api/fit-quiz/submit', async (req, res) => {
  const payload = req.body || {};
  const { lead, boot, answers, match } = payload;

  // Minimal validation.
  if (!lead || !lead.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }
  if (!lead.name) {
    return res.status(400).json({ ok: false, error: 'missing_name' });
  }

  console.log('[fit-quiz/submit]', {
    name: lead.name, email: lead.email,
    match: match?.id, boot: boot?.b + ' ' + boot?.m,
  });

  const results = await Promise.allSettled([
    pushToKlaviyo({ lead, boot, answers, match }),
    pushToShopify({ lead, boot, answers, match }),
    pushToOdoo({ lead, boot, answers, match }),
  ]);

  const klaviyo = results[0].status === 'fulfilled' ? results[0].value : { skipped: results[0].reason?.message };
  const shopify = results[1].status === 'fulfilled' ? results[1].value : { skipped: results[1].reason?.message };
  const odoo    = results[2].status === 'fulfilled' ? results[2].value : { skipped: results[2].reason?.message };

  res.json({ ok: true, klaviyo, shopify, odoo });
});

// ─────────────────────────────────────────────────────────────────────────
// Integration: Klaviyo v3
//
// 1. Upsert the profile with all quiz answers as custom properties.
// 2. Track a "Fit Quiz Completed" event so flows can be triggered on it.
// 3. If KLAVIYO_LIST_ID is set AND the user opted in, subscribe them to the list.
//
// Requires KLAVIYO_API_KEY (Private API key from Klaviyo → Account → API Keys).
// ─────────────────────────────────────────────────────────────────────────
// Builds a shareable URL that loads the quiz directly on the result screen.
// Encoded as base64url JSON so it survives email link tracking without issues.
function buildResultUrl({ lead, boot, answers }) {
  const base = (process.env.QUIZ_URL || '').replace(/\/$/, '');
  if (!base) return null;
  const token = Buffer.from(JSON.stringify({
    lead:        { name: lead.name },
    boot:        boot                  || null,
    ff:          answers?.ff           || null,
    ins:         answers?.ins          || null,
    ank:         answers?.ank          || null,
    cal:         answers?.cal          || null,
    fit_problem: answers?.fit_problem  || null,
    ability:     answers?.ability      || null,
  })).toString('base64url');
  return `${base}/?r=${token}`;
}

async function pushToKlaviyo({ lead, boot, answers, match }) {
  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) throw new Error('klaviyo_not_configured');

  const headers = {
    'Authorization': `Klaviyo-API-Key ${apiKey}`,
    'Content-Type': 'application/json',
    'revision': '2023-12-15',
  };

  const fitProblems = (Array.isArray(answers?.fit_problem)
    ? answers.fit_problem
    : [answers?.fit_problem]
  ).filter(Boolean);

  const resultUrl = buildResultUrl({ lead, boot, answers });

  const profileProps = {
    first_name: lead.name,
    email: lead.email,
    properties: {
      fit_quiz_liner:        match?.name  || null,
      fit_quiz_liner_id:     match?.id    || null,
      fit_quiz_boot_brand:   boot?.b      || null,
      fit_quiz_boot_model:   boot?.m      || null,
      fit_quiz_boot_year:    boot?.y      || null,
      fit_quiz_last_mm:      boot?.l      || null,
      fit_quiz_volume:       boot?.v      || null,
      fit_quiz_forefoot:     answers?.ff  || null,
      fit_quiz_instep:       answers?.ins || null,
      fit_quiz_ankle:        answers?.ank || null,
      fit_quiz_calf:         answers?.cal || null,
      fit_quiz_ability:      answers?.ability || null,
      fit_quiz_fit_problems: fitProblems.join(', ') || null,
      fit_quiz_completed_at: new Date().toISOString(),
      fit_quiz_result_url:   resultUrl,
    },
  };

  // Step 1 — upsert profile
  const profileRes = await fetch('https://a.klaviyo.com/api/profiles/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: { type: 'profile', attributes: profileProps },
    }),
  });

  // 409 means the profile already exists — Klaviyo returns the existing profile id
  // so we can patch it with the latest quiz answers.
  let profileId;
  if (profileRes.status === 409) {
    const conflict = await profileRes.json();
    profileId = conflict.errors?.[0]?.meta?.duplicate_profile_id;
    if (profileId) {
      await fetch(`https://a.klaviyo.com/api/profiles/${profileId}/`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          data: { type: 'profile', id: profileId, attributes: profileProps },
        }),
      });
    }
  } else if (profileRes.ok) {
    const created = await profileRes.json();
    profileId = created.data?.id;
  } else {
    const text = await profileRes.text();
    throw new Error(`klaviyo_profile_${profileRes.status}: ${text.slice(0, 200)}`);
  }

  // Step 2 — track event
  await fetch('https://a.klaviyo.com/api/events/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: {
        type: 'event',
        attributes: {
          metric: { data: { type: 'metric', attributes: { name: 'Fit Quiz Completed' } } },
          profile: { data: { type: 'profile', attributes: { email: lead.email } } },
          properties: {
            liner:        match?.name  || null,
            liner_id:     match?.id    || null,
            boot_brand:   boot?.b      || null,
            boot_model:   boot?.m      || null,
            boot_year:    boot?.y      || null,
            last_mm:      boot?.l      || null,
            volume:       boot?.v      || null,
            forefoot:     answers?.ff  || null,
            instep:       answers?.ins || null,
            ankle:        answers?.ank || null,
            calf:         answers?.cal || null,
            ability:      answers?.ability || null,
            fit_problems: fitProblems,
            result_url:   resultUrl,
          },
          value: 1,
          time: new Date().toISOString(),
        },
      },
    }),
  });

  // Step 3 — subscribe to list (only if opted in and a list is configured)
  const listId = process.env.KLAVIYO_LIST_ID;
  if (listId && lead.optIn && profileId) {
    await fetch(`https://a.klaviyo.com/api/lists/${listId}/relationships/profiles/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        data: [{ type: 'profile', id: profileId }],
      }),
    });
  }

  return { ok: true, profileId };
}

// ─────────────────────────────────────────────────────────────────────────
// Integration: Shopify Admin API
// Upserts a Customer: searches by email first, updates if found, creates if not.
// This prevents 422 errors for existing customers and keeps their record current.
// Requires SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN with write_customers.
// ─────────────────────────────────────────────────────────────────────────
async function pushToShopify({ lead, boot, match }) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) throw new Error('shopify_not_configured');

  const authHeaders = {
    'X-Shopify-Access-Token': token,
    'Content-Type': 'application/json',
  };
  const base = `https://${domain}/admin/api/2024-10`;

  const newTags = [
    'fit-quiz',
    match?.id  ? `liner:${match.id}`        : null,
    boot?.b    ? `boot-brand:${slug(boot.b)}` : null,
  ].filter(Boolean);

  const note = `Fit Quiz: ${match?.name || '—'} · ${[boot?.b, boot?.m].filter(Boolean).join(' ')}`.trim();

  const metafields = [
    { namespace: 'fit_quiz', key: 'match_liner', value: String(match?.id || ''), type: 'single_line_text_field' },
    { namespace: 'fit_quiz', key: 'boot',        value: [boot?.b, boot?.m].filter(Boolean).join(' '), type: 'single_line_text_field' },
    { namespace: 'fit_quiz', key: 'last_mm',     value: String(boot?.l || ''), type: 'single_line_text_field' },
    { namespace: 'fit_quiz', key: 'volume',      value: String(boot?.v || ''), type: 'single_line_text_field' },
  ];

  // ── Search for existing customer ────────────────────────────────────────
  const searchRes = await fetch(
    `${base}/customers/search.json?query=email:${encodeURIComponent(lead.email)}&limit=1&fields=id,tags`,
    { headers: authHeaders },
  );
  if (!searchRes.ok) {
    const t = await searchRes.text();
    throw new Error(`shopify_search_${searchRes.status}: ${t.slice(0, 200)}`);
  }
  const { customers } = await searchRes.json();
  const existing = customers?.[0];

  if (existing) {
    // ── Update — merge tags so we don't clobber existing ones ───────────
    const existingTags = (existing.tags || '').split(',').map((s) => s.trim()).filter(Boolean);
    const mergedTags = [...new Set([...existingTags, ...newTags])].join(', ');

    const putRes = await fetch(`${base}/customers/${existing.id}.json`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ customer: { id: existing.id, tags: mergedTags, note, accepts_marketing: !!lead.optIn, metafields } }),
    });
    if (!putRes.ok) {
      const t = await putRes.text();
      throw new Error(`shopify_update_${putRes.status}: ${t.slice(0, 200)}`);
    }
    return { ok: true, customerId: existing.id, action: 'updated' };
  }

  // ── Create ─────────────────────────────────────────────────────────────
  const postRes = await fetch(`${base}/customers.json`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      customer: {
        first_name: lead.name,
        email: lead.email,
        tags: newTags.join(', '),
        accepts_marketing: !!lead.optIn,
        note,
        metafields,
      },
    }),
  });
  if (!postRes.ok) {
    const t = await postRes.text();
    throw new Error(`shopify_create_${postRes.status}: ${t.slice(0, 200)}`);
  }
  const out = await postRes.json();
  return { ok: true, customerId: out.customer?.id, action: 'created' };
}

// ─────────────────────────────────────────────────────────────────────────
// Integration: Odoo (XML-RPC)
// Creates a crm.lead row as the canonical record for every quiz submission.
// XML-RPC is used because it works across all Odoo versions without extra deps.
// A 12-second timeout prevents a slow Odoo server from blocking the response.
// ─────────────────────────────────────────────────────────────────────────
async function pushToOdoo({ lead, boot, answers, match }) {
  const url  = process.env.ODOO_URL;
  const db   = process.env.ODOO_DB;
  const user = process.env.ODOO_USER;
  const key  = process.env.ODOO_API_KEY;
  if (!url || !db || !user || !key) throw new Error('odoo_not_configured');

  const fitProblems = (Array.isArray(answers?.fit_problem)
    ? answers.fit_problem
    : [answers?.fit_problem]
  ).filter(Boolean).join(', ') || '—';

  const resultUrl = buildResultUrl({ lead, boot, answers });

  // Authenticate then create — two calls, both subject to the 12 s timeout.
  const uid = await xmlrpc(`${url}/xmlrpc/2/common`, 'authenticate', [db, user, key, {}]);
  if (!uid) throw new Error('odoo_auth_failed');

  const leadVals = {
    name:         `Fit Quiz · ${lead.name} · ${match?.name || 'no match'}`,
    contact_name: lead.name,
    email_from:   lead.email,
    type:         'lead',
    source_id:    false,
    description: [
      '── Liner Match ────────────────────────',
      `Match:        ${match?.name || '—'} (id: ${match?.id || '—'})`,
      '',
      '── Boot ───────────────────────────────',
      `Brand / Model: ${[boot?.b, boot?.m, boot?.y].filter(Boolean).join(' ') || '—'}`,
      `Last:          ${boot?.l || '—'} mm`,
      `Flex:          ${boot?.f || '—'}`,
      `Volume:        ${boot?.v || '—'}`,
      '',
      '── Foot Profile ───────────────────────',
      `Forefoot:      ${answers?.ff  || '—'}`,
      `Arch height:   ${answers?.ins || '—'}`,
      `Ankle:         ${answers?.ank || '—'}`,
      `Calf:          ${answers?.cal || '—'}`,
      `Ability:       ${answers?.ability || '—'}`,
      `Fit problems:  ${fitProblems}`,
      '',
      '── Lead Info ──────────────────────────',
      `Marketing opt-in: ${lead.optIn ? 'yes' : 'no'}`,
      resultUrl ? `Result link:      ${resultUrl}` : '',
    ].filter((l) => l !== undefined).join('\n'),
  };

  const id = await xmlrpc(`${url}/xmlrpc/2/object`, 'execute_kw', [
    db, uid, key, 'crm.lead', 'create', [leadVals],
  ]);
  return { ok: true, leadId: id };
}

// Tiny XML-RPC client. Enough for Odoo's two methods we need.
// 12-second timeout prevents a slow Odoo instance from blocking the whole response.
async function xmlrpc(endpoint, method, params) {
  const body = `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${
    params.map((p) => `<param><value>${xmlrpcValue(p)}</value></param>`).join('')
  }</params></methodCall>`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let r;
  try {
    r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw new Error(`odoo_http_${r.status}`);
  const text = await r.text();
  if (text.includes('<fault>')) {
    const msg = text.match(/<string>([^<]*)<\/string>/)?.[1] || 'fault';
    throw new Error(`odoo_fault: ${msg}`);
  }
  // Pull out the first scalar value from the response.
  // Odoo returns <int>123</int> for create() and authenticate() — good enough.
  const intMatch = text.match(/<int>(\d+)<\/int>/);
  if (intMatch) return Number(intMatch[1]);
  const strMatch = text.match(/<string>([^<]*)<\/string>/);
  if (strMatch) return strMatch[1];
  return null;
}

function xmlrpcValue(v) {
  if (v === null || v === undefined) return '<nil/>';
  if (typeof v === 'number' && Number.isInteger(v)) return `<int>${v}</int>`;
  if (typeof v === 'number') return `<double>${v}</double>`;
  if (typeof v === 'boolean') return `<boolean>${v ? 1 : 0}</boolean>`;
  if (Array.isArray(v)) {
    return `<array><data>${v.map((x) => `<value>${xmlrpcValue(x)}</value>`).join('')}</data></array>`;
  }
  if (typeof v === 'object') {
    return `<struct>${
      Object.entries(v).map(([k, val]) =>
        `<member><name>${escapeXml(k)}</name><value>${xmlrpcValue(val)}</value></member>`
      ).join('')
    }</struct>`;
  }
  return `<string>${escapeXml(String(v))}</string>`;
}
function escapeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

app.listen(PORT, () => {
  console.log(`ZipFit Fit Quiz listening on :${PORT}`);
});
