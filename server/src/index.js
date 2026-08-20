import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { cleanTitle } from "./cleanTitle.js";
import { runIngest } from "./ingest.js";
import { seedSources } from "./seed.js";
import { THEMES, classifyTheme } from "./themes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname = .../server/src → raiz do repo/imagem = ../..
const root = path.resolve(__dirname, "../..");
const { Pool } = pg;

const PORT = Number(process.env.PORT || 3100);
const DATABASE_URL = process.env.DATABASE_URL || "";
const INGEST_TOKEN = process.env.INGEST_TOKEN || "";
const SPRINT = 4;

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
      db: true,
      sources: r.sources,
      sourcesWithRss: r.sources_rss,
      articles: r.articles,
      alertRules: r.alert_rules,
      lastArticleAt: r.last_article_at,
      lastFetchAt: r.last_fetch_at,
      ingestRunning,
      note:
        r.articles > 0
          ? "Ingestão ativa (Sprint 2). Use Coletar no painel ou POST /api/ingest/run."
          : "Fontes PE seedadas. Rode a coleta para popular o digest.",
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

  const uf = String(req.body?.uf || "PE").toUpperCase();
  ingestRunning = true;
  try {
    const report = await runIngest(pool, { uf });
    res.status(202).json(report);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  } finally {
    ingestRunning = false;
  }
});

app.get("/api/themes", (_req, res) => {
  res.json({ themes: THEMES });
});

app.get("/api/digest", async (req, res) => {
  const uf = String(req.query.uf || "PE").toUpperCase();
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
    await seedSources(pool, root);
    await backfillArticles();
  } catch (err) {
    console.warn("Postgres indisponível no boot:", err.message || err);
  }
} else {
  console.warn("DATABASE_URL ausente — API sobe sem persistência");
}

app.listen(PORT, () => {
  console.log(`Farol API :${PORT} (sprint ${SPRINT})`);
});
