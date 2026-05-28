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
// Creates (or updates) a Customer record and tags it with the match metadata.
// Uses the 2024-10 REST endpoint — adjust if your app pins a different version.
// Requires SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN with write_customers.
// ─────────────────────────────────────────────────────────────────────────
async function pushToShopify({ lead, boot, match }) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) {
    throw new Error('shopify_not_configured');
  }

  const tags = [
    'fit-quiz',
    match?.id ? `liner:${match.id}` : null,
    boot?.b ? `boot-brand:${slug(boot.b)}` : null,
  ].filter(Boolean).join(', ');

  const body = {
    customer: {
      first_name: lead.name,
      email: lead.email,
      tags,
      accepts_marketing: !!lead.optIn,
      note: `Fit Quiz match: ${match?.name || '—'} · ${boot?.b || ''} ${boot?.m || ''}`,
      metafields: [
        { namespace: 'fit_quiz', key: 'match_liner', value: String(match?.id || ''), type: 'single_line_text_field' },
        { namespace: 'fit_quiz', key: 'boot', value: `${boot?.b || ''} ${boot?.m || ''}`.trim(), type: 'single_line_text_field' },
      ],
    },
  };

  const r = await fetch(`https://${domain}/admin/api/2024-10/customers.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`shopify_${r.status}: ${text.slice(0, 200)}`);
  }
  const out = await r.json();
  return { ok: true, customerId: out.customer?.id };
}

// ─────────────────────────────────────────────────────────────────────────
// Integration: Odoo (XML-RPC)
// Creates a crm.lead row. Odoo's REST API is patchy across versions — XML-RPC
// is the universal path. We use fetch + a hand-rolled XML envelope so there
// are no extra npm deps.
// ─────────────────────────────────────────────────────────────────────────
async function pushToOdoo({ lead, boot, answers, match }) {
  const url = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const user = process.env.ODOO_USER;
  const key = process.env.ODOO_API_KEY;
  if (!url || !db || !user || !key) {
    throw new Error('odoo_not_configured');
  }

  // Step 1 — authenticate to get the UID.
  const uid = await xmlrpc(`${url}/xmlrpc/2/common`, 'authenticate', [db, user, key, {}]);
  if (!uid) throw new Error('odoo_auth_failed');

  // Step 2 — create the lead.
  const leadVals = {
    name: `Fit Quiz · ${lead.name} · ${match?.name || 'no match'}`,
    contact_name: lead.name,
    email_from: lead.email,
    type: 'lead',
    source_id: false,
    description: [
      `Match: ${match?.name || '—'} (${match?.id || '—'})`,
      `Boot: ${boot?.b || ''} ${boot?.m || ''} ${boot?.y || ''}`.trim(),
      `Last: ${boot?.l || '—'}mm  · Flex: ${boot?.f || '—'} · Vol: ${boot?.v || '—'}`,
      `Forefoot: ${answers?.ff || '—'} · Instep: ${answers?.ins || '—'}`,
      `Ankle: ${answers?.ank || '—'} · Calf: ${answers?.cal || '—'}`,
      `Ability: ${answers?.ability || '—'}`,
      `Fit problems: ${(Array.isArray(answers?.fit_problem) ? answers.fit_problem : [answers?.fit_problem]).filter(Boolean).join(', ') || '—'}`,
      `Marketing opt-in: ${lead.optIn ? 'yes' : 'no'}`,
    ].join('\n'),
  };
  const id = await xmlrpc(`${url}/xmlrpc/2/object`, 'execute_kw', [
    db, uid, key, 'crm.lead', 'create', [leadVals],
  ]);
  return { ok: true, leadId: id };
}

// Tiny XML-RPC client. Enough for Odoo's two methods we need.
async function xmlrpc(endpoint, method, params) {
  const body = `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${
    params.map((p) => `<param><value>${xmlrpcValue(p)}</value></param>`).join('')
  }</params></methodCall>`;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body,
  });
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
