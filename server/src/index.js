import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { cleanTitle } from "./cleanTitle.js";
import {
  dispatchAlertEvent,
  dispatchPendingAlerts,
  matchArticleAlerts,
  normalizeKeywords,
  N8N_ALERT_WEBHOOK,
} from "./alerts.js";
import {
  dispatchPendingPush,
  ensureVapid,
  getVapidPublicKey,
  matchArticlePush,
  sendPushEvent,
  upsertSubscriber,
} from "./push.js";
import { runIngest } from "./ingest.js";
import { seedSources } from "./seed.js";
import { THEMES, classifyTheme } from "./themes.js";
import { BR_UFS, normalizeUf } from "./ufs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname = .../server/src → raiz do repo/imagem = ../..
const root = path.resolve(__dirname, "../..");
const { Pool } = pg;

const PORT = Number(process.env.PORT || 3100);
const DATABASE_URL = process.env.DATABASE_URL || "";
const INGEST_TOKEN = process.env.INGEST_TOKEN || "";
const ALERT_WHATSAPP_TO = process.env.ALERT_WHATSAPP_TO || "";
const ALERT_EVOLUTION_INSTANCE = process.env.ALERT_EVOLUTION_INSTANCE || "";
const SPRINT = 8;

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
    })
  : null;

let ingestRunning = false;

