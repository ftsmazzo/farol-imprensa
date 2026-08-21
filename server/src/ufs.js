/** UFs do piloto Nordeste (Farol). */

export const NE_UFS = [
  { uf: "AL", name: "Alagoas" },
  { uf: "BA", name: "Bahia" },
  { uf: "CE", name: "Ceará" },
  { uf: "MA", name: "Maranhão" },
  { uf: "PB", name: "Paraíba" },
  { uf: "PE", name: "Pernambuco" },
  { uf: "PI", name: "Piauí" },
  { uf: "RN", name: "Rio Grande do Norte" },
  { uf: "SE", name: "Sergipe" },
];

export function isValidUf(uf) {
  const u = String(uf || "").toUpperCase();
  return NE_UFS.some((x) => x.uf === u);
}

export function normalizeUf(uf, fallback = "PE") {
  const u = String(uf || "").toUpperCase().slice(0, 2);
  return isValidUf(u) ? u : fallback;
}
