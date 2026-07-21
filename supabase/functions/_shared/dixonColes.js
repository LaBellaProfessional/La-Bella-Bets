/**
 * PARTE 2 — DIXON-COLES (Poisson bivariado com correção de placares baixos + decay temporal).
 *
 * Ajusta ataque/defesa por time e vantagem de mando por liga, maximizando a log-verossimilhança
 * ponderada por tempo (jogo velho pesa menos: w = exp(-xi * dias)).
 *
 * A correção tau de Dixon-Coles conserta o que o Poisson simples erra: 0x0, 1x0, 0x1 e 1x1
 * acontecem mais (e empates 1x1 menos) do que a independência prevê.
 *
 * Se a liga não tiver amostra suficiente, o modelo se declara INDISPONÍVEL — o sistema opera
 * só com heurística e confiança rebaixada. Nunca fingir precisão.
 */

import { partesLinha } from './tipos.js';

const fatorial = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
const poisson = (k, lambda) => (Math.exp(-lambda) * Math.pow(lambda, k)) / fatorial(k);

/** Correção de Dixon-Coles para os quatro placares baixos. */
function tau(x, y, lambda, mu, rho) {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

/**
 * Ajusta o modelo para uma liga.
 * @returns {{disponivel:boolean, motivo?:string, ataque:object, defesa:object, mando:number, rho:number, n_jogos:number}}
 */
export function ajustarDixonColes(jogos, { xi = 0.0065, minJogos = 60, hoje = new Date() } = {}) {
  if (!jogos || jogos.length < minJogos) {
    return {
      disponivel: false,
      motivo: `amostra da liga insuficiente: ${jogos?.length ?? 0} jogos (mínimo ${minJogos})`,
      n_jogos: jogos?.length ?? 0,
    };
  }

  const times = [...new Set(jogos.flatMap((j) => [j.casa, j.fora]))];
  const idx = Object.fromEntries(times.map((t, i) => [t, i]));
  const n = times.length;

  // Peso temporal por jogo.
  const pesos = jogos.map((j) => {
    const dias = Math.max(0, (hoje - new Date(j.data)) / 86400000);
    return Math.exp(-xi * dias);
  });

  // Parâmetros: ataque[n], defesa[n], mando, rho.
  let ataque = new Array(n).fill(0);
  let defesa = new Array(n).fill(0);
  let mando = 0.25;
  let rho = -0.05;

  const lambdas = (p, j) => {
    const i = idx[j.casa], k = idx[j.fora];
    const lam = Math.exp(p.ataque[i] - p.defesa[k] + p.mando);
    const mu = Math.exp(p.ataque[k] - p.defesa[i]);
    return [Math.max(0.05, Math.min(8, lam)), Math.max(0.05, Math.min(8, mu))];
  };

  const logVero = (p) => {
    let ll = 0;
    for (let m = 0; m < jogos.length; m++) {
      const j = jogos[m];
      const [lam, mu] = lambdas(p, j);
      const t = tau(j.gols_casa, j.gols_fora, lam, mu, p.rho);
      const pj = Math.max(1e-12, t) * poisson(j.gols_casa, lam) * poisson(j.gols_fora, mu);
      ll += pesos[m] * Math.log(Math.max(1e-12, pj));
    }
    return ll;
  };

  // Subida de gradiente numérica: simples, estável e suficiente pro tamanho do problema
  // (dezenas de times, centenas de jogos). Sem dependência externa.
  const passo = 0.05;
  const h = 1e-4;
  let p = { ataque, defesa, mando, rho };
  let melhor = logVero(p);

  for (let iter = 0; iter < 120; iter++) {
    const grad = { ataque: new Array(n).fill(0), defesa: new Array(n).fill(0), mando: 0, rho: 0 };
    for (let i = 0; i < n; i++) {
      const pa = { ...p, ataque: [...p.ataque] }; pa.ataque[i] += h;
      grad.ataque[i] = (logVero(pa) - melhor) / h;
      const pd = { ...p, defesa: [...p.defesa] }; pd.defesa[i] += h;
      grad.defesa[i] = (logVero(pd) - melhor) / h;
    }
    grad.mando = (logVero({ ...p, mando: p.mando + h }) - melhor) / h;
    grad.rho = (logVero({ ...p, rho: p.rho + h }) - melhor) / h;

    const norma = Math.sqrt(
      grad.ataque.reduce((s, v) => s + v * v, 0) +
      grad.defesa.reduce((s, v) => s + v * v, 0) +
      grad.mando ** 2 + grad.rho ** 2
    ) || 1;

    const novo = {
      ataque: p.ataque.map((v, i) => v + (passo * grad.ataque[i]) / norma),
      defesa: p.defesa.map((v, i) => v + (passo * grad.defesa[i]) / norma),
      mando: p.mando + (passo * grad.mando) / norma,
      rho: Math.max(-0.2, Math.min(0.2, p.rho + (passo * grad.rho) / norma)),
    };
    // Identificabilidade: ataque médio = 0 (senão ataque e defesa deslizam juntos sem fim).
    const mediaAtq = novo.ataque.reduce((s, v) => s + v, 0) / n;
    novo.ataque = novo.ataque.map((v) => v - mediaAtq);

    const ll = logVero(novo);
    if (ll <= melhor + 1e-7) { p = novo; melhor = ll; break; }
    p = novo; melhor = ll;
  }

  return {
    disponivel: true,
    ataque: Object.fromEntries(times.map((t) => [t, p.ataque[idx[t]]])),
    defesa: Object.fromEntries(times.map((t) => [t, p.defesa[idx[t]]])),
    mando: p.mando,
    rho: p.rho,
    n_jogos: jogos.length,
    log_verossimilhanca: melhor,
  };
}

/** Matriz de probabilidade de placares 0..maxGols (última linha/coluna acumula a cauda). */
export function matrizPlacares(modelo, casa, fora, maxGols = 6) {
  if (!modelo?.disponivel) return null;
  if (!(casa in modelo.ataque) || !(fora in modelo.ataque)) return null;

  const lam = Math.exp(modelo.ataque[casa] - modelo.defesa[fora] + modelo.mando);
  const mu = Math.exp(modelo.ataque[fora] - modelo.defesa[casa]);

  const m = [];
  let soma = 0;
  for (let x = 0; x <= maxGols; x++) {
    m[x] = [];
    for (let y = 0; y <= maxGols; y++) {
      const p = tau(x, y, lam, mu, modelo.rho) * poisson(x, lam) * poisson(y, mu);
      m[x][y] = Math.max(0, p);
      soma += m[x][y];
    }
  }
  // Normaliza: a cauda acima de maxGols vira massa redistribuída.
  for (let x = 0; x <= maxGols; x++) for (let y = 0; y <= maxGols; y++) m[x][y] /= soma;
  return { matriz: m, lambda_casa: lam, lambda_fora: mu };
}

/** Probabilidade de cada mercado a partir da matriz de placares. */
export function mercadosDaMatriz(matriz) {
  if (!matriz) return null;
  const m = matriz.matriz;
  const N = m.length - 1;
  let casaVence = 0, empate = 0, foraVence = 0;
  let over05 = 0, over15 = 0, over25 = 0, under35 = 0, under45 = 0;
  let ahCasaM05 = 0, ahCasaM10 = 0, ahCasaM10Push = 0, ahForaP05 = 0;

  for (let x = 0; x <= N; x++) {
    for (let y = 0; y <= N; y++) {
      const p = m[x][y], t = x + y, d = x - y;
      if (d > 0) casaVence += p; else if (d === 0) empate += p; else foraVence += p;
      if (t >= 1) over05 += p;
      if (t >= 2) over15 += p;
      if (t >= 3) over25 += p;
      if (t <= 3) under35 += p;
      if (t <= 4) under45 += p;
      if (d > 0) ahCasaM05 += p;                       // casa -0.5 = casa vence
      if (d > 1) ahCasaM10 += p; else if (d === 1) ahCasaM10Push += p; // -1.0 devolve no 1 gol
      if (d >= 0) ahForaP05 += p;                      // fora +0.5 = fora não perde... (ver nota)
    }
  }
  // fora +0.5 vence quando o FORA não perde: d < 0 (fora vence) ou d === 0 (empate).
  ahForaP05 = foraVence + empate;

  return {
    casa_vence: casaVence, empate, fora_vence: foraVence,
    dupla_chance_casa: casaVence + empate,
    dupla_chance_fora: foraVence + empate,
    over_05: over05, over_15: over15, over_25: over25,
    under_35: under35, under_45: under45,
    ah_casa_m05: ahCasaM05,
    // Handicap -1.0 com devolução: prob efetiva = vitória por 2+ / (1 - prob de push).
    ah_casa_m10: ahCasaM10Push < 1 ? ahCasaM10 / (1 - ahCasaM10Push) : 0,
    ah_casa_m10_push: ahCasaM10Push,
    ah_fora_p05: ahForaP05,
  };
}

/**
 * Probabilidade de uma linha QUALQUER de over/under a partir da matriz.
 *
 * A The Odds API publica a linha que quiser (1.5, 2.0, 2.25, 2.5…) e o sistema só sabia
 * avaliar três linhas codificadas. Aqui a matriz de placares responde por qualquer
 * meia-linha — é o que transforma over/under de três constantes num mercado de verdade.
 */
export function probTotalDaMatriz(matriz, mercado) {
  const p = partesLinha(mercado);
  if (!matriz || !p || p.familia !== 'gols') return null;
  const m = matriz.matriz;
  const N = m.length - 1;
  let acc = 0;
  for (let x = 0; x <= N; x++)
    for (let y = 0; y <= N; y++) {
      const t = x + y;
      if (p.lado === 'over' ? t > p.linha : t < p.linha) acc += m[x][y];
    }
  return acc;
}

/**
 * Probabilidade CONJUNTA de duas pernas do mesmo jogo, direto da matriz.
 * É o que impede o erro clássico de multiplicar probabilidades correlacionadas
 * (ex.: "dupla chance casa" e "over 1.5" não são independentes).
 */
export function probConjuntaMesmoJogo(matriz, mercadoA, mercadoB) {
  if (!matriz) return null;
  const m = matriz.matriz;
  const N = m.length - 1;
  const bate = (mercado, x, y) => {
    const t = x + y, d = x - y;
    const linha = partesLinha(mercado);
    if (linha && linha.familia === 'gols') return linha.lado === 'over' ? t > linha.linha : t < linha.linha;
    switch (mercado) {
      case 'dupla_chance_casa': return d >= 0;
      case 'dupla_chance_fora': return d <= 0;
      default: return false;
    }
  };
  let p = 0;
  for (let x = 0; x <= N; x++)
    for (let y = 0; y <= N; y++)
      if (bate(mercadoA, x, y) && bate(mercadoB, x, y)) p += m[x][y];
  return p;
}
