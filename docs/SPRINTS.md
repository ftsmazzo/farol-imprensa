# Farol — Sprints (MVP)

Ciclos **curtos** (1–2 dias cada). Cada sprint tem: objetivo, entregável, DoD, fora de escopo.

**Piloto:** PE · **Fontes:** Top do Radar · **Stack:** Node + Postgres + Vite/React + n8n

---

## Mapa

| Sprint | Nome | Objetivo em 1 frase |
|--------|------|---------------------|
| **1** | Fundação | Repo sobe: API + painel + schema + health |
| **2** | Ingestão | RSS dos veículos PE entra no banco (dedup) |
| **3** | Digest | Painel mostra notícias do dia |
| **4** | Temas | Filtro por tema + busca |
| **5** | Alertas | Regras + disparo n8n (1 canal) |

Depois do 5 = MVP utilizável. Escala UF/Brasil só após calibrar PE.

---

## Sprint 1 — Fundação

**Objetivo:** ter um app que sobe localmente, com contrato de dados claro.

**Entregáveis**
- [x] Estrutura `server/` + `web/`
- [x] Migrate: `sources`, `articles`, `alert_rules`, `alert_events`
- [x] `GET /api/health`, `GET /api/meta`, `GET /api/digest` (contrato)
- [x] Painel shell (marca Farol + empty state)
- [x] Docs de sprint + README de run

**DoD:** API sobe; health responde `ok`; painel carrega meta.

**Fora:** ingestão real, UI de lista cheia, alertas.

---

## Sprint 2 — Ingestão PE

**Objetivo:** notícias novas aparecem no Postgres sem UI sofisticada.

**Entregáveis**
- Seed de `sources` (PE: Top editorial/quantitativo do Radar + RSS quando houver)
- Job `POST /api/ingest/run` (RSS parse + dedup por URL)
- Log de última coleta em `/api/meta`

**DoD:** rodar ingest 2× e ver `articles` crescer sem duplicar URL.

**Fora:** classificação LLM, Apify, multi-UF.

---

## Sprint 3 — Digest do dia

**Objetivo:** operador vê o dia em &lt; 10s.

**Entregáveis**
- `GET /api/digest?uf=PE&date=YYYY-MM-DD`
- Lista no painel: hora, título, veículo, link
- Contador do dia + “última coleta”

**DoD:** abrir painel e enxergar matérias de hoje (ou ontem se vazio).

**Fora:** temas, alertas, export.

---

## Sprint 4 — Temas e busca

**Objetivo:** achar pauta sem planilha.

**Entregáveis**
- Classificação v0 (regras/keywords → tema)
- Filtro por tema + busca texto
- Temas iniciais: política, economia, segurança, saúde, educação, outros

**DoD:** filtrar “política” e buscar um sobrenome retorna subset coerente.

**Fora:** NER pesado, multi-idioma.

---

## Sprint 5 — Alertas

**Objetivo:** saber quando sai notícia sobre X.

**Entregáveis**
- CRUD mínimo de regras (nome/keyword/UF)
- Match na ingestão → fila `alert_events`
- Webhook n8n (WhatsApp **ou** e-mail)

**DoD:** publicar/simular matéria com keyword → notificação em &lt; 30 min (ou imediato no job).

**Fora:** app mobile, 10 canais, ML de relevância.

---

## Cadência

1. Começa sprint → só os itens do sprint  
2. Termina → DoD verde → commit  
3. Demo de 5 min → próximo  

Sem misturar “já vamos pro Brasil” no meio do MVP PE.
