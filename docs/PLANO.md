# Farol Imprensa — Plano estratégico

**Data:** 2026-08-20  
**Relação:** paralelo ao Radar (ranking/contatos). Farol = monitoramento/clipping/alertas.

---

## 1. Nome

**Farol** — ilumina o que aparece no horizonte da imprensa.  
O Radar mapeia *veículos*; o Farol vigia *o que eles publicam*.

---

## 2. É possível?

**Sim.** O fluxo é clássico e maduro:

```
Fontes (RSS / sites / APIs)
    → coleta periódica
    → normalização (título, URL, veículo, UF, data)
    → classificação (tema, entidades, sentimento leve)
    → armazenamento
    → digest do dia + filtros
    → regras de alerta → n8n (WhatsApp / e-mail)
```

O Radar acelera a qualidade: já sabemos **quais veículos priorizar** (Top 20 UF, Top 10 capital, Top 5 grandes cidades). O Farol começa monitorando *esses*, não a internet inteira.

---

## 3. O que você quer fazer (mapa de valor)

| Necessidade | Como o Farol entrega |
|-------------|----------------------|
| Principais notícias do dia | Digest diário (manhã / tarde) ranqueado por relevância |
| Filtrar por tema | Tags + busca (política, saúde, cidade X…) |
| Alerta sobre pessoa/assunto | Regras: keywords, nomes, UF, veículo |
| Trabalhar a pauta | Lista acionável + link + veículo + contato (via Radar) |

Upsell natural depois: “saiu no Top 10 de Recife → disparar material” (Farol detecta, Radar dispara).

---

## 4. Arquitetura alvo (enxuta)

| Camada | Opção sugerida | Papel |
|--------|----------------|-------|
| Fontes | RSS dos Top do Radar + Google News RSS / Apify quando precisar | Coleta |
| Jobs | n8n schedule ou worker Node | Periodicidade |
| Store | Postgres (mesmo padrão Easypanel) | Notícias, tags, alertas |
| Classificação | regras + LLM leve (tema/entidades) | Qualidade do filtro |
| UI | Vite/React (irmã do Radar) | Digest, filtros, regras |
| Alertas | n8n → WhatsApp / e-mail | Entrega |

**Princípio:** monitorar poucos veículos certos > scrapear o Brasil inteiro.

---

## 5. Escopo geográfico (alinhado ao Radar)

Fase NE (igual ao recorte que fechamos):

1. Top 20 por UF  
2. Top 10 da capital  
3. Top 5 das 10 maiores cidades  

Só depois: outras regiões do Brasil (mesmas ondas do Radar).

---

## 6. Automação do desk / monitoramento

Não é o mesmo desk do ranking. Aqui a automação é de **clipping contínuo**:

1. **Ingestão** a cada 30–60 min nos feeds priorizados  
2. **Dedup** por URL/título  
3. **Classificador** (tema + nomes citados)  
4. **Motor de alertas** (match em regras ativas)  
5. **Digest** gerado 1–2×/dia (resumo + links)  
6. **Humano no loop** só para calibrar temas e falsos positivos na 1ª semana  

Saída sempre estruturada (JSON/Postgres) — nunca só PDF solto.

---

## 7. Escalada Brasil (assertiva)

| Onda | O quê | Gate de qualidade |
|------|--------|-------------------|
| 0 | NE + Farol MVP | Digest útil + 3 alertas piloto |
| 1 | Sudeste | Inventário Radar da região + feeds estáveis |
| 2 | Sul | Idem |
| 3 | Centro-Oeste + DF | Idem |
| 4 | Norte | Idem |

Gate: &lt;20% falso positivo nos alertas piloto antes de abrir próxima onda.

---

## 8. Riscos

| Risco | Mitigação |
|-------|-----------|
| Site sem RSS | Apify/scrape só Top; não generalizar |
| Ruído em alertas | Keywords compostas + exclusões + UF |
| Volume | Priorizar veículos do Radar, não “tudo” |
| LGPD / uso de clipping | Uso interno de assessoria; retenção limitada |

---

## 9. Próximo passo sugerido

1. Congelar MVP ([MVP.md](MVP.md))  
2. Escolher 1 UF piloto (ex.: PE) + Top veículos do Radar  
3. Subir ingestão RSS + tabela `articles`  
4. Digest do dia no painel  
5. 1 alerta piloto (pessoa ou tema do cliente) via n8n  
