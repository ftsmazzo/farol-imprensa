# Farol Imprensa

Monitoramento inteligente de notícias — produto **paralelo** ao Radar Imprensa Nordeste.

| Produto | Pergunta |
|---------|----------|
| **Radar** | *Quem* são os veículos certos? |
| **Farol** | *O que* está saindo — e *quando* preciso saber? |

## Sprints (MVP)

Ver [docs/SPRINTS.md](docs/SPRINTS.md) — 5 sprints curtos.

| # | Nome | Status |
|---|------|--------|
| 1 | Fundação | feito |
| 2 | Ingestão PE | feito |
| 3 | Digest | próximo |
| 4 | Temas | — |
| 5 | Alertas | — |

## Produção (Easypanel)

- **Projeto:** `farol-imprensa`
- **Serviços:** `web` + `postgres`
- **URL:** https://farol-imprensa-web.kxryyk.easypanel.host
- **Repo:** https://github.com/ftsmazzo/farol-imprensa

Health: `/api/health` · Meta: `/api/meta` · Digest: `/api/digest?uf=PE`

## Local (Sprint 1)

```bash
# API (porta 3100) — Postgres opcional no Sprint 1
cd server && npm install
# opcional: copy ../.env.example → ../.env e exporte DATABASE_URL
npm run dev

# Painel (porta 5174, proxy /api → 3100)
cd web && npm install && npm run dev
```

Health: `http://localhost:3100/api/health`  
Meta: `http://localhost:3100/api/meta`

## Docs

- [docs/PLANO.md](docs/PLANO.md)
- [docs/MVP.md](docs/MVP.md)
- [docs/SPRINTS.md](docs/SPRINTS.md)
