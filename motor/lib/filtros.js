/**
 * PARTE 3 — FILTROS DE PERNA.
 * Uma perna só entra no pool se passar em TODOS. Cada reprovação guarda o motivo exato,
 * porque a tela Análises tem que explicar por que o jogo caiu — descarte explicado é
 * metade do método.
 */
import { MOTIVO, CONFIANCA, MERCADOS_AH, ehGols, ehEscanteio } from './tipos.js';

export function avaliarPerna({ jogo, mercado, odd, probH, probDC, probPush, amostraMando, filtros, permitirSemOdd = false }) {
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

  // MANDO CURTO: descarta só abaixo do mínimo. Entre o mínimo e o pleno segue avaliada, com o
  // peso do mando rebaixado na heurística e a confiança limitada.
  const mandoMinimo = filtros.mando_minimo ?? 5;
  const mandoPleno = filtros.mando_pleno ?? 7;
  const temDC = probDC != null;
  const amostraCurta = amostraMando < mandoPleno;
  // Prob final: média dos dois modelos; só heurística (com desconto) quando não há Dixon-Coles.
  const probFinal = temDC ? (probH + probDC) / 2 : (probH != null ? probH * 0.95 : null);

  // FORMATO UNIFICADO (22/07): filtros percentuais gravados em % inteiro; o motor converte aqui
  // (1+x/100 ou x/100). As mensagens recebem os valores convertidos → texto na tela inalterado.
  const evMin = 1 + (filtros.ev_minimo ?? 3) / 100;
  const evTeto = (filtros.ev_teto_suspeito ?? 35) / 100;
  const cmEv = (filtros.confianca_maxima_ev ?? 6) / 100;
  const cmProb = (filtros.confianca_maxima_prob ?? 80) / 100;

  // ── MODO ODD MANUAL (jogo sem linha da API, mas os modelos rodam) ───────────────────────────
  // Avalia os filtros que NÃO dependem de odd (amostra, concordância, gatilho do 1x2, convicção
  // mínima); os de EV ficam pra quando o Maikon digitar a odd da casa dele. Confiança SEMPRE
  // rebaixada — sem preço de mercado pra conferir. Reusa `sem_odd_referencia` (a marca dos
  // escanteios), então nota, frontend e registro já tratam com o mesmo cuidado.
  if (odd == null) {
    if (!permitirSemOdd) return { ...base, aprovada: false, motivo: MOTIVO.SEM_ODD() };
    const sem = { ...base, sem_odd_referencia: true, prob_final: probFinal };
    if (probFinal == null) return { ...sem, aprovada: false, motivo: MOTIVO.SEM_MODELO() };
    if (amostraMando < mandoMinimo) return { ...sem, aprovada: false, motivo: MOTIVO.AMOSTRA(amostraMando, mandoMinimo) };
    if (temDC) {
      const divergencia = Math.abs(probH - probDC) * 100;
      if (divergencia > filtros.divergencia_maxima_pp)
        return { ...sem, aprovada: false, motivo: MOTIVO.DIVERGEM(probH, probDC, filtros.divergencia_maxima_pp) };
    }
    if (mercado === 'resultado_casa' || mercado === 'resultado_fora') {
      const gatilho = (filtros.gatilho_1x2 ?? 72) / 100;   // vitória seca só com convicção alta
      if (probFinal < gatilho) return { ...sem, aprovada: false, motivo: MOTIVO.GATILHO_1X2(probFinal, gatilho) };
    }
    const pisoManual = (filtros.convicao_minima_sem_odd ?? 50) / 100;
    if (probFinal < pisoManual) return { ...sem, aprovada: false, motivo: MOTIVO.CONVICCAO_BAIXA(probFinal, pisoManual) };
    return {
      ...sem,
      aprovada: true,
      odd_justa: +(1 / probFinal).toFixed(2),
      confianca: CONFIANCA.REBAIXADA,
      dixon_coles_disponivel: temDC,
      amostra_curta: amostraCurta,
      badge_amostra: amostraCurta ? `amostra curta no mando (${amostraMando} jogos)` : null,
      elegivel_bilhete: false,   // sem odd → nunca em combinada
      justificativa: `${(probFinal * 100).toFixed(0)}% pelo modelo (${temDC ? 'heurística + Dixon-Coles' : 'só heurística'}), sem linha da API — digite a odd da sua casa.`,
    };
  }

  if (odd < filtros.odd_minima_perna)
    return { ...base, aprovada: false, motivo: MOTIVO.ODD_BAIXA(odd, filtros.odd_minima_perna) };

  if (amostraMando < mandoMinimo)
    return { ...base, aprovada: false, motivo: MOTIVO.AMOSTRA(amostraMando, mandoMinimo) };

  // Concordância entre modelos. Sem Dixon-Coles opera só com heurística e confiança rebaixada.
  if (temDC) {
    const divergencia = Math.abs(probH - probDC) * 100;
    if (divergencia > filtros.divergencia_maxima_pp)
      return { ...base, aprovada: false, motivo: MOTIVO.DIVERGEM(probH, probDC, filtros.divergencia_maxima_pp) };
  }

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
