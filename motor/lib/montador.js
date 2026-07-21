/**
 * PARTE 4 — MONTADOR DE BILHETE.
 *
 * Regras duras (o método é o produto; quantidade nunca dilui critério):
 *  - odd do bilhete entre 1.40 e 1.60
 *  - 1 perna quando ela sozinha já paga a faixa; 2 tipicamente; 3 só com odds muito baixas
 *  - uma perna NÃO se repete entre bilhetes (perder um jogo não derruba dois bilhetes)
 *  - teto de exposição diária de 8% da banca somando tudo
 *  - correlação intra-jogo sai da matriz de placares, não de multiplicação ingênua
 *  - nenhuma perna aprovada ⇒ SEM BILHETE HOJE (resultado válido e desejado)
 */
import { CONFIANCA } from './tipos.js';
import { probConjuntaMesmoJogo } from './dixonColes.js';

/** Combinações de tamanho k. */
function combinar(arr, k) {
  if (k === 1) return arr.map((a) => [a]);
  const out = [];
  arr.forEach((item, i) => {
    for (const resto of combinar(arr.slice(i + 1), k - 1)) out.push([item, ...resto]);
  });
  return out;
}

/** Probabilidade real do bilhete, respeitando correlação quando as pernas são do mesmo jogo. */
function probCombinada(pernas, matrizes) {
  const porJogo = new Map();
  for (const p of pernas) {
    if (!porJogo.has(p.jogo_id)) porJogo.set(p.jogo_id, []);
    porJogo.get(p.jogo_id).push(p);
  }
  let prob = 1;
  let correlacionadas = false;
  for (const [jogoId, doJogo] of porJogo) {
    if (doJogo.length === 1) { prob *= doJogo[0].prob_final; continue; }
    correlacionadas = true;
    // 2+ pernas do mesmo jogo: prob conjunta pela matriz. Sem matriz, cai no conservador
    // (a MENOR das probs) em vez de multiplicar — multiplicar subestimaria demais.
    const matriz = matrizes[jogoId];
    if (doJogo.length === 2 && matriz) {
      const conj = probConjuntaMesmoJogo(matriz, doJogo[0].mercado, doJogo[1].mercado);
      prob *= conj ?? Math.min(...doJogo.map((d) => d.prob_final));
    } else {
      prob *= Math.min(...doJogo.map((d) => d.prob_final));
    }
  }
  return { prob, correlacionadas };
}

