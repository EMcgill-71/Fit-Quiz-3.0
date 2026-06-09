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
//   SHOPIFY_WEBHOOK_SECRET  Shared secret from Shopify → Settings → Notifications → Webhooks
//                          Used to verify HMAC-SHA256 on incoming webhook payloads.
//                          Register these topics pointing at this server:
//                            orders/paid     → /webhooks/shopify/orders-paid
//                            refunds/create  → /webhooks/shopify/refunds-created
//   ALLOWED_ORIGINS        Comma-separated list of allowed origins for CORS
//                          (e.g. https://zipfit.com,https://www.zipfit.com)
//
// Anything not set is treated as "skip that integration" — the endpoint still
// returns 200 and logs the payload, so you can deploy this BEFORE wiring keys.

import express from 'express';
import morgan from 'morgan';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Maps Shopify product handle / title keywords → internal liner IDs.
// Used by the order webhook to detect which ZipFit liner(s) a customer purchased.
const LINER_HANDLES = {
  'gara-lv':   'gara_lv',  'gara lv':   'gara_lv',
  'gara-hv':   'gara_hv',  'gara hv':   'gara_hv',
  'espresso':  'espresso',
  'gft':       'gft',
  'freeride':  'freeride',
  'corsa':     'corsa',
  'workhorse': 'workhorse',
};

