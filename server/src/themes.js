/** Classificação v0 por palavras-chave (Sprint 4). */

export const THEMES = [
  "política",
  "economia",
  "segurança",
  "saúde",
  "educação",
  "meio ambiente",
];

/** Temas selecionáveis no app (sem "outros"). */
export const SELECTABLE_THEMES = THEMES;

const RULES = [
  {
    theme: "política",
    words: [
      "prefeitura",
      "prefeito",
      "camara",
      "câmara",
      "vereador",
      "governo",
      "governador",
      "elei",
      "deputado",
      "senador",
      "ministro",
      "assembleia",
      "partido",
      "candidato",
      "lula",
      "bolsonaro",
      "alepe",
      "stf",
      "congresso",
    ],
  },
  {
    theme: "economia",
    words: [
      "economia",
      "infla",
      "juros",
      "emprego",
      "desemprego",
      "pib",
      "mercado",
      "empresa",
      "investimento",
      "imposto",
      "tribut",
      "salário",
      "salario",
      "comércio",
      "comercio",
      "indústria",
      "industria",
    ],
  },
  {
    theme: "segurança",
    words: [
      "polícia",
      "policia",
      "assassin",
      "homicíd",
      "homicid",
      "tráfico",
      "trafico",
      "roubo",
      "furto",
      "preso",
      "prisão",
      "prisao",
      "tiro",
      "crime",
      "segurança",
      "seguranca",
      "pm ",
      "bombeiro",
    ],
  },
  {
    theme: "saúde",
    words: [
      "saúde",
      "saude",
      "hospital",
      "sus ",
      "vacina",
      "médico",
      "medico",
      "paciente",
      "dengue",
      "covid",
      "epidemia",
      "ubs",
      "samu",
    ],
  },
  {
    theme: "educação",
    words: [
      "educação",
      "educacao",
      "escola",
      "universidade",
      "professor",
      "aluno",
      "enem",
      "mec ",
      "creche",
      "faculdade",
    ],
  },
  {
    theme: "meio ambiente",
    words: [
      "meio ambiente",
      "palmeira",
      "desmat",
      "ambiental",
      "rios",
      "seca",
      "chuva",
      "clima",
      "recicl",
      "poluição",
      "poluicao",
      "ibama",
      "fauna",
      "flora",
    ],
  },
];

export function classifyTheme(title, summary = "") {
  const text = `${title || ""} ${summary || ""}`.toLowerCase();
  let best = { theme: "outros", score: 0 };
  for (const rule of RULES) {
    let score = 0;
    for (const w of rule.words) {
      if (text.includes(w.toLowerCase())) score += 1;
    }
    if (score > best.score) best = { theme: rule.theme, score };
  }
  return best.theme;
}
