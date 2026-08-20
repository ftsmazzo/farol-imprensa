import fs from "node:fs";
import path from "node:path";

export async function seedSources(pool, root) {
  const seedPath = path.join(root, "data", "sources-pe-v1.json");
  if (!fs.existsSync(seedPath)) {
    console.log("Seed sources missing — skip");
    return { seeded: 0 };
  }
  const pack = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  const items = Array.isArray(pack.items) ? pack.items : [];
  let upserted = 0;
  for (const s of items) {
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
  console.log(`Sources seeded: ${upserted}`);
  return { seeded: upserted };
}