/** YYYY-MM-DD no fuso de Brasília. */
export function dateInBrasilia(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function shiftDateISO(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function migrate() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      uf CHAR(2) NOT NULL,
      city TEXT,
      type TEXT,
      website TEXT,
      rss_url TEXT,
      radar_vehicle_id TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      last_fetched_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS articles (
      id BIGSERIAL PRIMARY KEY,
      source_id TEXT REFERENCES sources(id),
      url TEXT NOT NULL,
      url_hash TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      published_at TIMESTAMPTZ,
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      uf CHAR(2),
      theme TEXT,
      themes TEXT[] DEFAULT '{}',
      raw JSONB,
      UNIQUE (url_hash)
    );
    CREATE INDEX IF NOT EXISTS articles_published_idx ON articles (published_at DESC NULLS LAST);
    CREATE INDEX IF NOT EXISTS articles_uf_theme_idx ON articles (uf, theme);
    CREATE INDEX IF NOT EXISTS articles_fetched_idx ON articles (fetched_at DESC);

    CREATE TABLE IF NOT EXISTS alert_rules (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      keywords TEXT[] NOT NULL,
      uf CHAR(2),
      theme TEXT,
      channel TEXT NOT NULL DEFAULT 'webhook',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alert_events (
      id BIGSERIAL PRIMARY KEY,
      rule_id BIGINT REFERENCES alert_rules(id),
      article_id BIGINT REFERENCES articles(id),
      matched_on TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS alert_events_rule_article_uidx
      ON alert_events (rule_id, article_id);

    CREATE TABLE IF NOT EXISTS push_subscribers (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      uf CHAR(2) DEFAULT 'PE',
      themes TEXT[] NOT NULL DEFAULT '{}',
      keywords TEXT[] NOT NULL DEFAULT '{}',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS push_subscribers_active_idx ON push_subscribers (active);

    CREATE TABLE IF NOT EXISTS push_events (
      id BIGSERIAL PRIMARY KEY,
      subscriber_id BIGINT REFERENCES push_subscribers(id) ON DELETE CASCADE,
      article_id BIGINT REFERENCES articles(id),
      matched_on TEXT,
      match_kind TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS push_events_sub_article_uidx
      ON push_events (subscriber_id, article_id);
  `);
  console.log("Migrate ok");
}

function requireIngestAuth(req, res) {
  if (!INGEST_TOKEN) return true;
  const header = req.headers["x-ingest-token"] || req.query.token;
  if (header !== INGEST_TOKEN) {
    res.status(401).json({ error: "token inválido" });
    return false;
  }
  return true;
}

function mapArticle(r) {
  const title = cleanTitle(r.title, r.source_name);
  const theme = r.theme || classifyTheme(title, r.summary);
  return {
    id: r.id,
    title,
    url: r.url,
    summary: r.summary,
    publishedAt: r.published_at,
    fetchedAt: r.fetched_at,
    theme,
    uf: r.uf,
    source: r.source_name,
    sourceType: r.source_type,
    city: r.source_city,
  };
}

/** Corrige títulos colados e preenche tema nos registros antigos. */
async function backfillArticles() {
  if (!pool) return;
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.summary, a.theme, s.name AS source_name
     FROM articles a
     LEFT JOIN sources s ON s.id = a.source_id
     ORDER BY a.id DESC
     LIMIT 2000`
  );
  let fixed = 0;
  for (const r of rows) {
    const title = cleanTitle(r.title, r.source_name);
    const theme = r.theme || classifyTheme(title, r.summary);
    if (title === r.title && theme === r.theme) continue;
    await pool.query(`UPDATE articles SET title = $1, theme = $2 WHERE id = $3`, [
      title,
      theme,
      r.id,
    ]);
    fixed += 1;
  }
  if (fixed) console.log(`Backfill: ${fixed} artigos (título/tema)`);
}

async function seedDefaultAlertRule() {
  if (!pool) return;
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM alert_rules`);
  if (rows[0].n > 0) return;
  await pool.query(
    `INSERT INTO alert_rules (name, keywords, uf, theme, channel, active)
     VALUES ($1, $2, $3, NULL, 'webhook', TRUE)`,
    ["Piloto PE — Cabrobó", ["cabrobó", "cabrobo"], "PE"]
  );
  console.log("Seed: regra piloto Cabrobó");
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  if (!pool) {
    return res.json({ ok: true, service: "farol", sprint: SPRINT, db: false });
  }
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS articles FROM articles");
    res.json({
      ok: true,
      service: "farol",
      sprint: SPRINT,
      db: true,
      articles: rows[0].articles,
      ingestRunning,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get("/api/meta", async (_req, res) => {
  if (!pool) {
    return res.json({
      service: "farol",
      sprint: SPRINT,
      pilotUf: "PE",
      pilotUfs: BR_UFS.map((x) => x.uf),
      ufs: BR_UFS,
      sources: 0,
      articles: 0,
      sourcesWithRss: 0,
      alertRules: 0,
      db: false,
      note: "Sem Postgres",
    });
  }
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM sources WHERE active) AS sources,
        (SELECT COUNT(*)::int FROM sources WHERE active AND rss_url IS NOT NULL AND rss_url <> '') AS sources_rss,
        (SELECT COUNT(*)::int FROM articles) AS articles,
        (SELECT COUNT(*)::int FROM alert_rules WHERE active) AS alert_rules,
        (SELECT MAX(fetched_at) FROM articles) AS last_article_at,
        (SELECT MAX(last_fetched_at) FROM sources) AS last_fetch_at
    `);
    const r = rows[0];
    res.json({
      service: "farol",
      sprint: SPRINT,
      pilotUf: "PE",
      pilotUfs: BR_UFS.map((x) => x.uf),
      ufs: BR_UFS,
      db: true,
      sources: r.sources,
      sourcesWithRss: r.sources_rss,
      articles: r.articles,
      alertRules: r.alert_rules,
      lastArticleAt: r.last_article_at,
      lastFetchAt: r.last_fetch_at,
      ingestRunning,
      alertWebhookConfigured: Boolean(N8N_ALERT_WEBHOOK),
      pushConfigured: Boolean(getVapidPublicKey()),
      note:
        r.articles > 0
          ? "Sprint 8: Brasil 27 UFs. Escolha o estado no app."
          : "Fontes seedadas. Rode a coleta para popular o digest.",
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/sources", async (req, res) => {
  if (!pool) return res.json([]);
  const uf = req.query.uf ? String(req.query.uf).toUpperCase() : null;
  const params = [];
  let where = "WHERE active = TRUE";
  if (uf) {
    params.push(uf);
    where += ` AND uf = $${params.length}`;
  }
  const { rows } = await pool.query(
    `SELECT id, name, uf, city, type, website, rss_url, radar_vehicle_id, last_fetched_at
     FROM sources ${where} ORDER BY name`,
    params
  );
  res.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      uf: r.uf,
      city: r.city,
      type: r.type,
      website: r.website,
      hasRss: Boolean(r.rss_url),
      radarVehicleId: r.radar_vehicle_id,
      lastFetchedAt: r.last_fetched_at,
    }))
  );
});