const app = express();
// Capture raw body so Shopify webhook HMAC can be verified against the exact bytes received.
app.use(express.json({ limit: '256kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
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
  if (!lead || !lead.name) {
    return res.status(400).json({ ok: false, error: 'missing_name' });
  }
  // Contact: the user picks a preferred channel (email or text); we save both
  // when given. Require at least the preferred channel, and validate any value
  // that is present.
  const hasEmail = !!lead.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email);
  const hasPhone = !!normalizePhone(lead.phone, lead.dialCode);
  if (lead.email && !hasEmail) {
    return res.status(400).json({ ok: false, error: 'invalid_email' });
  }
  const pref = lead.contactPref === 'text' ? 'text' : 'email';
  if (pref === 'email' && !hasEmail) {
    return res.status(400).json({ ok: false, error: 'missing_email' });
  }
  if (pref === 'text' && !hasPhone) {
    return res.status(400).json({ ok: false, error: 'missing_phone' });
  }
  if (!hasEmail && !hasPhone) {
    return res.status(400).json({ ok: false, error: 'missing_contact' });
  }
  // Storing the quiz/foot/contact data requires explicit consent.
  if (!lead.dataConsent) {
    return res.status(400).json({ ok: false, error: 'missing_data_consent' });
  }

  console.log('[fit-quiz/submit]', {
    name: lead.name, email: lead.email || '(none)', phone: lead.phone || '(none)', pref,
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
// 3. If KLAVIYO_LIST_ID is set, record explicit marketing consent via the
//    subscription endpoint — email consent when the user opted in, SMS consent
//    when they checked the SMS box and gave a valid phone. Data-storage consent
//    is required up front (enforced in the submit handler).
//
// Requires KLAVIYO_API_KEY (Private API key from Klaviyo → Account → API Keys).
// ─────────────────────────────────────────────────────────────────────────
// Normalizes a raw phone number to E.164 (e.g. "+15551234567"), which is what
// Klaviyo and Shopify expect. The shopper's country is auto-detected from their
// browser locale in the quiz and sent as `dialCode` (e.g. "+44"); we prepend
// that calling code to the national number they typed. Falls back to US/Canada
// (+1) when no dial code is supplied (e.g. older payloads or reshared links).
// Returns null if the input can't be confidently normalized, so an invalid
// number never breaks the whole profile push.
function normalizePhone(raw, dialCode) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  // Already in +<country><number> form — trust it as the shopper typed it.
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  let national = trimmed.replace(/\D/g, '');
  // Country calling code from the selected dial code (e.g. "+44" → "44").
  const cc = String(dialCode || '+1').replace(/\D/g, '') || '1';
  if (cc === '1') {
    // North American Numbering Plan: 10 digits, optionally with a leading 1.
    if (national.length === 11 && national[0] === '1') national = national.slice(1);
    return national.length === 10 ? `+1${national}` : null;
  }
  // Most other countries write a trunk "0" prefix that is dropped in E.164.
  if (national.startsWith('0')) national = national.slice(1);
  const full = `${cc}${national}`;
  return full.length >= 8 && full.length <= 15 ? `+${full}` : null;
}

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
  const phoneE164 = normalizePhone(lead.phone, lead.dialCode);
  const hasEmail = !!lead.email;
  const contactPref = lead.contactPref === 'text' ? 'text' : 'email';

  const profileProps = {
    first_name: lead.name,
    // Save both identifiers when present; the user only needs to provide their
    // preferred one (email OR text). Klaviyo requires at least one.
    ...(hasEmail ? { email: lead.email } : {}),
    // Klaviyo requires E.164 format; only attach when we could normalize it,
    // otherwise an invalid number would 400 the entire profile request.
    ...(phoneE164 ? { phone_number: phoneE164 } : {}),
    properties: {
      fit_quiz_contact_pref: contactPref,
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
      // Consent audit trail
      fit_quiz_data_consent:  !!lead.dataConsent,
      fit_quiz_email_consent: !!lead.optIn,
      fit_quiz_sms_consent:   !!(lead.smsConsent && phoneE164),
      fit_quiz_consent_at:    new Date().toISOString(),
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
          profile: { data: { type: 'profile', attributes: {
            ...(hasEmail ? { email: lead.email } : {}),
            ...(phoneE164 ? { phone_number: phoneE164 } : {}),
          } } },
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

  // Step 3 — record marketing consent + subscribe to list.
  // Uses the subscription endpoint (not a bare list-add) so Klaviyo logs proper
  // opt-in consent for email and/or SMS based on what the user actually agreed to.
  const listId = process.env.ZipFit_Primary;
  const wantEmail = !!lead.optIn && hasEmail;
  const wantSms   = !!lead.smsConsent && !!phoneE164;
  if (listId && (wantEmail || wantSms)) {
    const subAttrs = {};
    const subscriptions = {};
    if (wantEmail) {
      subAttrs.email = lead.email;
      subscriptions.email = { marketing: { consent: 'SUBSCRIBED' } };
    }
    if (wantSms) {
      subAttrs.phone_number = phoneE164;
      subscriptions.sms = { marketing: { consent: 'SUBSCRIBED' } };
    }
    subAttrs.subscriptions = subscriptions;

    const subBody = {
      data: {
        type: 'profile-subscription-bulk-create-job',
        attributes: {
          profiles: { data: [{ type: 'profile', attributes: subAttrs }] },
        },
        relationships: { list: { data: { type: 'list', id: listId } } },
      },
    };
    console.log('[klaviyo/subscribe] request phone=%s email=%s wantSms=%s wantEmail=%s listId=%s',
      phoneE164 || '(none)', lead.email || '(none)', wantSms, wantEmail, listId);
    const subRes = await fetch('https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/', {
      method: 'POST',
      headers,
      body: JSON.stringify(subBody),
    });
    const subText = await subRes.text();
    console.log('[klaviyo/subscribe] status=%d body=%s', subRes.status, subText);
  }

  return { ok: true, profileId, emailConsent: wantEmail, smsConsent: wantSms };
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
  const phoneE164 = normalizePhone(lead.phone, lead.dialCode);
  // SMS marketing consent block — only when the user explicitly consented AND
  // we have a usable E.164 number. Shopify records this as an opt-in with source.
  const smsConsentBlock = (lead.smsConsent && phoneE164)
    ? { sms_marketing_consent: { state: 'subscribed', opt_in_level: 'single_opt_in', consent_updated_at: new Date().toISOString() } }
    : {};

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

  // ── Search for existing customer (by email when present, else by phone) ──
  const searchQuery = lead.email
    ? `email:${lead.email}`
    : `phone:${phoneE164}`;
  const searchRes = await fetch(
    `${base}/customers/search.json?query=${encodeURIComponent(searchQuery)}&limit=1&fields=id,tags`,
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
      body: JSON.stringify({ customer: { id: existing.id, tags: mergedTags, note, accepts_marketing: !!lead.optIn, metafields, ...(phoneE164 ? { phone: phoneE164 } : {}), ...smsConsentBlock } }),
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
        ...(lead.email ? { email: lead.email } : {}),
        ...(phoneE164 ? { phone: phoneE164 } : {}),
        tags: newTags.join(', '),
        accepts_marketing: !!lead.optIn,
        note,
        metafields,
        ...smsConsentBlock,
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

  const leadPhone = normalizePhone(lead.phone, lead.dialCode) || lead.phone || false;

  const leadVals = {
    name:         `Fit Quiz · ${lead.name} · ${match?.name || 'no match'}`,
    contact_name: lead.name,
    ...(lead.email ? { email_from: lead.email } : {}),
    ...(leadPhone ? { phone: leadPhone } : {}),
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
      `Email:            ${lead.email || '—'}`,
      `Phone:            ${leadPhone || '—'}`,
      `Preferred contact: ${lead.contactPref === 'text' ? 'text' : 'email'}`,
      `Data storage consent: ${lead.dataConsent ? 'yes' : 'no'}`,
      `Email opt-in:     ${lead.optIn ? 'yes' : 'no'}`,
      `SMS opt-in:       ${lead.smsConsent ? 'yes' : 'no'}`,
      `Consent recorded: ${new Date().toISOString()}`,
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

// ─────────────────────────────────────────────────────────────────────────
// Odoo chatter helper
// Finds the existing crm.lead for an email and appends a timestamped internal
// note. Called by all three webhooks so every post-sale event lands in Odoo.
// ─────────────────────────────────────────────────────────────────────────
async function postOdooNote(email, noteHtml) {
  const url  = process.env.ODOO_URL;
  const db   = process.env.ODOO_DB;
  const user = process.env.ODOO_USER;
  const key  = process.env.ODOO_API_KEY;
  if (!url || !db || !user || !key) return null;

  const uid = await xmlrpc(`${url}/xmlrpc/2/common`, 'authenticate', [db, user, key, {}]);
  if (!uid) throw new Error('odoo_auth_failed');

  // Find the most recent quiz lead for this email.
  const leadId = await xmlrpc(`${url}/xmlrpc/2/object`, 'execute_kw', [
    db, uid, key, 'crm.lead', 'search', [[['email_from', '=', email]]], { limit: 1 },
  ]);
  if (!leadId) return null; // customer never completed the quiz — skip

  await xmlrpc(`${url}/xmlrpc/2/object`, 'execute_kw', [
    db, uid, key, 'crm.lead', 'message_post', [[leadId]],
    { body: noteHtml, message_type: 'comment', subtype_xmlid: 'mail.mt_note' },
  ]);
  return { ok: true, leadId };
}

// ── Webhook helpers ───────────────────────────────────────────────────────

// Returns true when SHOPIFY_WEBHOOK_SECRET is unset (dev) OR signature matches.
function verifyShopifyWebhook(req) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return true;
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac || !req.rawBody) return false;
  const computed = crypto.createHmac('sha256', secret).update(req.rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac, 'base64'), Buffer.from(computed, 'base64'));
  } catch { return false; }
}

// Returns array of internal liner IDs found in a Shopify order's line items.
function detectLinersInOrder(lineItems = []) {
  const found = new Set();
  for (const item of lineItems) {
    const text = [item.title, item.sku, item.variant_title]
      .filter(Boolean).join(' ').toLowerCase();
    for (const [handle, id] of Object.entries(LINER_HANDLES)) {
      if (text.includes(handle)) found.add(id);
    }
  }
  return [...found];
}

// Fetches the Klaviyo profile for an email and returns { id, properties } or null.
async function getKlaviyoProfile(email) {
  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) return null;
  const res = await fetch(
    `https://a.klaviyo.com/api/profiles/?filter=equals(email,"${encodeURIComponent(email)}")&fields[profile]=id,properties`,
    { headers: { 'Authorization': `Klaviyo-API-Key ${apiKey}`, 'revision': '2023-12-15' } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const profile = data.data?.[0];
  return profile ? { id: profile.id, properties: profile.attributes?.properties || {} } : null;
}

// Tracks a Klaviyo event and optionally PATCHes profile properties.
async function trackKlaviyoEvent(email, eventName, props, profilePatch = null) {
  const apiKey = process.env.KLAVIYO_API_KEY;
  if (!apiKey) return;
  const headers = { 'Authorization': `Klaviyo-API-Key ${apiKey}`, 'Content-Type': 'application/json', 'revision': '2023-12-15' };

  await fetch('https://a.klaviyo.com/api/events/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      data: {
        type: 'event',
        attributes: {
          metric: { data: { type: 'metric', attributes: { name: eventName } } },
          profile: { data: { type: 'profile', attributes: { email } } },
          properties: props,
          value: 1,
          time: new Date().toISOString(),
        },
      },
    }),
  });

  if (profilePatch) {
    const profile = await getKlaviyoProfile(email);
    if (profile?.id) {
      await fetch(`https://a.klaviyo.com/api/profiles/${profile.id}/`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          data: { type: 'profile', id: profile.id, attributes: { properties: profilePatch } },
        }),
      });
    }
  }
}

