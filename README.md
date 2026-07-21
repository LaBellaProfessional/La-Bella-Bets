# BELLA BETS

Dash de análise pré-jogo com método. Uso próprio, 100% local, sem deploy.

## Como rodar

```bash
npm install          # só na primeira vez

npm run analisar                 # analisa HOJE e grava data/analises/AAAA-MM-DD.json
npm run analisar -- 2026-07-25   # analisa outra data
npm run analisar -- --demo       # força modo demo mesmo com chaves

npm run dev          # abre o dash (lê e grava em /data)
```

O dash **precisa do `npm run dev`**: é o dev server que lê e escreve os JSONs de `/data`.
Sem backend, sem banco, sem nuvem — a pasta `/data` é a fonte da verdade.

## Chaves de API

Copie `.env.example` para `.env` e preencha:

```
API_FOOTBALL_KEY=...   # api-sports.io — fixtures, resultados, H2H
ODDS_API_KEY=...       # the-odds-api.com — odds
```

Sem chaves, o motor roda em **modo demo** com dados simulados determinísticos (mesma data ⇒
mesmo resultado). O dash mostra aviso âmbar; nada de demo se confunde com jogo real.

## Estrutura

```
motor/
  analisar.js        CLI: fixtures → histórico → heurística → Dixon-Coles → filtros → bilhetes
  lib/
    heuristica.js    método manual formalizado (mando 50% / geral 30% / H2H 20%)
    dixonColes.js    Poisson bivariado + correção de placares baixos + decay temporal
    filtros.js       validação de perna (odd, EV, concordância, amostra, travas de sanidade)
    montador.js      combinações, correlação intra-jogo, independência, teto de exposição
    fontes.js        APIs + cache + modo demo
    tipos.js         vocabulário único (mercados, motivos de descarte)
data/
  config.json        banca, stakes, filtros, pesos, ligas  ← editável pelo dash
  bilhetes.json      registro de todo bilhete + resultado
  analises/          uma análise por dia, com o config_efetivo que a produziu
  historico_times.json  cache de jogos encerrados (não muda, busca 1x)
src/                 dash React: Hoje · Análises · Histórico · Config
```

## O método em uma tela

- **Heurística:** taxa histórica do mercado em 3 blocos (mando 50%, geral 30%, H2H 20%;
  sem H2H redistribui 60/40). Amostra curta reduz confiança, nunca inventa dado.
- **Dixon-Coles:** ajusta ataque/defesa por time e vantagem de mando por liga, gera matriz de
  placares 0×0 a 6×6, e dela derivam todos os mercados. Liga sem amostra ⇒ o modelo se declara
  indisponível e o sistema opera só com heurística, com confiança rebaixada.
- **Filtros:** odd ≥ 1.20 · EV ≥ +3% · modelos concordando (≤10 p.p.) · ≥7 jogos no mando.
  Mais duas travas de sanidade: handicap sem Dixon-Coles é descartado (sem matriz vira chute),
  e EV acima de +35% é tratado como erro de modelo/odd defasada, não como oportunidade.
- **Bilhete:** odd combinada na faixa configurada, pernas não se repetem entre bilhetes,
  correlação intra-jogo calculada pela matriz (não por multiplicação), teto de exposição diária.
- **Sem bilhete é resultado válido.** A tela diz o motivo e a aba Análises mostra por que cada
  perna caiu.

## ⚠️ Achado sobre os parâmetros (ler antes de usar pra valer)

Com os valores originais — **perna ≥ 1.20** e **bilhete entre 1.40 e 1.60** — a faixa útil por
perna é 1.20 a 1.33. Odd de dupla chance costuma ficar acima disso, então o sistema quase sempre
devolve SEM BILHETE (6 de 6 dias no demo).

E a regra "3 pernas se forem de odd muito baixa" é **matematicamente impossível**: 1.20³ = 1.728,
acima do teto de 1.60. Ela nunca dispara.

Os dois números estão em `data/config.json` (`odd_bilhete_max`, `odd_minima_perna`) e são
editáveis pelo dash. Para referência, as análises de **24/07 e 26/07** foram geradas com
`odd_bilhete_max = 2.20` só pra demonstrar a tela de bilhete populada — cada análise grava o
`config_efetivo` que a produziu, e o dash mostra essa faixa no topo da aba Análises.
