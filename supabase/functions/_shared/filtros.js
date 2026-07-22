/**
 * PARTE 3 — FILTROS DE PERNA.
 * Uma perna só entra no pool se passar em TODOS. Cada reprovação guarda o motivo exato,
 * porque a tela Análises tem que explicar por que o jogo caiu — descarte explicado é
 * metade do método.
 */
import { MOTIVO, CONFIANCA, MERCADOS_AH, ehGols, ehEscanteio } from './tipos.js';

export function avaliarPerna({ jogo, mercado, odd, probH, probDC, probPush, amostraMando, filtros }) {
  const base = {
    jogo_id: jogo.id,
    partida: `${jogo.casa} x ${jogo.fora}`,
    liga: jogo.liga,
    hora: jogo.hora,
    casa: jogo.casa,
    fora: jogo.fora,
    mercado,
    odd: odd ?? null,
    prob_heuristica: probH ?? null,
    prob_dixon_coles: probDC ?? null,
    amostra_mando: amostraMando,
  };

  if (odd == null) return { ...base, aprovada: false, motivo: MOTIVO.SEM_ODD() };

  if (odd < filtros.odd_minima_perna)
    return { ...base, aprovada: false, motivo: MOTIVO.ODD_BAIXA(odd, filtros.odd_minima_perna) };

  // MANDO CURTO: descarta só abaixo do mínimo absoluto. Entre o mínimo e o pleno a perna
  // segue avaliada, com o peso do mando já rebaixado na heurística e a confiança limitada.
  const mandoMinimo = filtros.mando_minimo ?? 5;
  const mandoPleno = filtros.mando_pleno ?? 7;

  // FORMATO UNIFICADO (22/07): os filtros de natureza percentual são gravados em % INTEIRO
  // (ev_minimo 3, ev_teto_suspeito 35, confianca_maxima_ev 6, confianca_maxima_prob 80). O motor
  // converte aqui pro número que a conta usa — multiplicador de EV (1+x/100) ou fração (x/100).
  // divergencia_maxima_pp e ah_vantagem_minima_pp já são p.p., não passam por aqui. As mensagens
  // recebem os valores JÁ convertidos, então o texto na tela Análises não muda.
  const evMin = 1 + (filtros.ev_minimo ?? 3) / 100;
  const evTeto = (filtros.ev_teto_suspeito ?? 35) / 100;
  const cmEv = (filtros.confianca_maxima_ev ?? 6) / 100;
  const cmProb = (filtros.confianca_maxima_prob ?? 80) / 100;

  if (amostraMando < mandoMinimo)
    return { ...base, aprovada: false, motivo: MOTIVO.AMOSTRA(amostraMando, mandoMinimo) };

  // Concordância entre modelos. Sem Dixon-Coles (liga sem amostra), opera só com heurística
  // e confiança rebaixada — não é motivo de descarte, é motivo de humildade.
  const temDC = probDC != null;
  if (temDC) {
    const divergencia = Math.abs(probH - probDC) * 100;
    if (divergencia > filtros.divergencia_maxima_pp)
      return { ...base, aprovada: false, motivo: MOTIVO.DIVERGEM(probH, probDC, filtros.divergencia_maxima_pp) };
  }

  // Prob final: média dos dois quando ambos existem; só heurística (com desconto) quando não.
  const probFinal = temDC ? (probH + probDC) / 2 : probH * 0.95;

  // EV. Em mercado COM DEVOLUÇÃO (handicap -1.0, empata por 1 gol de saldo) a aposta volta
  // ao bolso no push: EV = p_ganha × odd + p_push × 1. Tratar push como derrota subestimaria
  // o mercado; ignorá-lo superestimaria.
  const pPush = mercado === 'ah_casa_m10' ? (probPush ?? 0) : 0;
  const ev = probFinal * (1 - pPush) * odd + pPush;

  if (ev < evMin)
    return { ...base, aprovada: false, motivo: MOTIVO.EV_NEGATIVO(ev, evMin), prob_final: probFinal, ev };

  // TRAVA 1 — handicap sem matriz de placares é chute. É o mercado de maior variância do
  // sistema; sem Dixon-Coles não há segundo modelo pra conferir, e a heurística sozinha, em
  // amostra curta, produz EV fantasioso.
  if (mercado.startsWith('ah_') && !temDC)
    return { ...base, aprovada: false, motivo: MOTIVO.AH_SEM_DC(), prob_final: probFinal, ev };

  // TRAVA 2 — EV implausível. Casa de aposta profissional não deixa 40% de valor na mesa em
  // mercado popular: EV assim é erro de modelo, odd defasada ou amostra viciada — não é edge.
  // Descartar é o comportamento correto; perseguir esse número é como o método se perde.
  if (ev - 1 > evTeto)
    return { ...base, aprovada: false, motivo: MOTIVO.EV_SUSPEITO(ev, evTeto), prob_final: probFinal, ev };

  // Amostra curta NUNCA vira confiança máxima: o dado é mais fino, o stake tem que ser o padrão.
  const amostraCurta = amostraMando < mandoPleno;
  const maxima =
    !amostraCurta &&
    temDC &&
    probH >= cmProb &&
    probDC >= cmProb &&
    ev - 1 >= cmEv;

  return {
    ...base,
    aprovada: true,
    prob_final: probFinal,
    ev,
    ev_pct: (ev - 1) * 100,
    confianca: maxima ? CONFIANCA.MAXIMA : CONFIANCA.APROVADA,
    dixon_coles_disponivel: temDC,
    amostra_curta: amostraCurta,
    badge_amostra: amostraCurta ? `amostra curta no mando (${amostraMando} jogos)` : null,
    justificativa: montarJustificativa({ mercado, probFinal, ev, temDC, amostraMando, jogo }),
    // Elegibilidade por FAMÍLIA, não por lista fixa: o config lista os mercados de resultado,
    // e qualquer linha de gols cotada entra por ser gols. Antes, uma perna over 2.5 nasceria
    // aprovada e inelegível — o mercado novo só apareceria como card, nunca em bilhete.
    elegivel_bilhete:
      !MERCADOS_AH.includes(mercado) && !ehEscanteio(mercado) &&
      (ehGols(mercado) || filtros.mercados_em_bilhete.includes(mercado)),
  };
}

/** Uma linha de porquê — é o que aparece embaixo de cada perna no card do dia. */
function montarJustificativa({ mercado, probFinal, ev, temDC, amostraMando }) {
  const p = (probFinal * 100).toFixed(0);
  const e = ((ev - 1) * 100).toFixed(1);
  const fonte = temDC ? 'heurística + Dixon-Coles' : 'só heurística (liga sem amostra p/ DC)';
  return `${p}% pelo modelo (${fonte}), EV +${e}%, ${amostraMando} jogos no mando.`;
}