// ── Webhook: order paid ───────────────────────────────────────────────────
// Shopify fires this when an order is fully paid.
// Detects whether the customer purchased their recommended liner or a different one.
// Register in Shopify: orders/paid → https://your-domain/webhooks/shopify/orders-paid
app.post('/webhooks/shopify/orders-paid', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  res.sendStatus(200); // acknowledge immediately; Shopify retries on failure

  const order = req.body;
  const email = order.email || order.customer?.email;
  if (!email) return;

  const purchasedLiners = detectLinersInOrder(order.line_items);
  if (!purchasedLiners.length) return; // no ZipFit liner in this order

  const profile = await getKlaviyoProfile(email).catch(() => null);
  const recommendedId = profile?.properties?.fit_quiz_liner_id;

  const boughtRecommended = recommendedId && purchasedLiners.includes(recommendedId);
  const boughtDifferent   = recommendedId && !boughtRecommended;

  const baseProps = {
    order_id:             order.id,
    order_name:           order.name,
    purchased_liners:     purchasedLiners,
    recommended_liner_id: recommendedId || null,
    bought_recommendation: boughtRecommended,
  };

  const eventName = boughtRecommended
    ? 'Fit Quiz — Bought Recommendation'
    : 'Fit Quiz — Bought Different Liner';

  const profilePatch = {
    fit_quiz_purchased_liner:           purchasedLiners.join(', '),
    fit_quiz_purchased_recommendation:  boughtRecommended,
    fit_quiz_purchased_different:       boughtDifferent,
    fit_quiz_purchase_date:             new Date().toISOString(),
  };

  const outcomeIcon = boughtRecommended ? '✅' : '⚠️';
  const odooNote = [
    `<p><strong>${outcomeIcon} Fit Quiz — Purchase</strong></p>`,
    `<p><strong>Order:</strong> ${order.name || order.id} &nbsp;·&nbsp; ${new Date().toLocaleDateString()}</p>`,
    `<p><strong>Purchased:</strong> ${purchasedLiners.join(', ')}</p>`,
    recommendedId ? `<p><strong>Recommended:</strong> ${recommendedId}</p>` : '',
    boughtRecommended
      ? '<p>✅ Bought the recommendation</p>'
      : recommendedId ? '<p>⚠️ Bought a different liner than recommended</p>' : '',
  ].filter(Boolean).join('\n');

  await Promise.allSettled([
    trackKlaviyoEvent(email, eventName, baseProps, profilePatch)
      .catch((e) => console.warn('[webhook/orders-paid] klaviyo error', e.message)),
    postOdooNote(email, odooNote)
      .catch((e) => console.warn('[webhook/orders-paid] odoo error', e.message)),
  ]);

  console.log('[webhook/orders-paid]', email, eventName, purchasedLiners);
});