app.post("/api/ingest/run", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  if (!requireIngestAuth(req, res)) return;
  if (ingestRunning) return res.status(409).json({ error: "ingestão já em andamento" });

  const all = Boolean(req.body?.all);
  ingestRunning = true;
  try {
    if (all) {
      const reports = [];
      let inserted = 0;
      let skipped = 0;
      let errors = 0;
      let sources = 0;
      for (const { uf } of BR_UFS) {
        const report = await runIngest(pool, { uf });
        reports.push({ uf, inserted: report.inserted, skipped: report.skipped, errors: report.errors });
        inserted += report.inserted || 0;
        skipped += report.skipped || 0;
        errors += report.errors || 0;
        sources += report.sources || 0;
      }
      res.status(202).json({
        ok: true,
        all: true,
        ufs: BR_UFS.length,
        sources,
        inserted,
        skipped,
        errors,
        reports,
        finishedAt: new Date().toISOString(),
      });
    } else {
      const uf = normalizeUf(req.body?.uf || "PE");
      const report = await runIngest(pool, { uf });
      res.status(202).json(report);
    }
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    ingestRunning = false;
  }
});

function mapRule(r) {
  return {
    id: r.id,
    name: r.name,
    keywords: r.keywords || [],
    uf: r.uf,
    theme: r.theme,
    channel: r.channel,
    active: r.active,
    createdAt: r.created_at,
  };
}

