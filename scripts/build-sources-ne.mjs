import fs from "node:fs";

const desk = JSON.parse(
  fs.readFileSync("../radar-imprensa-nordeste-v2/data/desk-score-v1.json", "utf8")
);
const ed = JSON.parse(
  fs.readFileSync("../radar-imprensa-nordeste-v2/data/editorial-ranking-v1.json", "utf8")
);
const pe = JSON.parse(fs.readFileSync("./data/sources-pe-v1.json", "utf8"));

const siteById = new Map(ed.items.map((i) => [i.vehicleId, i.sourceDirectory]));

const G1 = {
  AL: {
    name: "G1 AL",
    city: "Maceió",
    website: "https://g1.globo.com/al/alagoas/",
    rss: "https://g1.globo.com/dynamo/al/alagoas/rss2.xml",
  },
  BA: {
    name: "G1 BA",
    city: "Salvador",
    website: "https://g1.globo.com/ba/bahia/",
    rss: "https://g1.globo.com/dynamo/bahia/rss2.xml",
  },
  CE: {
    name: "G1 CE",
    city: "Fortaleza",
    website: "https://g1.globo.com/ce/ceara/",
    rss: "https://g1.globo.com/dynamo/ceara/rss2.xml",
  },
  MA: {
    name: "G1 MA",
    city: "São Luís",
    website: "https://g1.globo.com/ma/maranhao/",
    rss: "https://g1.globo.com/dynamo/ma/maranhao/rss2.xml",
  },
  PB: {
    name: "G1 PB",
    city: "João Pessoa",
    website: "https://g1.globo.com/pb/paraiba/",
    rss: "https://g1.globo.com/dynamo/pb/paraiba/rss2.xml",
  },
  PI: {
    name: "G1 PI",
    city: "Teresina",
    website: "https://g1.globo.com/pi/piaui/",
    rss: "https://g1.globo.com/dynamo/pi/piaui/rss2.xml",
  },
  RN: {
    name: "G1 RN",
    city: "Natal",
    website: "https://g1.globo.com/rn/rio-grande-do-norte/",
    rss: "https://g1.globo.com/dynamo/rn/rio-grande-do-norte/rss2.xml",
  },
  SE: {
    name: "G1 SE",
    city: "Aracaju",
    website: "https://g1.globo.com/se/sergipe/",
    rss: "https://g1.globo.com/dynamo/se/sergipe/rss2.xml",
  },
};

function domainFromUrl(raw) {
  try {
    let u = String(raw || "").trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, "")}`;
    const host = new URL(u).hostname.replace(/^www\./, "");
    if (!host || host.includes(" ")) return null;
    return host;
  } catch {
    return null;
  }
}

function slug(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function googleNewsRss(domain) {
  return `https://news.google.com/rss/search?q=site:${encodeURIComponent(domain)}+when:2d&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

const byUf = {};
for (const it of desk.items) {
  if (String(it.type || "").toLowerCase() === "tv") continue;
  if (!byUf[it.uf]) byUf[it.uf] = [];
  byUf[it.uf].push(it);
}

const TOP = 8;
const items = [...pe.items];

for (const uf of Object.keys(byUf).sort()) {
  if (uf === "PE") continue;
  const list = byUf[uf]
    .sort((a, b) => (a.editorialRank || 99) - (b.editorialRank || 99))
    .slice(0, TOP);
  const g1 = G1[uf];
  if (g1) {
    items.push({
      id: `${uf.toLowerCase()}-g1`,
      name: g1.name,
      uf,
      city: g1.city,
      type: "Portal",
      website: g1.website,
      rssUrl: g1.rss,
      radarVehicleId: null,
    });
  }
  for (const v of list) {
    const name = String(v.name || "").replace(/\s+/g, " ").trim();
    if (/^g1\b/i.test(name)) continue;
    const websiteRaw = siteById.get(v.vehicleId) || null;
    const domain = domainFromUrl(websiteRaw);
    if (!domain) continue;
    const website = /^https?:\/\//i.test(String(websiteRaw))
      ? websiteRaw
      : `https://${domain}`;
    items.push({
      id: `${uf.toLowerCase()}-${slug(name)}`.slice(0, 64),
      name: name.replace(/\s+/g, " ").slice(0, 120),
      uf,
      city: v.city || null,
      type: v.type || "Portal",
      website,
      rssUrl: googleNewsRss(domain),
      radarVehicleId: v.vehicleId || null,
    });
  }
}

const pack = {
  version: "sources-ne-v1",
  ufs: [...new Set(items.map((i) => i.uf))].sort(),
  note: "Nordeste: PE curated + Top 8 Radar/UF + G1 estadual; demais via Google News site:",
  generatedAt: new Date().toISOString(),
  items,
};

fs.writeFileSync("./data/sources-ne-v1.json", JSON.stringify(pack, null, 2));
const counts = {};
for (const i of items) counts[i.uf] = (counts[i.uf] || 0) + 1;
console.log("total", items.length, counts);
