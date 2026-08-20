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
- [x] Seed de `sources` (PE: Top Radar + RSS / Google News)
- [x] Job `POST /api/ingest/run` (RSS parse + dedup por URL)
- [x] Log de última coleta em `/api/meta`
- [x] Botão **Coletar agora** no painel

**DoD:** rodar ingest 2× e ver `articles` crescer sem duplicar URL.

**Fora:** classificação LLM, Apify, multi-UF.

---

## Sprint 3 — Digest do dia

**Objetivo:** operador vê o dia em &lt; 10s.

**Entregáveis**
- [x] `GET /api/digest?uf=PE&date=` com contagem, label e por fonte
- [x] Lista: hora · título · veículo · link
- [x] Contador do dia + Hoje/Ontem + última coleta
- [x] Fallback automático (hoje → ontem → recentes)

**DoD:** abrir painel e enxergar matérias de hoje (ou ontem se vazio).

**Fora:** temas, alertas, export.

---

## Sprint 4 — Temas e busca

**Objetivo:** achar pauta sem planilha.

**Entregáveis**
- [x] Classificação v0 (regras/keywords → tema)
- [x] Filtro por tema + busca texto (`?theme=` / `?q=`)
- [x] Temas: política, economia, segurança, saúde, educação, meio ambiente, outros
- [x] Limpeza de título colado à fonte (ex.: `CabrobóBlog…` → `Cabrobó`)

**DoD:** filtrar “política” e buscar um sobrenome retorna subset coerente.

**Fora:** NER pesado, multi-idioma.

---

## Sprint 5 — Alertas

**Objetivo:** saber quando sai notícia sobre X.

**Entregáveis**
- [x] CRUD mínimo de regras (nome/keyword/UF)
- [x] Match na ingestão → fila `alert_events`
- [x] Webhook n8n (+ WhatsApp Evolution opcional)
- [x] Painel: criar regra, rematch, testar disparo, lista de eventos

**DoD:** publicar/simular matéria com keyword → notificação em &lt; 30 min (ou imediato no job).

**Fora:** app mobile, 10 canais, ML de relevância.

**Env (Easypanel `web`)**
- `N8N_ALERT_WEBHOOK` — URL de produção do webhook n8n
- `ALERT_WHATSAPP_TO` — opcional (ex.: `5581999999999`)
- `ALERT_EVOLUTION_INSTANCE` — opcional (nome da instância Evolution)

---

## Cadência

1. Começa sprint → só os itens do sprint  
2. Termina → DoD verde → commit  
3. Demo de 5 min → próximo  

Sem misturar “já vamos pro Brasil” no meio do MVP PE.
