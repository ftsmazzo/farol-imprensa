/** Web Push + preferências (Sprint 6). */

import webpush from "web-push";
import { normalizeKeywords } from "./alerts.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:farol@fabria.ia";

let vapidReady = false;

export function getVapidPublicKey() {
  return VAPID_PUBLIC_KEY || null;
}

export function ensureVapid() {
  if (vapidReady) return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn("VAPID ausente — Web Push desativado (defina VAPID_PUBLIC_KEY/PRIVATE_KEY)");
    return false;
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  vapidReady = true;
  return true;
}

export function articleMatchesPrefs(article, sub) {
  const uf = (article.uf || "").toUpperCase();
  if (sub.uf && String(sub.uf).toUpperCase() !== uf) return null;

  const themes = Array.isArray(sub.themes) ? sub.themes : [];
  const keywords = Array.isArray(sub.keywords) ? sub.keywords : [];
  if (!themes.length && !keywords.length) return null;

  const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
  const theme = String(article.theme || "").toLowerCase();

  for (const kw of keywords) {
    const needle = String(kw || "").toLowerCase().trim();
    if (needle.length >= 2 && text.includes(needle)) {
      return { kind: "keyword", value: kw };
    }
  }
  for (const t of themes) {
    if (String(t).toLowerCase() === theme) {
      return { kind: "theme", value: t };
    }
  }
  return null;
}

export async function matchArticlePush(pool, article) {
  if (!pool || !article?.id) return { matched: 0, events: [] };
  const { rows: subs } = await pool.query(
    `SELECT id, endpoint, p256dh, auth, uf, themes, keywords, active
     FROM push_subscribers WHERE active = TRUE`
  );
  const events = [];
  for (const sub of subs) {
    const hit = articleMatchesPrefs(article, sub);
    if (!hit) continue;
    const ins = await pool.query(
      `INSERT INTO push_events (subscriber_id, article_id, matched_on, match_kind, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (subscriber_id, article_id) DO NOTHING
       RETURNING id`,
      [sub.id, article.id, hit.value, hit.kind]
    );
    if (ins.rowCount) events.push({ id: ins.rows[0].id, subscriberId: sub.id });
  }
  return { matched: events.length, events };
}

async function loadPushEvent(pool, eventId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.matched_on, e.match_kind, e.status,
            s.id AS subscriber_id, s.endpoint, s.p256dh, s.auth,
            a.id AS article_id, a.title, a.url, a.theme, a.uf,
            src.name AS source_name
     FROM push_events e
     JOIN push_subscribers s ON s.id = e.subscriber_id
     JOIN articles a ON a.id = e.article_id
     LEFT JOIN sources src ON src.id = a.source_id
     WHERE e.id = $1`,
    [eventId]
  );
  return rows[0] || null;
}

export async function sendPushEvent(pool, eventId) {
  const row = await loadPushEvent(pool, eventId);
  if (!row) return { ok: false, error: "evento não encontrado" };
  if (row.status === "sent") return { ok: true, skipped: true, status: "sent" };
  if (!ensureVapid()) {
    await pool.query(`UPDATE push_events SET status = 'queued' WHERE id = $1`, [eventId]);
    return { ok: true, queued: true, note: "VAPID ausente" };
  }

  const payload = JSON.stringify({
    title: "Farol",
    body: row.title,
    url: row.url,
    tag: `farol-${row.article_id}`,
    data: {
      articleId: row.article_id,
      matchedOn: row.matched_on,
      kind: row.match_kind,
      theme: row.theme,
      source: row.source_name,
    },
  });

  try {
    await webpush.sendNotification(
      {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      },
      payload,
      { TTL: 60 * 60 * 12, urgency: "normal" }
    );
    await pool.query(
      `UPDATE push_events SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { ok: true, status: "sent", eventId };
  } catch (err) {
    const statusCode = err?.statusCode || err?.status;
    if (statusCode === 404 || statusCode === 410) {
      await pool.query(`UPDATE push_subscribers SET active = FALSE WHERE id = $1`, [
        row.subscriber_id,
      ]);
    }
    await pool.query(`UPDATE push_events SET status = 'error' WHERE id = $1`, [eventId]);
    return { ok: false, error: String(err.message || err), statusCode };
  }
}

export async function dispatchPendingPush(pool, { limit = 40 } = {}) {
  const { rows } = await pool.query(
    `SELECT id FROM push_events
     WHERE status IN ('pending', 'queued', 'error')
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const r of rows) results.push(await sendPushEvent(pool, r.id));
  return {
    ok: true,
    processed: results.length,
    sent: results.filter((x) => x.ok && x.status === "sent").length,
    queued: results.filter((x) => x.queued).length,
    errors: results.filter((x) => !x.ok).length,
    results,
  };
}

export async function upsertSubscriber(pool, body) {
  const endpoint = String(body?.endpoint || "").trim();
  const p256dh = String(body?.keys?.p256dh || body?.p256dh || "").trim();
  const auth = String(body?.keys?.auth || body?.auth || "").trim();
  const deviceId = String(body?.deviceId || "").trim() || null;
  const uf = body?.uf ? String(body.uf).toUpperCase().slice(0, 2) : "PE";
  const themes = Array.isArray(body?.themes)
    ? body.themes.map((t) => String(t).trim()).filter(Boolean)
    : [];
  const keywords = normalizeKeywords(body?.keywords || []);

  if (!endpoint || !p256dh || !auth) {
    throw new Error("subscription incompleta (endpoint/keys)");
  }
  if (!themes.length && !keywords.length) {
    throw new Error("escolha ao menos 1 tema ou 1 personalidade/keyword");
  }

  const { rows } = await pool.query(
    `INSERT INTO push_subscribers
       (device_id, endpoint, p256dh, auth, uf, themes, keywords, active, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, TRUE, NOW())
     ON CONFLICT (endpoint) DO UPDATE SET
       device_id = COALESCE(EXCLUDED.device_id, push_subscribers.device_id),
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       uf = EXCLUDED.uf,
       themes = EXCLUDED.themes,
       keywords = EXCLUDED.keywords,
       active = TRUE,
       updated_at = NOW()
     RETURNING id, device_id, uf, themes, keywords, active, created_at, updated_at`,
    [deviceId, endpoint, p256dh, auth, uf, themes, keywords]
  );
  return rows[0];
}

export { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY };
