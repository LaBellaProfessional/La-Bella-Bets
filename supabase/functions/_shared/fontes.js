/**
 * PORTE DENO — identico ao motor local, menos o cache em disco:
 * na nuvem o cache vem das tabelas historico_* e e passado como objeto.
 *
 * FONTES DE DADOS — API-Football (fixtures/resultados/H2H) e The Odds API (odds).
 *
 * Sem chaves no .env o motor entra em MODO DEMO: dados mockados realistas, gerados de forma
 * determinística (mesma data ⇒ mesmo resultado), pra validar o fluxo inteiro antes das chaves.
 * O JSON gravado marca `modo: "demo"` — o dash mostra o aviso na tela, ninguém confunde
 * simulação com jogo real.
 *
 * Cache: histórico de jogo ENCERRADO nunca muda. Busca 1x e guarda em historico_times.json.
 * É o que segura o rate limit do tier gratuito.
 */

const API_FOOTBALL = 'https://v3.football.api-sports.io';
const ODDS_API = 'https://api.the-odds-api.com/v4';

/** Aceita os dois nomes de variável (API_FOOTBALL_KEY e APIFOOTBALL_KEY). */
/** Env cross-runtime: Deno.env na edge, process.env no Node. Mesmo codigo nos dois lados. */
 const env = (k) => {
   try { if (typeof Deno !== 'undefined') return Deno.env.get(k) ?? ''; } catch { /* Node */ }
   return (globalThis.process?.env?.[k]) ?? '';
 };
 export const chaveFootball = () => env('API_FOOTBALL_KEY') || env('APIFOOTBALL_KEY');
export const chaveOdds = () => env('ODDS_API_KEY');

export function temChaves() {
  return Boolean(chaveFootball() && chaveOdds());
}

/** Contador de requisições da rodada — o tier gratuito é 100/dia, não dá pra gastar à toa. */
export const cota = { football: 0, odds: 0 };

/* ─────────── API REAL ───────────────────────── */

async function apiFootball(rota, params) {
  const url = new URL(API_FOOTBALL + rota);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url, { headers: { 'x-apisports-key': chaveFootball() } });
  cota.football++;
  if (!r.ok) throw new Error(`API-Football ${r.status} em ${rota}`);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(`API-Football: ${JSON.stringify(j.errors)}`);
  return j.response ?? [];
}

/**
 * Jogos do dia em UMA requisição.
 *
 * O plano Free rejeita `season` de temporada corrente ("Free plans do not have access to this
 * season") e exige `season` quando se filtra por `league`. A saída: pedir só por `date` — o Free
 * libera uma janela de ~3 dias em torno de hoje — e filtrar as ligas aqui. De quebra economiza
 * 9 requisições por rodada (eram 10, uma por liga; o teto do plano é 100/dia).
 */
