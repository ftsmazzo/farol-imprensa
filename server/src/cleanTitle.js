/** Limpa sufixo de veículo colado no título (Google News / agregadores). */

const SOURCE_SUFFIXES = [
  "Blog do Didi Galvão",
  "Blog do Carlos Britto",
  "Blog do Finfa",
  "Blog do Alberes Xavier",
  "Blog Edmar Lyra",
  "Blog Ponto de Vista",
  "Movimento Econômico",
  "Diário de Pernambuco",
  "Folha de Pernambuco",
  "Portal Folhape",
  "LeiaJá",
  "Leia Já",
  "CBN Recife",
  "Marco Zero Conteúdo",
  "Marco Zero",
  "NE10 (JC Online)",
  "NE10",
  "JC Online",
  "G1 PE",
  "G1 BA",
  "G1 CE",
  "G1 AL",
  "G1",
  "NE45",
  "Podcast 45 Minutos",
  "Diário do Nordeste",
  "O Povo",
  "Correio 24 Horas",
  "A Tarde",
  "Bahia Notícias",
  "TNH1",
  "Gazeta Web",
  "Meio Norte",
  "Cidade Verde",
  "Tribuna do Norte",
  "Portal Infonet",
  "ClickPB",
  "Jornal da Paraíba",
];

const GLUE_PREFIX =
  /(Blog|Portal|Jornal|Di[aá]rio|Folha|G1|CBN|NE\d+|Leia|Marco|Movimento)/i;

/**
 * Ex.: "... CabrobóBlog do Didi Galvão" → "... Cabrobó"
 * Também remove " - Fonte" clássico do Google News.
 */
export function cleanTitle(raw, sourceName = null) {
  let title = String(raw || "").replace(/\s+/g, " ").trim();
  if (!title) return title;

  // Separador explícito " - Fonte"
  if (title.includes(" - ")) {
    const parts = title.split(" - ");
    const last = parts[parts.length - 1];
    if (parts.length >= 2 && last.length < 70) {
      title = parts.slice(0, -1).join(" - ").trim();
    }
  }

  const suffixes = [...SOURCE_SUFFIXES];
  if (sourceName) suffixes.unshift(String(sourceName));

  // Sufixo conhecido colado ou com espaço
  for (const suf of suffixes) {
    const s = String(suf || "").trim();
    if (s.length < 2) continue;
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // "...CabrobóBlog..." ou "... Cabrobó Blog..."
    const reGlued = new RegExp(`([\\p{L}\\p{N}])(${esc})$`, "iu");
    const reSpaced = new RegExp(`(?:\\s+[—–-]\\s*|\\s+)${esc}$`, "iu");
    if (reGlued.test(title)) {
      title = title.replace(reGlued, "$1").trim();
      break;
    }
    if (reSpaced.test(title)) {
      title = title.replace(reSpaced, "").trim();
      break;
    }
  }

  // Heurística: letra minúscula/acento + Blog/Portal... colado
  const glue = title.match(new RegExp(`([\\p{Ll}\\p{N}])(${GLUE_PREFIX.source}.*)$`, "u"));
  if (glue && glue[2].length < 70) {
    title = title.slice(0, title.length - glue[2].length).trim();
  }

  return title.slice(0, 500);
}