// ── Webhook: refund created ───────────────────────────────────────────────
// Fires when Shopify processes a refund (full or partial).
// Flags liner returns in Klaviyo so the team can follow up.
// Register: refunds/create → https://your-domain/webhooks/shopify/refunds-created
app.post('/webhooks/shopify/refunds-created', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  res.sendStatus(200);

  const refund = req.body;
  const email = refund.order?.email || refund.order_email;
  if (!email) return;

  const refundedLiners = detectLinersInOrder(
    (refund.refund_line_items || []).map((rli) => rli.line_item).filter(Boolean),
  );
  if (!refundedLiners.length) return;

  const profilePatch = {
    fit_quiz_returned:       true,
    fit_quiz_return_date:    new Date().toISOString(),
    fit_quiz_returned_liner: refundedLiners.join(', '),
  };

  const odooNote = [
    `<p><strong>🔄 Fit Quiz — Liner Return</strong></p>`,
    `<p><strong>Refund ID:</strong> ${refund.id} &nbsp;·&nbsp; ${new Date().toLocaleDateString()}</p>`,
    `<p><strong>Returned:</strong> ${refundedLiners.join(', ')}</p>`,
  ].join('\n');

  await Promise.allSettled([
    trackKlaviyoEvent(
      email,
      'Fit Quiz — Liner Returned',
      { refund_id: refund.id, order_id: refund.order_id, returned_liners: refundedLiners },
      profilePatch,
    ).catch((e) => console.warn('[webhook/refunds] klaviyo error', e.message)),
    postOdooNote(email, odooNote)
      .catch((e) => console.warn('[webhook/refunds] odoo error', e.message)),
  ]);

  console.log('[webhook/refunds-created]', email, refundedLiners);
});

