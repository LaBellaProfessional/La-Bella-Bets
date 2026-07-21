/**
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
import fs from 'node:fs';
import path from 'node:path';

const API_FOOTBALL = 'https://v3.football.api-sports.io';
const ODDS_API = 'https://api.the-odds-api.com/v4';

export function temChaves() {
  return Boolean(process.env.API_FOOTBALL_KEY && process.env.ODDS_API_KEY);
}

/* ───────────────────────── CACHE ───────────────────────── */

export function lerCache(caminho) {
  try { return JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch { return { times: {}, h2h: {} }; }
}
export function gravarCache(caminho, cache) {
  fs.mkdirSync(path.dirname(caminho), { recursive: true });
  fs.writeFileSync(caminho, JSON.stringify(cache, null, 2));
}

/* ───────────────────────── API REAL ───────────────────────── */

async function apiFootball(rota, params) {
  const url = new URL(API_FOOTBALL + rota);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY } });
  if (!r.ok) throw new Error(`API-Football ${r.status} em ${rota}`);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(`API-Football: ${JSON.stringify(j.errors)}`);
  return j.response ?? [];
}

export async function buscarJogosDoDia(ligasAtivas, data) {
  const jogos = [];
  for (const liga of ligasAtivas) {
    const resp = await apiFootball('/fixtures', { league: liga.id, date: data, season: new Date(data).getFullYear() });
    for (const f of resp) {
      jogos.push({
        id: String(f.fixture.id),
        liga: liga.nome,
        liga_id: liga.id,
        data,
        hora: new Date(f.fixture.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        casa: f.teams.home.name,
        fora: f.teams.away.name,
      });
    }
  }
  return jogos;
}

export async function buscarHistoricoTime(timeId, nome, cache) {
  if (cache.times[nome]) return cache.times[nome];
  const resp = await apiFootball('/fixtures', { team: timeId, last: 20, status: 'FT' });
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

export async function buscarOdds(esporteKey = 'soccer') {
  const url = new URL(`${ODDS_API}/sports/${esporteKey}/odds`);
  url.searchParams.set('apiKey', process.env.ODDS_API_KEY);
  url.searchParams.set('regions', 'eu');
  url.searchParams.set('markets', 'h2h,totals');
  url.searchParams.set('oddsFormat', 'decimal');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`The Odds API ${r.status}`);
  return r.json();
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
