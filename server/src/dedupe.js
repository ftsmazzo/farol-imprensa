/** Deduplica matérias iguais priorizando veículos originais (não Google). */

export function normalizeTitleKey(title) {
  const cleaned = String(title || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Primeiras palavras significativas (ignora números soltos) → pega quase-duplicatas
  const words = cleaned
    .split(" ")
    .filter((w) => w.length > 2 && !/^\d+$/.test(w))
    .slice(0, 8);
  return words.join(" ").slice(0, 120);
}

/** Quanto maior, melhor (fica no digest). */
export function sourcePriority(item) {
  const name = String(item.source || "").toLowerCase();
  const type = String(item.sourceType || "").toLowerCase();
  const id = String(item.sourceId || "").toLowerCase();

  if (id.includes("gnews") || name.includes("google news")) return 5;
  if (name.includes("(google)") || /\bgoogle\b/.test(name)) return 15;
  if (type === "agregador") return 25;
  if (name.startsWith("g1 ")) return 70;
  return 90;
}

/**
 * Mantém uma matéria por título normalizado.
 * Empate: maior prioridade de fonte; depois a mais recente.
 */
export function dedupePreferOriginal(items) {
  const best = new Map();
  for (const item of items) {
    const key = normalizeTitleKey(item.title);
    if (!key || key.length < 12) {
      best.set(`id:${item.id}`, item);
      continue;
    }
    const prev = best.get(key);
    if (!prev) {
      best.set(key, item);
      continue;
    }
    const pNew = sourcePriority(item);
    const pOld = sourcePriority(prev);
    if (pNew > pOld) {
      best.set(key, item);
      continue;
    }
    if (pNew < pOld) continue;
    const tNew = Date.parse(item.publishedAt || item.fetchedAt || 0) || 0;
    const tOld = Date.parse(prev.publishedAt || prev.fetchedAt || 0) || 0;
    if (tNew >= tOld) best.set(key, item);
  }
  return [...best.values()].sort((a, b) => {
    const ta = Date.parse(a.publishedAt || a.fetchedAt || 0) || 0;
    const tb = Date.parse(b.publishedAt || b.fetchedAt || 0) || 0;
    return tb - ta;
  });
}