app.get("/api/alerts/rules", async (_req, res) => {
  if (!pool) return res.json([]);
  try {
    const { rows } = await pool.query(
      `SELECT id, name, keywords, uf, theme, channel, active, created_at
       FROM alert_rules ORDER BY id DESC`
    );
    res.json(rows.map(mapRule));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/alerts/rules", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  const name = String(req.body?.name || "").trim();
  const keywords = normalizeKeywords(req.body?.keywords);
  const uf = req.body?.uf ? String(req.body.uf).toUpperCase().slice(0, 2) : null;
  const theme = req.body?.theme ? String(req.body.theme).trim() : null;
  const channel = String(req.body?.channel || "webhook").trim() || "webhook";
  if (!name || !keywords.length) {
    return res.status(400).json({ error: "name e keywords são obrigatórios" });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO alert_rules (name, keywords, uf, theme, channel, active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING id, name, keywords, uf, theme, channel, active, created_at`,
      [name, keywords, uf, theme, channel]
    );
    res.status(201).json(mapRule(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.patch("/api/alerts/rules/:id", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
  const fields = [];
  const params = [];
  const set = (col, val) => {
    params.push(val);
    fields.push(`${col} = $${params.length}`);
  };
  if (req.body?.name != null) set("name", String(req.body.name).trim());
  if (req.body?.keywords != null) set("keywords", normalizeKeywords(req.body.keywords));
  if (req.body?.uf !== undefined) {
    set("uf", req.body.uf ? String(req.body.uf).toUpperCase().slice(0, 2) : null);
  }
  if (req.body?.theme !== undefined) {
    set("theme", req.body.theme ? String(req.body.theme).trim() : null);
  }
  if (req.body?.channel != null) set("channel", String(req.body.channel).trim());
  if (req.body?.active != null) set("active", Boolean(req.body.active));
  if (!fields.length) return res.status(400).json({ error: "nada para atualizar" });
  params.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE alert_rules SET ${fields.join(", ")} WHERE id = $${params.length}
       RETURNING id, name, keywords, uf, theme, channel, active, created_at`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: "regra não encontrada" });
    res.json(mapRule(rows[0]));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.delete("/api/alerts/rules/:id", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  const id = Number(req.params.id);
  try {
    await pool.query(`UPDATE alert_rules SET active = FALSE WHERE id = $1`, [id]);
    res.json({ ok: true, id, active: false });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/alerts/events", async (req, res) => {
  if (!pool) return res.json([]);
  const limit = Math.min(Number(req.query.limit) || 40, 100);
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.matched_on, e.status, e.created_at, e.sent_at,
              r.name AS rule_name, a.title, a.url, s.name AS source_name
       FROM alert_events e
       JOIN alert_rules r ON r.id = e.rule_id
       JOIN articles a ON a.id = e.article_id
       LEFT JOIN sources s ON s.id = a.source_id
       ORDER BY e.created_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(
      rows.map((r) => ({
        id: r.id,
        ruleName: r.rule_name,
        matchedOn: r.matched_on,
        status: r.status,
        title: r.title,
        url: r.url,
        source: r.source_name,
        createdAt: r.created_at,
        sentAt: r.sent_at,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/alerts/dispatch", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  if (!requireIngestAuth(req, res)) return;
  try {
    const report = await dispatchPendingAlerts(pool, {
      limit: Math.min(Number(req.body?.limit) || 30, 100),
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/** Simula alerta: cria evento a partir de artigo existente (ou o mais recente) e dispara. */
app.post("/api/alerts/test", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  if (!requireIngestAuth(req, res)) return;
  try {
    let ruleId = req.body?.ruleId ? Number(req.body.ruleId) : null;
    if (!ruleId) {
      const rules = await pool.query(
        `SELECT id FROM alert_rules WHERE active = TRUE ORDER BY id ASC LIMIT 1`
      );
      if (!rules.rowCount) return res.status(400).json({ error: "crie uma regra primeiro" });
      ruleId = rules.rows[0].id;
    }
    let articleId = req.body?.articleId ? Number(req.body.articleId) : null;
    if (!articleId) {
      const arts = await pool.query(
        `SELECT id, title, summary, theme, uf FROM articles ORDER BY fetched_at DESC LIMIT 1`
      );
      if (!arts.rowCount) return res.status(400).json({ error: "sem artigos na base" });
      articleId = arts.rows[0].id;
    }
    const art = await pool.query(
      `SELECT id, title, summary, theme, uf FROM articles WHERE id = $1`,
      [articleId]
    );
    if (!art.rowCount) return res.status(404).json({ error: "artigo não encontrado" });

    // força match registrando evento pending
    const keyword = String(req.body?.matchedOn || "teste").slice(0, 80);
    const ev = await pool.query(
      `INSERT INTO alert_events (rule_id, article_id, matched_on, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (rule_id, article_id) DO UPDATE
         SET status = 'pending', matched_on = EXCLUDED.matched_on, sent_at = NULL
       RETURNING id`,
      [ruleId, articleId, keyword]
    );
    const dispatch = await dispatchAlertEvent(pool, ev.rows[0].id);
    res.json({
      ok: true,
      eventId: ev.rows[0].id,
      articleId,
      ruleId,
      dispatch,
      extras: {
        whatsappTo: ALERT_WHATSAPP_TO || null,
        evolutionInstance: ALERT_EVOLUTION_INSTANCE || null,
        webhookConfigured: Boolean(N8N_ALERT_WEBHOOK),
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/** Rematch artigos recentes contra regras (útil após criar regra). */
app.post("/api/alerts/rematch", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  if (!requireIngestAuth(req, res)) return;
  const limit = Math.min(Number(req.body?.limit) || 200, 500);
  try {
    const { rows } = await pool.query(
      `SELECT id, title, summary, theme, uf FROM articles
       ORDER BY fetched_at DESC LIMIT $1`,
      [limit]
    );
    let matched = 0;
    for (const a of rows) {
      const r = await matchArticleAlerts(pool, a);
      matched += r.matched;
    }
    const dispatch = matched ? await dispatchPendingAlerts(pool) : null;
    res.json({ ok: true, scanned: rows.length, matched, dispatch });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/push/vapid-public-key", (_req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ error: "VAPID não configurado" });
  res.json({ publicKey: key });
});

app.get("/api/push/me", async (req, res) => {
  if (!pool) return res.json(null);
  const deviceId = String(req.query.deviceId || "").trim();
  const endpoint = String(req.query.endpoint || "").trim();
  if (!deviceId && !endpoint) return res.status(400).json({ error: "deviceId ou endpoint" });
  try {
    const { rows } = await pool.query(
      `SELECT id, device_id, uf, themes, keywords, active, updated_at
       FROM push_subscribers
       WHERE active = TRUE AND (
         ($1::text <> '' AND device_id = $1) OR ($2::text <> '' AND endpoint = $2)
       )
       ORDER BY updated_at DESC
       LIMIT 1`,
      [deviceId, endpoint]
    );
    if (!rows.length) return res.json(null);
    const r = rows[0];
    res.json({
      id: r.id,
      deviceId: r.device_id,
      uf: r.uf,
      themes: r.themes || [],
      keywords: r.keywords || [],
      active: r.active,
      updatedAt: r.updated_at,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/push/subscribe", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  if (!getVapidPublicKey()) return res.status(503).json({ error: "VAPID não configurado" });
  try {
    const row = await upsertSubscriber(pool, req.body || {});
    res.status(201).json({
      id: row.id,
      deviceId: row.device_id,
      uf: row.uf,
      themes: row.themes || [],
      keywords: row.keywords || [],
      active: row.active,
    });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

app.post("/api/push/unsubscribe", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  const endpoint = String(req.body?.endpoint || "").trim();
  const deviceId = String(req.body?.deviceId || "").trim();
  if (!endpoint && !deviceId) return res.status(400).json({ error: "endpoint ou deviceId" });
  try {
    await pool.query(
      `UPDATE push_subscribers SET active = FALSE, updated_at = NOW()
       WHERE ($1::text <> '' AND endpoint = $1) OR ($2::text <> '' AND device_id = $2)`,
      [endpoint, deviceId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/push/test", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  if (!ensureVapid()) return res.status(503).json({ error: "VAPID não configurado" });
  const deviceId = String(req.body?.deviceId || "").trim();
  const endpoint = String(req.body?.endpoint || "").trim();
  try {
    const subs = await pool.query(
      `SELECT id FROM push_subscribers
       WHERE active = TRUE AND (
         ($1::text <> '' AND device_id = $1) OR ($2::text <> '' AND endpoint = $2)
       )
       ORDER BY updated_at DESC LIMIT 1`,
      [deviceId, endpoint]
    );
    if (!subs.rowCount) return res.status(404).json({ error: "assinatura não encontrada" });

    let articleId = req.body?.articleId ? Number(req.body.articleId) : null;
    if (!articleId) {
      const arts = await pool.query(
        `SELECT id FROM articles ORDER BY fetched_at DESC LIMIT 1`
      );
      if (!arts.rowCount) return res.status(400).json({ error: "sem artigos" });
      articleId = arts.rows[0].id;
    }

    const ev = await pool.query(
      `INSERT INTO push_events (subscriber_id, article_id, matched_on, match_kind, status)
       VALUES ($1, $2, $3, 'test', 'pending')
       ON CONFLICT (subscriber_id, article_id) DO UPDATE
         SET status = 'pending', matched_on = EXCLUDED.matched_on, match_kind = 'test', sent_at = NULL
       RETURNING id`,
      [subs.rows[0].id, articleId, String(req.body?.matchedOn || "teste")]
    );
    const dispatch = await sendPushEvent(pool, ev.rows[0].id);
    res.json({ ok: true, eventId: ev.rows[0].id, articleId, dispatch });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.post("/api/push/dispatch", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  if (!requireIngestAuth(req, res)) return;
  try {
    const report = await dispatchPendingPush(pool, {
      limit: Math.min(Number(req.body?.limit) || 40, 100),
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/** Rematch push: artigos recentes × assinaturas. */
app.post("/api/push/rematch", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "DATABASE_URL não configurado" });
  if (!requireIngestAuth(req, res)) return;
  const limit = Math.min(Number(req.body?.limit) || 200, 500);
  try {
    const { rows } = await pool.query(
      `SELECT id, title, summary, theme, uf FROM articles
       ORDER BY fetched_at DESC LIMIT $1`,
      [limit]
    );
    let matched = 0;
    for (const a of rows) {
      const r = await matchArticlePush(pool, a);
      matched += r.matched;
    }
    const dispatch = matched ? await dispatchPendingPush(pool) : null;
    res.json({ ok: true, scanned: rows.length, matched, dispatch });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.get("/api/ufs", (_req, res) => {
  res.json({ ufs: BR_UFS });
});

app.get("/api/themes", (_req, res) => {
  res.json({ themes: THEMES });
});

app.get("/api/digest", async (req, res) => {
  const uf = normalizeUf(req.query.uf || "PE");
  const themeFilter = String(req.query.theme || "").trim().toLowerCase();
  const q = String(req.query.q || "").trim();
  const todayBr = dateInBrasilia();
  const yesterdayBr = shiftDateISO(todayBr, -1);
  let date = String(req.query.date || todayBr);
  let mode = "day"; // day | yesterday-fallback | recent
  if (!pool) {
    return res.json({ uf, date, today: todayBr, count: 0, items: [], bySource: [], note: "Sem banco" });
  }
  try {
    const filters = [];
    const params = [uf];
    let p = 2;

    if (themeFilter && themeFilter !== "todos" && themeFilter !== "all") {
      filters.push(`LOWER(COALESCE(a.theme, 'outros')) = $${p}`);
      params.push(themeFilter);
      p += 1;
    }
    if (q) {
      filters.push(
        `(a.title ILIKE $${p} OR COALESCE(a.summary, '') ILIKE $${p} OR COALESCE(s.name, '') ILIKE $${p})`
      );
      params.push(`%${q}%`);
      p += 1;
    }
    const extra = filters.length ? ` AND ${filters.join(" AND ")}` : "";

    const queryDay = async (day) => {
      const dayParams = [...params, day];
      const dayIdx = dayParams.length;
      const { rows } = await pool.query(
        `SELECT a.id, a.title, a.url, a.summary, a.published_at, a.fetched_at, a.theme, a.uf,
                s.name AS source_name, s.type AS source_type, s.city AS source_city
         FROM articles a
         LEFT JOIN sources s ON s.id = a.source_id
         WHERE COALESCE(a.uf, s.uf) = $1
           AND (COALESCE(a.published_at, a.fetched_at) AT TIME ZONE 'America/Sao_Paulo')::date = $${dayIdx}::date
           ${extra}
         ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
         LIMIT 150`,
        dayParams
      );
      return rows;
    };

    let rows = await queryDay(date);
    if (!rows.length && date === todayBr && !themeFilter && !q) {
      rows = await queryDay(yesterdayBr);
      if (rows.length) {
        date = yesterdayBr;
        mode = "yesterday-fallback";
      }
    }
    if (!rows.length && !themeFilter && !q) {
      const recent = await pool.query(
        `SELECT a.id, a.title, a.url, a.summary, a.published_at, a.fetched_at, a.theme, a.uf,
                s.name AS source_name, s.type AS source_type, s.city AS source_city
         FROM articles a
         LEFT JOIN sources s ON s.id = a.source_id
         WHERE COALESCE(a.uf, s.uf) = $1
           ${extra}
         ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
         LIMIT 40`,
        params
      );
      rows = recent.rows;
      mode = "recent";
    }

    const bySourceMap = new Map();
    const byThemeMap = new Map();
    for (const r of rows) {
      const key = r.source_name || "Sem fonte";
      bySourceMap.set(key, (bySourceMap.get(key) || 0) + 1);
      const mapped = mapArticle(r);
      const th = mapped.theme || "outros";
      byThemeMap.set(th, (byThemeMap.get(th) || 0) + 1);
    }
    const bySource = [...bySourceMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    const byTheme = [...byThemeMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const label =
      date === todayBr ? "Hoje" : date === yesterdayBr ? "Ontem" : date;

    res.json({
      uf,
      date,
      today: todayBr,
      yesterday: yesterdayBr,
      label,
      mode,
      theme: themeFilter || null,
      q: q || null,
      count: rows.length,
      bySource,
      byTheme,
      items: rows.map(mapArticle),
      note:
        mode === "yesterday-fallback"
          ? "Sem matérias marcadas para hoje — mostrando ontem."
          : mode === "recent"
            ? "Sem itens no dia — mostrando recentes."
            : null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

const publicCandidates = [path.join(root, "public"), path.join(root, "web", "dist")];
const publicDir = publicCandidates.find((p) => fs.existsSync(p));
if (publicDir) {
  app.use(
    express.static(publicDir, {
      setHeaders(res, filePath) {
        if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    })
  );
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

if (pool) {
  try {
    await pool.query("select 1");
    await migrate();
    await seedSources(pool, root);
    await backfillArticles();
    await seedDefaultAlertRule();
    ensureVapid();
  } catch (err) {
    console.warn("Postgres indisponível no boot:", err.message || err);
  }
} else {
  console.warn("DATABASE_URL ausente — API sobe sem persistência");
}

app.listen(PORT, () => {
  console.log(`Farol API :${PORT} (sprint ${SPRINT})`);
});
