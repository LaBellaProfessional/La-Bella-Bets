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

## Camada de analistas (canais do YouTube)

O contexto que a máquina não vê — desfalque, escalação, moral, o palpite do canal — entra pelo
pipeline de ingestão e é **medido como todos os outros**: cada analista tem placar próprio, cada
palpite liquida contra o placar real, e o peso (2–15) recalibra sozinho a cada 30 palpites. Nada
empurra a nota pra confiança máxima; a dúvida freia mais que o entusiasmo empurra.

**Migrações (rodar no SQL editor do Supabase, uma vez):** `supabase/migracao-analistas.sql`
(tabelas + view + seed dos 4 canais), `supabase/migracao-faro.sql` (Parte B/1), `supabase/
migracao-conciliacao.sql` (Parte 2).

### Pipeline automático — roda no PC (Task Scheduler)

O YouTube bloqueia scraping de IP de datacenter (consent/captcha), então a ingestão roda no PC do
Maikon, com IP residencial:

```bash
npm run ingerir-analistas              # todos os canais ativos
npm run ingerir-analistas -- @freitastipster   # um canal só
```

Por canal ativo: resolve o `channel_id` do @handle → lê o RSS (sem API key) → baixa a transcrição
(timedtext; sem legenda = marca e segue) → extrai com a **API Anthropic (Haiku)** em JSON
estruturado (separa fato/opinião/dado citado, categoriza, quebra bilhete múltiplo em palpites,
traduz o formato do Freitas: bloco **MENOR** = convicção alta, **MAIOR** = média) → grava em
`analista_conteudos` + `analista_extracoes` com o **custo por execução logado**. Falha de extração
nunca derruba o pipeline.

**Pré-requisito:** `ANTHROPIC_API_KEY` no `.env`. Sem a chave, o pipeline faz tudo até a extração e
para ali (transcrição salva); preencha a chave e rode de novo.

**Custo:** modelo `claude-haiku-4-5` (US$ 1 / 5 por 1M tokens in/out). Um vídeo de ~14k tokens de
transcrição custa da ordem de US$ 0,01–0,03. Com 4 canais, 1 vídeo/dia, 2 runs/dia, a projeção é de
poucos dólares/mês — o próprio script imprime o custo do run e uma projeção ao final.

**Agendar 2x/dia** (~8h e ~17h) no Windows Task Scheduler:

1. Task Scheduler → *Create Task* → *Triggers*: New → Daily → 08:00; repita pra 17:00.
2. *Actions*: New → Program `node` → Arguments `scripts/ingerir-analistas.mjs` → *Start in* a raiz
   do projeto (`C:\Users\Cliente\Desktop\bella-bets`).
3. *Conditions*: desmarque "só com energia da tomada" se for notebook.

### Bootstrap manual (ponte até a chave chegar)

Enquanto a `ANTHROPIC_API_KEY` não libera, dá pra validar a cadeia inteira processando o conteúdo à
mão no **mesmo formato** do extrator, marcado `processado_por='manual_bootstrap'` (aparece com o selo
"manual" no card):

```bash
cp data/analistas-manual.exemplo.json data/analistas-manual.json   # edite com o conteúdo real
npm run bootstrap-analistas                                        # insere as extrações
npm run analisar                                                   # o motor casa por partida
```

O `.exemplo.json` documenta o formato exato (fato consensual → alerta laranja, MENOR/MAIOR, bilhete
quebrado, mercado fora do motor). O `data/analistas-manual.json` real é gitignorado.

## Ferramentas

### `npm run medir-viewport -- <url> [largura] [altura]`

Caça elementos que estouram a largura da tela. Regra do projeto: **nunca scroll lateral no
mobile** — e "a tela rola pro lado" tem duas causas que parecem iguais no dedo e são
diferentes no código:

1. **a página rola** — `scrollWidth > clientWidth`, alguém estourou o body;
2. **um container interno rola** — a página está certa, mas há uma tabela de 520px dentro de
   um card de 358px com `overflow-x-auto`.

Foi o caso 2 que gerou o bug de 21/07 na aba Análises, e ler o CSS não respondia: só medindo.
O script mede as duas coisas e nomeia o elemento culpado. Roda Chrome headless via CDP puro —
sem puppeteer, sem playwright, sem instalar nada. Sai com código 1 quando acha problema.

```bash
npm run dev
npm run medir-viewport -- http://localhost:5173/ 390 844
```

```
{ "clientWidth": 390, "scrollWidth": 390, "rolaLateral": false,
  "culpados": [], "containersRolantes": [] }
✓ 390px: nada estoura a largura e nada rola na horizontal.
```

**Tela atrás de login:** o dash exige sessão, então medir a tela de login não prova nada sobre
as telas que têm conteúdo. Monte um harness — um `.tsx` que renderiza os componentes com um
payload real da tabela `analises` injetado em `window` — e aponte o script pra ele. Foi assim
que a tabela de 520px foi encontrada.
