# Farol — MVP

## Objetivo da 1ª entrega

Em **uma UF piloto** (sugestão: PE):

1. Coletar notícias dos veículos prioritários do Radar  
2. Mostrar **digest do dia** (lista + link + veículo + hora)  
3. Filtrar por **tema** e busca livre  
4. Criar **1–3 alertas** (pessoa ou assunto) com notificação (e-mail ou WhatsApp via n8n)

## Fora do MVP

- Brasil inteiro  
- Sentiment analysis pesado  
- App mobile  
- Substituição de clipping humano 100%  

## Critério de sucesso

- Digest disponível todo dia útil antes das 9h  
- Alerta chega em &lt; 30 min após publicação detectada  
- Cliente consegue filtrar por tema sem planilha  

## Stack sugerida (espelho do Radar)

- `web/` — painel  
- `server/` — API + Postgres  
- `n8n/` — schedule + alertas  
- Fontes — RSS primeiro; Apify só se faltar feed  
