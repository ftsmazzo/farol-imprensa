import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname = .../server/src → raiz do repo/imagem = ../..
const root = path.resolve(__dirname, "../..");
const { Pool } = pg;

const PORT = Number(process.env.PORT || 3100);
const DATABASE_URL = process.env.DATABASE_URL || "";

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
    })
  : null;

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
  `);
  console.log("Migrate ok");
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  if (!pool) {
    return res.json({
      ok: true,
      service: "farol",
      sprint: 1,
      db: false,
      note: "Defina DATABASE_URL para ativar Postgres",
    });
  }
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS articles FROM articles");
    res.json({
      ok: true,
      service: "farol",
      sprint: 1,
      db: true,
      articles: rows[0].articles,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get("/api/meta", async (_req, res) => {
  if (!pool) {
    return res.json({
      service: "farol",
      sprint: 1,
      pilotUf: "PE",
      sources: 0,
      articles: 0,
      alertRules: 0,
      db: false,
      note: "Sprint 1 — fundação. Ingestão no Sprint 2.",
    });
  }
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM sources WHERE active) AS sources,
        (SELECT COUNT(*)::int FROM articles) AS articles,
        (SELECT COUNT(*)::int FROM alert_rules WHERE active) AS alert_rules,
        (SELECT MAX(fetched_at) FROM articles) AS last_article_at,
        (SELECT MAX(last_fetched_at) FROM sources) AS last_fetch_at
    `);
    const r = rows[0];
    res.json({
      service: "farol",
      sprint: 1,
      pilotUf: "PE",
      db: true,
      sources: r.sources,
      articles: r.articles,
      alertRules: r.alert_rules,
      lastArticleAt: r.last_article_at,
      lastFetchAt: r.last_fetch_at,
      note: "Sprint 1 — fundação. Ingestão no Sprint 2.",
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/** Placeholder Sprint 3 — contrato já definido */
app.get("/api/digest", async (req, res) => {
  const uf = String(req.query.uf || "PE").toUpperCase();
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  if (!pool) {
    return res.json({ uf, date, items: [], note: "Sem banco — Sprint 1" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.title, a.url, a.summary, a.published_at, a.fetched_at, a.theme, a.uf,
              s.name AS source_name, s.type AS source_type, s.city AS source_city
       FROM articles a
       LEFT JOIN sources s ON s.id = a.source_id
       WHERE COALESCE(a.uf, s.uf) = $1
         AND COALESCE(a.published_at, a.fetched_at)::date = $2::date
       ORDER BY COALESCE(a.published_at, a.fetched_at) DESC
       LIMIT 100`,
      [uf, date]
    );
    res.json({
      uf,
      date,
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        url: r.url,
        summary: r.summary,
        publishedAt: r.published_at,
        fetchedAt: r.fetched_at,
        theme: r.theme,
        uf: r.uf,
        source: r.source_name,
        sourceType: r.source_type,
        city: r.source_city,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

const publicCandidates = [path.join(root, "public"), path.join(root, "web", "dist")];
const publicDir = publicCandidates.find((p) => fs.existsSync(p));
if (publicDir) {
  app.use(express.static(publicDir));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

if (pool) {
  try {
    await pool.query("select 1");
    await migrate();
  } catch (err) {
    console.warn("Postgres indisponível no boot:", err.message || err);
  }
} else {
  console.warn("DATABASE_URL ausente — API sobe sem persistência (Sprint 1)");
}

app.listen(PORT, () => {
  console.log(`Farol API :${PORT} (sprint 1)`);
});
