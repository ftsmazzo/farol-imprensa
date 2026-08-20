import crypto from "node:crypto";

function hashUrl(url) {
  return crypto.createHash("sha256").update(String(url).trim()).digest("hex").slice(0, 40);
}

function decodeXml(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function tag(block, name) {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  return m ? decodeXml(m[1]) : null;
}

/** Parser RSS/Atom mínimo (sem dependência extra). */
export function parseFeed(xml) {
  const items = [];
  const chunks = String(xml).match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  for (const block of chunks) {
    let title = tag(block, "title");
    let link =
      tag(block, "link") ||
      (block.match(/<link[^>]+href=["']([^"']+)["']/i) || [])[1] ||
      null;
    if (!link) {
      const bare = block.match(/<link>([^<]+)<\/link>/i);
      link = bare ? decodeXml(bare[1]) : null;
    }
    const summary = tag(block, "description") || tag(block, "summary") || tag(block, "content") || null;
    const pub =
      tag(block, "pubDate") ||
      tag(block, "published") ||
      tag(block, "updated") ||
      tag(block, "dc:date") ||
      null;
    if (!title || !link) continue;
    // Google News: "Título - Veículo"
    if (title.includes(" - ")) {
      const parts = title.split(" - ");
      if (parts.length >= 2 && parts[parts.length - 1].length < 60) {
        title = parts.slice(0, -1).join(" - ").trim();
      }
    }
    let publishedAt = null;
    if (pub) {
      const d = new Date(pub);
      if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
    }
    items.push({
      title: title.slice(0, 500),
      url: link.slice(0, 2000),
      summary: summary ? summary.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1000) : null,
      publishedAt,
    });
  }
  return items;
}

async function fetchFeed(rssUrl) {
  const res = await fetch(rssUrl, {
    redirect: "follow",
    headers: {
      "user-agent": "FarolImprensaBot/0.1 (+https://farol-imprensa-web.kxryyk.easypanel.host)",
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

export async function ingestSource(pool, source) {
  if (!source.rss_url) {
    return { sourceId: source.id, fetched: 0, inserted: 0, skipped: 0, error: "sem rss_url" };
  }
  try {
    const xml = await fetchFeed(source.rss_url);
    const items = parseFeed(xml).slice(0, 40);
    let inserted = 0;
    let skipped = 0;
    for (const item of items) {
      const urlHash = hashUrl(item.url);
      const result = await pool.query(
        `INSERT INTO articles (source_id, url, url_hash, title, summary, published_at, uf, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (url_hash) DO NOTHING
         RETURNING id`,
        [
          source.id,
          item.url,
          urlHash,
          item.title,
          item.summary,
          item.publishedAt,
          source.uf,
          JSON.stringify({ ingest: "rss", at: new Date().toISOString() }),
        ]
      );
      if (result.rowCount) inserted += 1;
      else skipped += 1;
    }
    await pool.query(`UPDATE sources SET last_fetched_at = NOW() WHERE id = $1`, [source.id]);
    return { sourceId: source.id, name: source.name, fetched: items.length, inserted, skipped };
  } catch (err) {
    return {
      sourceId: source.id,
      name: source.name,
      fetched: 0,
      inserted: 0,
      skipped: 0,
      error: String(err.message || err),
    };
  }
}

export async function runIngest(pool, { uf = "PE", limitSources = 50 } = {}) {
  const params = [];
  let where = "WHERE active = TRUE AND rss_url IS NOT NULL AND rss_url <> ''";
  if (uf) {
    params.push(String(uf).toUpperCase());
    where += ` AND uf = $${params.length}`;
  }
  params.push(limitSources);
  const { rows } = await pool.query(
    `SELECT * FROM sources ${where} ORDER BY last_fetched_at NULLS FIRST, name ASC LIMIT $${params.length}`,
    params
  );

  const results = [];
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  for (const source of rows) {
    const r = await ingestSource(pool, source);
    results.push(r);
    inserted += r.inserted || 0;
    skipped += r.skipped || 0;
    if (r.error) errors += 1;
  }

  return {
    ok: true,
    uf: uf || null,
    sources: rows.length,
    inserted,
    skipped,
    errors,
    results,
    finishedAt: new Date().toISOString(),
  };
}