export function montarBilhetes({ aprovadas, matrizes, config, banca }) {
  const f = config.filtros;
  const elegiveis = aprovadas.filter((p) => p.elegivel_bilhete);

  if (!elegiveis.length) {
    return {
      sem_bilhete: true,
      motivo: 'nenhuma perna passou nos filtros hoje',
      bilhetes: [],
      exposicao: { total_rs: 0, pct_banca: 0, teto_pct: config.teto_exposicao_diaria_pct },
    };
  }

  // Candidatos: SIMPLES, pares e trios dentro da faixa de odd.
  //
  // Simples (21/07): perna aprovada cuja odd sozinha já cai na faixa vira bilhete de 1 perna,
  // com os mesmos filtros e o mesmo stake. Faz sentido de risco: juntar duas pernas de 1.20
  // pra chegar em 1.44 entrega a MESMA odd de uma simples de 1.44, mas com o dobro de jogos
  // que podem dar errado. Quando a perna sozinha já paga a faixa, combinar só adiciona risco.
  const candidatos = [];
  for (const k of [1, 2, 3]) {
    for (const combo of combinar(elegiveis, k)) {
      const oddTotal = combo.reduce((s, p) => s * p.odd, 1);
      if (oddTotal < f.odd_bilhete_min || oddTotal > f.odd_bilhete_max) continue;
      // Trio só se as odds forem muito baixas — senão o par domina e o trio só adiciona risco.
      if (k === 3 && combo.some((p) => p.odd > 1.25)) continue;

      const { prob, correlacionadas } = probCombinada(combo, matrizes);
      const ev = prob * oddTotal;
      const nMaxima = combo.filter((p) => p.confianca === CONFIANCA.MAXIMA).length;
      const todasMaxima = nMaxima === combo.length;
      // Trava explícita: qualquer perna de amostra curta puxa o bilhete pro stake padrão,
      // mesmo que o resto pareça excelente.
      const temAmostraCurta = combo.some((p) => p.amostra_curta);
      const stakePct = todasMaxima && !temAmostraCurta ? config.stake_confianca_maxima_pct : config.stake_padrao_pct;

      candidatos.push({
        pernas: combo,
        n_pernas: combo.length,
        odd_total: oddTotal,
        prob_combinada: prob,
        valor_justo: 1 / prob,
        ev,
        ev_pct: (ev - 1) * 100,
        n_confianca_maxima: nMaxima,
        todas_confianca_maxima: todasMaxima,
        correlacao_intra_jogo: correlacionadas,
        tem_amostra_curta: temAmostraCurta,
        stake_pct: stakePct,
        stake_rs: +(banca * (stakePct / 100)).toFixed(2),
      });
    }
  }

  if (!candidatos.length) {
    return {
      sem_bilhete: true,
      motivo: `há ${elegiveis.length} perna(s) aprovada(s), mas nenhuma — sozinha ou combinada — fecha odd entre ${f.odd_bilhete_min} e ${f.odd_bilhete_max}`,
      bilhetes: [],
      exposicao: { total_rs: 0, pct_banca: 0, teto_pct: config.teto_exposicao_diaria_pct },
    };
  }

  // Ranking: mais pernas de confiança máxima → maior EV → maior prob.
  candidatos.sort(
    (a, b) =>
      b.n_confianca_maxima - a.n_confianca_maxima ||
      b.ev - a.ev ||
      b.prob_combinada - a.prob_combinada
  );

  // Seleção com independência: nenhuma perna se repete entre bilhetes.
  const escolhidos = [];
  const usadas = new Set();
  for (const c of candidatos) {
    if (escolhidos.length >= f.max_bilhetes_dia) break;
    const chaves = c.pernas.map((p) => `${p.jogo_id}|${p.mercado}`);
    if (chaves.some((k) => usadas.has(k))) continue;
    escolhidos.push(c);
    chaves.forEach((k) => usadas.add(k));
  }

  // Teto de exposição: corta o de menor EV até caber.
  const tetoRS = banca * (config.teto_exposicao_diaria_pct / 100);
  let cortados = [];
  let total = escolhidos.reduce((s, b) => s + b.stake_rs, 0);
  while (total > tetoRS && escolhidos.length > 1) {
    let piorIdx = 0;
    escolhidos.forEach((b, i) => { if (b.ev < escolhidos[piorIdx].ev) piorIdx = i; });
    cortados.push(escolhidos[piorIdx]);
    escolhidos.splice(piorIdx, 1);
    total = escolhidos.reduce((s, b) => s + b.stake_rs, 0);
  }

  return {
    sem_bilhete: false,
    bilhetes: escolhidos.map((b, i) => ({ ...b, ordem: i + 1 })),
    cortados_por_teto: cortados.length,
    exposicao: {
      total_rs: +total.toFixed(2),
      pct_banca: +((total / banca) * 100).toFixed(2),
      teto_pct: config.teto_exposicao_diaria_pct,
      teto_rs: +tetoRS.toFixed(2),
    },
  };
}

/**
 * Card de "alternativa em simples" pro handicap asiático.
 * AH nunca entra em bilhete combinado (restrição da casa) — mas quando o EV dele supera o da
 * dupla chance do MESMO jogo em ≥3 p.p., vira oportunidade sinalizada à parte.
 */
export function cardsHandicap({ todasPernas, config, banca }) {
  const f = config.filtros;
  const cards = [];
  const ahs = todasPernas.filter((p) => p.aprovada && p.mercado.startsWith('ah_'));

  for (const ah of ahs) {
    const dcMesmoJogo = todasPernas.filter(
      (p) => p.jogo_id === ah.jogo_id && p.aprovada && p.mercado.startsWith('dupla_chance')
    );
    const melhorDC = dcMesmoJogo.sort((a, b) => b.ev - a.ev)[0];
    const vantagem = ((ah.ev - (melhorDC?.ev ?? 1)) * 100);
    if (vantagem >= f.ah_vantagem_minima_pp) {
      cards.push({
        ...ah,
        vantagem_pp: +vantagem.toFixed(1),
        comparado_com: melhorDC ? { mercado: melhorDC.mercado, ev_pct: melhorDC.ev_pct } : null,
        stake_pct: config.stake_padrao_pct,
        stake_rs: +(banca * (config.stake_padrao_pct / 100)).toFixed(2),
        observacao: 'Alternativa em SIMPLES — handicap asiático não entra em bilhete combinado.',
      });
    }
  }
  return cards.sort((a, b) => b.vantagem_pp - a.vantagem_pp);
}
