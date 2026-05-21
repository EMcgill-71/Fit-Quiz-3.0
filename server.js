// server.js — ZipFit Find-My-Fit on Railway.
//
// Serves the static quiz from the root directory and exposes ONE backend endpoint:
//   POST /api/fit-quiz/submit
// which receives the lead + quiz answers and fans them out to:
//   • Shopify Admin API   (creates/updates a customer, tags with the match)
//   • Odoo (XML-RPC)      (creates a crm.lead row)
//
// Env vars (set in Railway → Variables):
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
    pushToShopify({ lead, boot, answers, match }),
    pushToOdoo({ lead, boot, answers, match }),
  ]);

  const shopify = results[0].status === 'fulfilled' ? results[0].value : { skipped: results[0].reason?.message };
  const odoo = results[1].status === 'fulfilled' ? results[1].value : { skipped: results[1].reason?.message };

  res.json({ ok: true, shopify, odoo });
});

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