// ── Webhook: review submitted ─────────────────────────────────────────────
// Generic stub compatible with Okendo, Judge.me, and Yotpo (all can POST to a URL).
// Register your review app's webhook to POST to /webhooks/reviews.
// Expected body: { email, product_handle, rating, review_id }
app.post('/webhooks/reviews', async (req, res) => {
  res.sendStatus(200);

  const { email, product_handle, rating, review_id } = req.body || {};
  if (!email) return;

  const linerId = product_handle ? (LINER_HANDLES[product_handle.toLowerCase()] || null) : null;

  const stars = rating ? `${rating}/5` : '—';
  const odooNote = [
    `<p><strong>⭐ Fit Quiz — Review Submitted</strong></p>`,
    `<p><strong>Product:</strong> ${product_handle || '—'} &nbsp;·&nbsp; <strong>Rating:</strong> ${stars}</p>`,
    review_id ? `<p><strong>Review ID:</strong> ${review_id}</p>` : '',
  ].filter(Boolean).join('\n');

  await Promise.allSettled([
    trackKlaviyoEvent(
      email,
      'Fit Quiz — Review Submitted',
      { review_id, product_handle, liner_id: linerId, rating },
      linerId ? { fit_quiz_review_rating: rating, fit_quiz_review_liner: linerId } : null,
    ).catch((e) => console.warn('[webhook/reviews] klaviyo error', e.message)),
    postOdooNote(email, odooNote)
      .catch((e) => console.warn('[webhook/reviews] odoo error', e.message)),
  ]);

  console.log('[webhook/reviews]', email, product_handle, rating);
});

app.listen(PORT, () => {
  console.log(`ZipFit Fit Quiz listening on :${PORT}`);
});