export async function buscarJogosDoDia(ligasAtivas, data) {
  const porId = new Map(ligasAtivas.map((l) => [l.id, l]));
  const resp = await apiFootball('/fixtures', { date: data });
  const jogos = [];
  for (const f of resp) {
    const liga = porId.get(f.league?.id);
    if (!liga) continue;
    jogos.push({
      id: String(f.fixture.id),
      liga: liga.nome,
      liga_id: liga.id,
      data,
      hora: new Date(f.fixture.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      casa: f.teams.home.name,
      fora: f.teams.away.name,
      // Sem os ids não dá pra buscar histórico — era o furo do caminho real.
      casa_id: f.teams.home.id,
      fora_id: f.teams.away.id,
      // Horário de início: é a segunda prova no casamento com a odd (nome + horário).
      inicio: f.fixture.date,
    });
  }
  return jogos;
}

/** Limitações do plano detectadas na rodada — viram diagnóstico no fim, não exceção. */
export const limitacoesPlano = new Set();

export async function buscarHistoricoTime(timeId, nome, cache) {
  if (cache.times[nome]) return cache.times[nome];
  if (!timeId) return [];
  // Se o plano já barrou uma vez, barra todas: insistir só queima cota (são 100/dia).
  if (limitacoesPlano.size) return [];
  let resp;
  try {
    // `last` é bloqueado no plano Free. Sem ele não há "últimos 10 jogos" — que é a base do
    // método. Em vez de derrubar a rodada inteira, registra a limitação e segue sem histórico:
    // o sistema então não aprova perna nenhuma, que é o comportamento correto (sem dado, sem apostar).
    resp = await apiFootball('/fixtures', { team: timeId, last: 20, status: 'FT' });
  } catch (e) {
    if (/Free plans|not have access/i.test(e.message)) {
      limitacoesPlano.add(e.message.replace(/^API-Football:\s*/, ''));
      cache.times[nome] = [];
      return [];
    }
    throw e;
  }
  const jogos = resp.map((f) => ({
    data: f.fixture.date.slice(0, 10),
    casa: f.teams.home.name,
    fora: f.teams.away.name,
    gols_casa: f.goals.home ?? 0,
    gols_fora: f.goals.away ?? 0,
  }));
  cache.times[nome] = jogos;
  return jogos;
}

/** Sport keys da The Odds API por liga da API-Football (o que o tier gratuito cobre). */
export const SPORT_KEY_POR_LIGA = {
  71: 'soccer_brazil_campeonato',
  72: 'soccer_brazil_serie_b',
  11: 'soccer_conmebol_sudamericana',
  13: 'soccer_conmebol_libertadores',
  2: 'soccer_uefa_champs_league',
  39: 'soccer_epl',
  140: 'soccer_spain_la_liga',
  78: 'soccer_germany_bundesliga',
  61: 'soccer_france_ligue_one',
  98: 'soccer_japan_j_league',
};

/** Palavras que as duas fontes escrevem de jeitos diferentes e não distinguem clube nenhum. */
const GENERICO = new Set([
  'FC','CF','EC','SC','AC','CA','CD','SE','AA','CR','SAF','FBPA','AFC','SAD',
  'FUTEBOL','CLUBE','CLUB','ESPORTE','ESPORTIVO','REGATAS','ASSOCIACAO','SOCIEDADE',
  'DE','DO','DA','DOS','DAS','E','THE',
]);

/** Estado: quando aparece dos DOIS lados e difere, são clubes diferentes (Atlético-MG ≠ -GO). */
const UFS = new Set(['MG','SP','RJ','RS','PR','SC','BA','CE','PE','GO','MT','MS','PA','AM','DF','AL','PB','RN','PI','MA','TO','RO','AC','AP','RR','ES']);

/** Apelido ↔ forma longa. Sem isso "Atlético-MG" nunca casaria com "Atletico Mineiro". */
const APELIDO = {
  MINEIRO: 'MG', PAULISTA: 'SP', PARANAENSE: 'PR', GOIANIENSE: 'GO', GAUCHO: 'RS',
  CATARINENSE: 'SC', CEARENSE: 'CE', BAIANO: 'BA', MINEIRA: 'MG',
  RB: 'REDBULL', REDBULL: 'REDBULL',
};

const tokens = (s) =>
  (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')      // tira acento: Atlético → Atletico
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    // Grafias que variam entre as fontes e quebram o casamento por token:
    .replace(/\bATHLETICO\b/g, 'ATLETICO')   // Athletico Paranaense x Atlético Paranaense
    .replace(/\bRED BULL\b/g, 'REDBULL')     // Red Bull Bragantino x RB Bragantino
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((t) => APELIDO[t] ?? t)
    .filter((t) => !GENERICO.has(t));

const partesDe = (s) => {
  const ts = tokens(s);
  return {
    uf: new Set(ts.filter((t) => UFS.has(t))),
    nucleo: new Set(ts.filter((t) => !UFS.has(t))),
  };
};

const mesmoConjunto = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Casa o nome do time da API-Football com o da The Odds API.
 *
 * Regra ESTRITA de propósito: núcleo idêntico (depois de tirar acento, genéricos e traduzir
 * apelido) e estado compatível. Nada de "um contém o outro" — era isso que fazia
 * "São Paulo" casar com "São Paulo Crystal" e "Botafogo" com "Botafogo-SP".
 *
 * O custo de errar é assimétrico: não casar deixa a perna sem odd (é descartada, ninguém aposta);
 * casar errado põe a odd de um jogo no outro e vira aposta baseada em número falso. Na dúvida,
 * não casa.
 */
function mesmoTime(a, b) {
  const A = partesDe(a), B = partesDe(b);
  if (!A.nucleo.size || !B.nucleo.size) return false;
  if (!mesmoConjunto(A.nucleo, B.nucleo)) return false;
  // Estado: se os dois declaram, tem que ser o mesmo. Se só um declara, é ambíguo
  // (Botafogo x Botafogo-SP) — recusa, e a unicidade do lado do chamador ainda protege.
  if (A.uf.size && B.uf.size) return mesmoConjunto(A.uf, B.uf);
  return A.uf.size === B.uf.size;
}

/**
 * Casamento FROUXO: um nome contém o outro inteiro ("Novorizontino" ⊂ "Grêmio Novorizontino").
 * Só pode ser usado junto da prova de horário — sozinho gera falso positivo.
 */
function contido(a, b) {
  const A = partesDe(a), B = partesDe(b);
  if (!A.nucleo.size || !B.nucleo.size) return false;
  if (A.uf.size && B.uf.size && !mesmoConjunto(A.uf, B.uf)) return false;
  const menor = A.nucleo.size <= B.nucleo.size ? A.nucleo : B.nucleo;
  const maior = A.nucleo.size <= B.nucleo.size ? B.nucleo : A.nucleo;
  return [...menor].every((t) => maior.has(t));
}

/** Melhor odd (maior) entre as casas, por mercado. */
function melhorOdd(bookmakers, mercadoKey, nomeResultado, ponto) {
  let melhor = null;
  for (const bk of bookmakers ?? []) {
    for (const mk of bk.markets ?? []) {
      if (mk.key !== mercadoKey) continue;
      for (const o of mk.outcomes ?? []) {
        if (ponto != null && Number(o.point) !== ponto) continue;
        if (!mesmoTime(o.name, nomeResultado) && o.name !== nomeResultado) continue;
        if (melhor == null || o.price > melhor) melhor = o.price;
      }
    }
  }
  return melhor;
}

/**
 * Odds por jogo, já traduzidas pros mercados do método.
 * Dupla chance não é oferecida direto: deriva do 1X2 removendo o overround
 * (DC = 1 / (p_norm_a + p_norm_b)). É a conversão padrão.
 */
export async function buscarOddsDosJogos(jogos) {
  const porLiga = new Map();
  for (const j of jogos) {
    const key = SPORT_KEY_POR_LIGA[j.liga_id];
    if (!key) continue;
    if (!porLiga.has(key)) porLiga.set(key, []);
    porLiga.get(key).push(j);
  }

  const odds = {};
  const diagnostico = [];
  for (const [sportKey, doGrupo] of porLiga) {
    const url = new URL(`${ODDS_API}/sports/${sportKey}/odds`);
    url.searchParams.set('apiKey', chaveOdds());
    url.searchParams.set('regions', 'eu,us');
    url.searchParams.set('markets', 'h2h,totals');
    url.searchParams.set('oddsFormat', 'decimal');
    let eventos = [];
    try {
      const r = await fetch(url);
      cota.odds++;
      if (!r.ok) { diagnostico.push(`${sportKey}: HTTP ${r.status}`); continue; }
      eventos = await r.json();
    } catch (e) {
      diagnostico.push(`${sportKey}: ${e.message}`);
      continue;
    }

    for (const j of doGrupo) {
      // 1ª tentativa: casamento ESTRITO por nome (núcleo idêntico + estado compatível).
      let candidatos = eventos.filter(
        (e) => mesmoTime(e.home_team, j.casa) && mesmoTime(e.away_team, j.fora)
      );

      // 2ª tentativa: nome FROUXO (um contém o outro) + HORÁRIO batendo em até 3h.
      // Sozinho, o nome frouxo casaria "São Paulo" com "São Paulo Crystal". Exigindo os DOIS
      // times E o horário de início, a chance de colisão vira desprezível — e é o que resgata
      // casos legítimos como "Novorizontino" x "Grêmio Novorizontino".
      if (!candidatos.length && j.inicio) {
        const tJogo = new Date(j.inicio).getTime();
        candidatos = eventos.filter((e) => {
          if (!e.commence_time) return false;
          const dif = Math.abs(new Date(e.commence_time).getTime() - tJogo);
          if (dif > 3 * 3600 * 1000) return false;
          return contido(e.home_team, j.casa) && contido(e.away_team, j.fora);
        });
        if (candidatos.length === 1) {
          diagnostico.push(`casado por nome+horário: "${j.casa} x ${j.fora}" ≈ "${candidatos[0].home_team} x ${candidatos[0].away_team}"`);
        }
      }
      // Unicidade: 2 eventos casando com a mesma partida significa que o casamento não é
      // confiável. Preferir ficar sem odd (perna descartada) a arriscar a odd do jogo errado.
      if (candidatos.length > 1) {
        diagnostico.push(`ambíguo (${candidatos.length} eventos): ${j.casa} x ${j.fora} — sem odd por segurança`);
        continue;
      }
      const ev = candidatos[0];
      if (!ev) { diagnostico.push(`sem odds: ${j.casa} x ${j.fora}`); continue; }

      const oCasa = melhorOdd(ev.bookmakers, 'h2h', ev.home_team);
      const oFora = melhorOdd(ev.bookmakers, 'h2h', ev.away_team);
      const oEmp = melhorOdd(ev.bookmakers, 'h2h', 'Draw');
      const dc = (a, b) => {
        if (!a || !b) return null;
        const soma = 1 / a + 1 / b;
        return soma > 0 ? +(1 / soma).toFixed(2) : null;
      };
      odds[j.id] = {
        dupla_chance_casa: dc(oCasa, oEmp),
        dupla_chance_fora: dc(oFora, oEmp),
        over_05: melhorOdd(ev.bookmakers, 'totals', 'Over', 0.5),
        over_15: melhorOdd(ev.bookmakers, 'totals', 'Over', 1.5),
        under_45: melhorOdd(ev.bookmakers, 'totals', 'Under', 4.5),
        // Handicap asiático não vem no tier gratuito: fica null e a perna é descartada
        // com "sem odd" — honesto, em vez de inventar preço.
        ah_casa_m05: null, ah_casa_m10: null, ah_fora_p05: null,
      };
    }
  }
  return { odds, diagnostico };
}

/* ───────────────────────── MODO DEMO ───────────────────────── */

/** PRNG determinístico: mesma semente ⇒ mesma sequência (demo reproduzível). */
function rng(semente) {
  let s = [...String(semente)].reduce((a, c) => a + c.charCodeAt(0), 0) || 1;
  return () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
}

const TIMES_DEMO = {
  'Brasileirão Série A': [
    ['Palmeiras', 1.85, 0.85], ['Flamengo', 1.9, 0.9], ['Botafogo', 1.6, 0.95],
    ['São Paulo', 1.45, 1.0], ['Fortaleza', 1.3, 1.05], ['Vitória', 1.05, 1.45],
    ['Cuiabá', 0.95, 1.4], ['Juventude', 1.0, 1.35],
  ],
  'Brasileirão Série B': [
    ['Santos', 1.7, 0.95], ['Novorizontino', 1.35, 1.0], ['Sport', 1.4, 1.05],
    ['Goiás', 1.3, 1.1], ['Paysandu', 0.95, 1.4], ['Guarani', 0.9, 1.45],
  ],
  'J-League': [
    ['Vissel Kobe', 1.75, 0.9], ['Sanfrecce Hiroshima', 1.65, 0.95], ['Machida Zelvia', 1.4, 1.0],
    ['Gamba Osaka', 1.35, 1.05], ['Kyoto Sanga', 1.1, 1.3], ['Albirex Niigata', 0.95, 1.45],
  ],
  'Copa Sul-Americana': [
    ['Independiente', 1.35, 1.05], ['Cruzeiro', 1.6, 0.95], ['Lanús', 1.3, 1.1], ['Racing', 1.5, 1.0],
  ],
};

/** Gera histórico plausível de um time a partir da força ataque/defesa. */
function historicoDemo(nome, atq, def, adversarios, rand, nJogos = 18) {
  const jogos = [];
  const hoje = new Date();
  for (let i = 0; i < nJogos; i++) {
    const adv = adversarios[Math.floor(rand() * adversarios.length)];
    if (adv[0] === nome) continue;
    const emCasa = rand() < 0.5;
    const lamPro = Math.max(0.2, (emCasa ? atq * 1.15 : atq) / Math.max(0.4, adv[2]));
    const lamCon = Math.max(0.2, (emCasa ? adv[1] : adv[1] * 1.15) / Math.max(0.4, def));
    const golsPro = amostraPoisson(lamPro, rand);
    const golsCon = amostraPoisson(lamCon, rand);
    const d = new Date(hoje); d.setDate(d.getDate() - (i * 6 + 3));
    jogos.push({
      data: d.toISOString().slice(0, 10),
      casa: emCasa ? nome : adv[0],
      fora: emCasa ? adv[0] : nome,
      gols_casa: emCasa ? golsPro : golsCon,
      gols_fora: emCasa ? golsCon : golsPro,
    });
  }
  return jogos;
}

/** Probabilidades "verdadeiras" do demo (Poisson simples) — base pra gerar odds plausíveis. */
function probsDemo(lamA, lamB) {
  const fat = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  const po = (k, l) => (Math.exp(-l) * Math.pow(l, k)) / fat(k);
  let casa = 0, emp = 0, fora = 0, casaPor2 = 0, o05 = 0, o15 = 0, u45 = 0;
  for (let x = 0; x <= 8; x++) {
    for (let y = 0; y <= 8; y++) {
      const p = po(x, lamA) * po(y, lamB), t = x + y, d = x - y;
      if (d > 0) casa += p; else if (d === 0) emp += p; else fora += p;
      if (d >= 2) casaPor2 += p;
      if (t >= 1) o05 += p;
      if (t >= 2) o15 += p;
      if (t <= 4) u45 += p;
    }
  }
  return {
    casa_vence: casa, empate: emp, fora_vence: fora, casa_por_2: casaPor2,
    dc_casa: casa + emp, dc_fora: fora + emp, over_05: o05, over_15: o15, under_45: u45,
  };
}

function amostraPoisson(lambda, rand) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L && k < 12);
  return k - 1;
}

