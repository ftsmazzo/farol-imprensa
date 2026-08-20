/** Match de regras de alerta + disparo webhook n8n. */

const N8N_ALERT_WEBHOOK = process.env.N8N_ALERT_WEBHOOK || "";

function normalizeKeywords(raw) {
  if (Array.isArray(raw)) {
    return raw.map((k) => String(k || "").trim()).filter(Boolean);
  }
  return String(raw || "")
    .split(/[,;|/]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export function articleMatchesRule(article, rule) {
  const uf = (article.uf || "").toUpperCase();
  if (rule.uf && String(rule.uf).toUpperCase() !== uf) return null;

  if (rule.theme && article.theme && String(rule.theme).toLowerCase() !== String(article.theme).toLowerCase()) {
    return null;
  }

  const text = `${article.title || ""} ${article.summary || ""}`.toLowerCase();
  const keywords = Array.isArray(rule.keywords) ? rule.keywords : normalizeKeywords(rule.keywords);
  for (const kw of keywords) {
    const needle = String(kw || "").toLowerCase().trim();
    if (needle.length >= 2 && text.includes(needle)) return kw;
  }
  return null;
}

export async function matchArticleAlerts(pool, article) {
  if (!pool || !article?.id) return { matched: 0, events: [] };
  const { rows: rules } = await pool.query(
    `SELECT id, name, keywords, uf, theme, channel, active
     FROM alert_rules WHERE active = TRUE`
  );
  const events = [];
  for (const rule of rules) {
    const matchedOn = articleMatchesRule(article, rule);
    if (!matchedOn) continue;
    const ins = await pool.query(
      `INSERT INTO alert_events (rule_id, article_id, matched_on, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (rule_id, article_id) DO NOTHING
       RETURNING id, rule_id, article_id, matched_on, status, created_at`,
      [rule.id, article.id, matchedOn]
    );
    if (ins.rowCount) {
      events.push({ ...ins.rows[0], ruleName: rule.name, channel: rule.channel });
    }
  }
  return { matched: events.length, events };
}

async function loadEventPayload(pool, eventId) {
  const { rows } = await pool.query(
    `SELECT e.id, e.matched_on, e.status, e.created_at, e.sent_at,
            r.id AS rule_id, r.name AS rule_name, r.keywords, r.uf AS rule_uf, r.channel,
            a.id AS article_id, a.title, a.url, a.summary, a.theme, a.uf, a.published_at,
            s.name AS source_name
     FROM alert_events e
     JOIN alert_rules r ON r.id = e.rule_id
     JOIN articles a ON a.id = e.article_id
     LEFT JOIN sources s ON s.id = a.source_id
     WHERE e.id = $1`,
    [eventId]
  );
  return rows[0] || null;
}

function buildWebhookBody(row) {
  const message =
    `🔦 Farol · alerta\n` +
    `Regra: ${row.rule_name}\n` +
    `Match: “${row.matched_on}”\n` +
    `${row.title}\n` +
    `${row.source_name || "Fonte"} · ${row.uf || ""}${row.theme ? ` · ${row.theme}` : ""}\n` +
    `${row.url}`;
  return {
    eventId: row.id,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    matchedOn: row.matched_on,
    channel: row.channel || "webhook",
    whatsappTo: process.env.ALERT_WHATSAPP_TO || null,
    evolutionInstance: process.env.ALERT_EVOLUTION_INSTANCE || null,
    article: {
      id: row.article_id,
      title: row.title,
      url: row.url,
      summary: row.summary,
      theme: row.theme,
      uf: row.uf,
      source: row.source_name,
      publishedAt: row.published_at,
    },
    message,
  };
}

export async function dispatchAlertEvent(pool, eventId, { webhookUrl = N8N_ALERT_WEBHOOK } = {}) {
  const row = await loadEventPayload(pool, eventId);
  if (!row) return { ok: false, error: "evento não encontrado" };
  if (row.status === "sent") return { ok: true, skipped: true, status: "sent" };

  const body = buildWebhookBody(row);

  if (!webhookUrl) {
    await pool.query(
      `UPDATE alert_events SET status = 'queued', sent_at = NULL WHERE id = $1`,
      [eventId]
    );
    return { ok: true, queued: true, note: "N8N_ALERT_WEBHOOK ausente — evento marcado queued", body };
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "FarolImprensa/0.5" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      await pool.query(`UPDATE alert_events SET status = 'error' WHERE id = $1`, [eventId]);
      return { ok: false, error: `webhook HTTP ${res.status}`, detail: text.slice(0, 300) };
    }
    await pool.query(
      `UPDATE alert_events SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [eventId]
    );
    return { ok: true, status: "sent", eventId };
  } catch (err) {
    await pool.query(`UPDATE alert_events SET status = 'error' WHERE id = $1`, [eventId]);
    return { ok: false, error: String(err.message || err) };
  }
}

export async function dispatchPendingAlerts(pool, { limit = 30 } = {}) {
  const { rows } = await pool.query(
    `SELECT id FROM alert_events
     WHERE status IN ('pending', 'queued', 'error')
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );
  const results = [];
  for (const r of rows) {
    results.push(await dispatchAlertEvent(pool, r.id));
  }
  return {
    ok: true,
    processed: results.length,
    sent: results.filter((x) => x.ok && x.status === "sent").length,
    queued: results.filter((x) => x.queued).length,
    errors: results.filter((x) => !x.ok).length,
    results,
  };
}

export { normalizeKeywords, N8N_ALERT_WEBHOOK };
