/**
 * Gera data/sources-br-v1.json — 27 UFs.
 * Nordeste: mantém pack Radar (sources-ne-v1).
 * Demais: G1 estadual + portais principais via Google News.
 */
import fs from "node:fs";

const ne = JSON.parse(fs.readFileSync("./data/sources-ne-v1.json", "utf8"));

function gNews(domain) {
  return `https://news.google.com/rss/search?q=site:${encodeURIComponent(domain)}+when:2d&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

function gNewsState(label) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(label)}+when:1d&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
}

/** G1 paths oficiais /dynamo/.../rss2.xml */
const G1 = {
  AC: ["G1 AC", "Rio Branco", "https://g1.globo.com/ac/acre/", "https://g1.globo.com/dynamo/ac/acre/rss2.xml"],
  AL: ["G1 AL", "Maceió", "https://g1.globo.com/al/alagoas/", "https://g1.globo.com/dynamo/al/alagoas/rss2.xml"],
  AP: ["G1 AP", "Macapá", "https://g1.globo.com/ap/amapa/", "https://g1.globo.com/dynamo/ap/amapa/rss2.xml"],
  AM: ["G1 AM", "Manaus", "https://g1.globo.com/am/amazonas/", "https://g1.globo.com/dynamo/am/amazonas/rss2.xml"],
  BA: ["G1 BA", "Salvador", "https://g1.globo.com/ba/bahia/", "https://g1.globo.com/dynamo/bahia/rss2.xml"],
  CE: ["G1 CE", "Fortaleza", "https://g1.globo.com/ce/ceara/", "https://g1.globo.com/dynamo/ceara/rss2.xml"],
  DF: ["G1 DF", "Brasília", "https://g1.globo.com/df/distrito-federal/", "https://g1.globo.com/dynamo/distrito-federal/rss2.xml"],
  ES: ["G1 ES", "Vitória", "https://g1.globo.com/es/espirito-santo/", "https://g1.globo.com/dynamo/espirito-santo/rss2.xml"],
  GO: ["G1 GO", "Goiânia", "https://g1.globo.com/go/goias/", "https://g1.globo.com/dynamo/goias/rss2.xml"],
  MA: ["G1 MA", "São Luís", "https://g1.globo.com/ma/maranhao/", "https://g1.globo.com/dynamo/ma/maranhao/rss2.xml"],
  MT: ["G1 MT", "Cuiabá", "https://g1.globo.com/mt/mato-grosso/", "https://g1.globo.com/dynamo/mato-grosso/rss2.xml"],
  MS: ["G1 MS", "Campo Grande", "https://g1.globo.com/ms/mato-grosso-do-sul/", "https://g1.globo.com/dynamo/mato-grosso-do-sul/rss2.xml"],
  MG: ["G1 MG", "Belo Horizonte", "https://g1.globo.com/mg/minas-gerais/", "https://g1.globo.com/dynamo/minas-gerais/rss2.xml"],
  PA: ["G1 PA", "Belém", "https://g1.globo.com/pa/para/", "https://g1.globo.com/dynamo/pa/para/rss2.xml"],
  PB: ["G1 PB", "João Pessoa", "https://g1.globo.com/pb/paraiba/", "https://g1.globo.com/dynamo/pb/paraiba/rss2.xml"],
  PR: ["G1 PR", "Curitiba", "https://g1.globo.com/pr/parana/", "https://g1.globo.com/dynamo/parana/rss2.xml"],
  PE: ["G1 PE", "Recife", "https://g1.globo.com/pe/pernambuco/", "https://g1.globo.com/dynamo/pe/pernambuco/rss2.xml"],
  PI: ["G1 PI", "Teresina", "https://g1.globo.com/pi/piaui/", "https://g1.globo.com/dynamo/pi/piaui/rss2.xml"],
  RJ: ["G1 RJ", "Rio de Janeiro", "https://g1.globo.com/rj/rio-de-janeiro/", "https://g1.globo.com/dynamo/rio-de-janeiro/rss2.xml"],
  RN: ["G1 RN", "Natal", "https://g1.globo.com/rn/rio-grande-do-norte/", "https://g1.globo.com/dynamo/rn/rio-grande-do-norte/rss2.xml"],
  RS: ["G1 RS", "Porto Alegre", "https://g1.globo.com/rs/rio-grande-do-sul/", "https://g1.globo.com/dynamo/rs/rio-grande-do-sul/rss2.xml"],
  RO: ["G1 RO", "Porto Velho", "https://g1.globo.com/ro/rondonia/", "https://g1.globo.com/dynamo/ro/rondonia/rss2.xml"],
  RR: ["G1 RR", "Boa Vista", "https://g1.globo.com/rr/roraima/", "https://g1.globo.com/dynamo/rr/roraima/rss2.xml"],
  SC: ["G1 SC", "Florianópolis", "https://g1.globo.com/sc/santa-catarina/", "https://g1.globo.com/dynamo/sc/santa-catarina/rss2.xml"],
  SP: ["G1 SP", "São Paulo", "https://g1.globo.com/sp/sao-paulo/", "https://g1.globo.com/dynamo/sao-paulo/rss2.xml"],
  SE: ["G1 SE", "Aracaju", "https://g1.globo.com/se/sergipe/", "https://g1.globo.com/dynamo/se/sergipe/rss2.xml"],
  TO: ["G1 TO", "Palmas", "https://g1.globo.com/to/tocantins/", "https://g1.globo.com/dynamo/to/tocantins/rss2.xml"],
};

/** Portais/jornais relevantes fora do pack Nordeste (domínio → nome). */
const EXTRA = {
  AC: [["ac24horas.com", "AC24Horas"], ["contilnetnoticias.com.br", "ContilNet"]],
  AP: [["amigodecomercio.com.br", "Amigo do Comércio"], ["diarioaparecida.com.br", "Diário Amapá"]],
  AM: [["acritica.com", "A Crítica"], ["portaldoholanda.com.br", "Portal do Holanda"]],
  DF: [["correiobraziliense.com.br", "Correio Braziliense"], ["metropoles.com", "Metrópoles"]],
  ES: [["gazetaonline.com.br", "Gazeta Online"], ["folhavitoria.com.br", "Folha Vitória"]],
  GO: [["opopular.com.br", "O Popular"], ["jornalopcao.com.br", "Jornal Opção"]],
  MT: [["midianews.com.br", "Mídia News"], ["olhardireto.com.br", "Olhar Direto"]],
  MS: [["midiamax.com.br", "Midiamax"], ["campograndenews.com.br", "Campo Grande News"]],
  MG: [["otempo.com.br", "O Tempo"], ["em.com.br", "Estado de Minas"]],
  PA: [["orm.com.br", "ORM News"], ["diarioonline.com.br", "Diário Online"]],
  PR: [["gazetadopovo.com.br", "Gazeta do Povo"], ["bemparana.com.br", "Bem Paraná"]],
  RJ: [["extra.globo.com", "Extra"], ["odia.ig.com.br", "O Dia"]],
  RS: [["gauchazh.clicrbs.com.br", "GaúchaZH"], ["correiodopovo.com.br", "Correio do Povo"]],
  RO: [["rondoniaovivo.com", "Rondônia Ao Vivo"], ["diariodaamazonia.com.br", "Diário da Amazônia"]],
  RR: [["folhabv.com.br", "Folha de Boa Vista"], ["roraimaemtempo.com", "Roraima em Tempo"]],
  SC: [["nsctotal.com.br", "NSC Total"], ["ndmais.com.br", "ND Mais"]],
  SP: [["folha.uol.com.br", "Folha de S.Paulo"], ["estadao.com.br", "Estadão"], ["g1.globo.com/sp", "G1 SP (Google)"]],
  TO: [["afnoticias.com.br", "AF Notícias"], ["conexaoto.com.br", "Conexão TO"]],
};

const NE = new Set(["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"]);

const items = [...ne.items];
const seen = new Set(items.map((i) => i.id));

function pushItem(item) {
  if (seen.has(item.id)) return;
  seen.add(item.id);
  items.push(item);
}

for (const [uf, row] of Object.entries(G1)) {
  if (NE.has(uf) && seen.has(`${uf.toLowerCase()}-g1`)) continue;
  const [name, city, website, rss] = row;
  pushItem({
    id: `${uf.toLowerCase()}-g1`,
    name,
    uf,
    city,
    type: "Portal",
    website,
    rssUrl: rss,
    radarVehicleId: null,
  });
}

for (const [uf, list] of Object.entries(EXTRA)) {
  for (const [domain, name] of list) {
    const id = `${uf.toLowerCase()}-${domain.replace(/\W+/g, "-").slice(0, 40)}`;
    pushItem({
      id,
      name,
      uf,
      city: null,
      type: "Portal",
      website: `https://${domain.replace(/\/.*/, "")}`,
      rssUrl: domain.includes("/") ? gNewsState(name) : gNews(domain),
      radarVehicleId: null,
    });
  }
}