/** Monta o dia inteiro em modo demo: jogos, históricos, H2H e odds coerentes. */
export function gerarDemo(data, ligasAtivas) {
  const rand = rng(data);
  const jogos = [];
  const historico = {};
  const h2h = {};
  const odds = {};

  const ligasDemo = ligasAtivas.filter((l) => TIMES_DEMO[l.nome]);
  for (const liga of ligasDemo) {
    const times = TIMES_DEMO[liga.nome];
    const usados = new Set();
    const nJogos = Math.min(3, Math.floor(times.length / 2));
    for (let i = 0; i < nJogos; i++) {
      let a, b;
      do { a = times[Math.floor(rand() * times.length)]; } while (usados.has(a[0]));
      do { b = times[Math.floor(rand() * times.length)]; } while (b[0] === a[0] || usados.has(b[0]));
      usados.add(a[0]); usados.add(b[0]);

      const id = `demo-${liga.id}-${i}`;
      const hora = `${String(15 + i * 2).padStart(2, '0')}:30`;
      jogos.push({ id, liga: liga.nome, liga_id: liga.id, data, hora, casa: a[0], fora: b[0] });

      if (!historico[a[0]]) historico[a[0]] = historicoDemo(a[0], a[1], a[2], times, rand);
      if (!historico[b[0]]) historico[b[0]] = historicoDemo(b[0], b[1], b[2], times, rand);

      // H2H: 0 a 3 confrontos (às vezes não existe — é caso real e o método trata).
      const nH2H = Math.floor(rand() * 4);
      h2h[id] = historicoDemo(a[0], a[1], a[2], [b], rand, nH2H);

      // Odds do demo: derivadas de um Poisson sobre as MESMAS forças que geraram o histórico,
      // com margem da casa (~6%) E um ruído por mercado (±10%). O ruído é essencial: sem ele
      // a odd sairia da mesma probabilidade do modelo e NENHUM mercado teria valor por
      // construção — o montador nunca seria exercitado. Casa de aposta real também erra preço;
      // é justamente esse desvio que o método caça.
      const lamA = Math.max(0.25, (a[1] * 1.15) / Math.max(0.4, b[2]));
      const lamB = Math.max(0.25, b[1] / Math.max(0.4, a[2]));
      const pv = probsDemo(lamA, lamB);
      const margem = 1.06;
      const comRuido = (p) => {
        const desvio = 0.9 + rand() * 0.2; // 0.90 a 1.10
        return +(1 / Math.min(0.98, Math.max(0.02, p * margem * desvio))).toFixed(2);
      };
      odds[id] = {
        dupla_chance_casa: comRuido(pv.dc_casa),
        dupla_chance_fora: comRuido(pv.dc_fora),
        over_05: comRuido(pv.over_05),
        over_15: comRuido(pv.over_15),
        under_45: comRuido(pv.under_45),
        ah_casa_m05: comRuido(pv.casa_vence),
        ah_casa_m10: comRuido(pv.casa_por_2),
        ah_fora_p05: comRuido(pv.dc_fora),
      };
    }
  }
  return { jogos, historico, h2h, odds };
}
