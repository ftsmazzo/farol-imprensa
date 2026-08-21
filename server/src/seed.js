import fs from "node:fs";
import path from "node:path";

const SEED_FILES = ["sources-br-v1.json", "sources-ne-v1.json", "sources-pe-v1.json"];

export async function seedSources(pool, root) {
  const dataDir = path.join(root, "data");
  let files = SEED_FILES.map((f) => path.join(dataDir, f)).filter((p) => fs.existsSync(p));
  // Prefer Brasil pack (inclui NE + demais UFs)
  if (fs.existsSync(path.join(dataDir, "sources-br-v1.json"))) {
    files = [path.join(dataDir, "sources-br-v1.json")];
  } else if (fs.existsSync(path.join(dataDir, "sources-ne-v1.json"))) {
    files = [path.join(dataDir, "sources-ne-v1.json")];
  }
  if (!files.length) {
    console.log("Seed sources missing — skip");
    return { seeded: 0 };
  }

  let upserted = 0;
  const seen = new Set();
  for (const seedPath of files) {
    const pack = JSON.parse(fs.readFileSync(seedPath, "utf8"));
    const items = Array.isArray(pack.items) ? pack.items : [];
    for (const s of items) {
      if (!s?.id || seen.has(s.id)) continue;
      seen.add(s.id);
      await pool.query(
        `INSERT INTO sources (id, name, uf, city, type, website, rss_url, radar_vehicle_id, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           uf = EXCLUDED.uf,
           city = EXCLUDED.city,
           type = EXCLUDED.type,
           website = EXCLUDED.website,
           rss_url = EXCLUDED.rss_url,
           radar_vehicle_id = EXCLUDED.radar_vehicle_id,
           active = TRUE`,
        [
          s.id,
          s.name,
          s.uf,
          s.city || null,
          s.type || null,
          s.website || null,
          s.rssUrl || null,
          s.radarVehicleId || null,
        ]
      );
      upserted += 1;
    }
  }
  console.log(`Sources seeded: ${upserted}`);
  return { seeded: upserted };
}