// Ampliação leve: Google News do nome do estado (fora NE, 1 feed)
const STATE_QUERY = {
  AC: "Acre",
  AP: "Amapá",
  AM: "Amazonas",
  DF: "Brasília OR \"Distrito Federal\"",
  ES: "\"Espírito Santo\"",
  GO: "Goiás",
  MT: "\"Mato Grosso\" -Sul",
  MS: "\"Mato Grosso do Sul\"",
  MG: "\"Minas Gerais\"",
  PA: "Pará -Paraíba",
  PR: "Paraná",
  RJ: "\"Rio de Janeiro\"",
  RS: "\"Rio Grande do Sul\"",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "\"Santa Catarina\"",
  SP: "\"São Paulo\"",
  TO: "Tocantins",
};

for (const [uf, q] of Object.entries(STATE_QUERY)) {
  pushItem({
    id: `${uf.toLowerCase()}-gnews-estado`,
    name: `Google News · ${uf}`,
    uf,
    city: null,
    type: "Agregador",
    website: "https://news.google.com/",
    rssUrl: gNewsState(q),
    radarVehicleId: null,
  });
}

const ufs = [...new Set(items.map((i) => i.uf))].sort();
const pack = {
  version: "sources-br-v1",
  ufs,
  note: "Brasil 27 UFs: Nordeste (Radar) + G1 estadual + portais principais + Google News estadual",
  generatedAt: new Date().toISOString(),
  items,
};

fs.writeFileSync("./data/sources-br-v1.json", JSON.stringify(pack, null, 2));
const counts = {};
for (const i of items) counts[i.uf] = (counts[i.uf] || 0) + 1;
console.log("ufs", ufs.length, "total", items.length);
console.log(counts);
