# Farol Imprensa

Monitoramento inteligente de notícias — produto **paralelo** ao Radar Imprensa Nordeste.

| Produto | Pergunta |
|---------|----------|
| **Radar** | *Quem* são os veículos certos? |
| **Farol** | *O que* está saindo — e *quando* preciso saber? |

## Sprints (MVP)

Ver [docs/SPRINTS.md](docs/SPRINTS.md) — sprints curtos.

| # | Nome | Status |
|---|------|--------|
| 1 | Fundação | feito |
| 2 | Ingestão PE | feito |
| 3 | Digest | feito |
| 4 | Temas | feito |
| 5 | Alertas | feito |
| 6 | Notify PWA | feito |

## Produção (Easypanel)

- **Projeto:** `farol-imprensa`
- **Serviços:** `web` + `postgres`
- **URL:** https://farol-imprensa-web.kxryyk.easypanel.host
- **Repo:** https://github.com/ftsmazzo/farol-imprensa

Health: `/api/health` · Meta: `/api/meta` · Digest: `/api/digest?uf=PE` · Push: `/api/push/vapid-public-key`

### Env alertas (Sprint 5)

```
N8N_ALERT_WEBHOOK=https://pazotti-n8n.kxryyk.easypanel.host/webhook/farol-alerta
ALERT_WHATSAPP_TO=5581XXXXXXXXX
ALERT_EVOLUTION_INSTANCE=nome-da-instancia
```

n8n: workflow **Farol — Alertas WhatsApp** (`jekJRVnX4nv02vZX`)

### Env Web Push (Sprint 6)

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:farol@fabria.ia
```

No celular o padrão é o **app consumidor** (só leitura).  
Painel da equipe: https://farol-imprensa-web.kxryyk.easypanel.host/?admin=1

Push no iPhone fica para uma etapa seguinte (Web Push no iOS exige app na Tela de Início + iOS 16.4+ e ainda é frágil).

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
