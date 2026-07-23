/**
 * VEREDITO DO ODD DIGITADO — fonte única do julgamento "essa odd vale?" que o dash mostra quando
 * o Maikon digita a odd da casa dele. Mesma regra do motor (filtros.js aprova quando
 * ev = prob*odd >= 1 + ev_minimo/100), escrita como comparação em pontos percentuais:
 *
 *     vale  ⇔  ganho% >= ev_minimo%        (ganho% = (prob*odd - 1) * 100)
 *
 * FORMATO UNIFICADO (22/07): ev_minimo é % INTEIRO (3 = 3%), NÃO razão. A inversão de veredito
 * — odd ACIMA do justo lida como "sem valor" — nasceu porque o dash comparava o MÚLTIPLO de EV
 * (~1.17) direto contra a margem em % (3): 1.17 >= 3 é sempre falso, então toda aposta boa virava
 * "vantagem sumiu" e o botão travava em "Sem valor". A conta agora mora aqui, testada, e é
 * importada pelo dash — o componente não recalcula por conta própria.
 *
 * Serve os três modos (com linha, sem linha/odd-manual, escanteios): todos entregam prob + odd.
 */
export function vereditoOdd({ prob, odd, evMinimoPct = 3 }) {
  const p = Number.isFinite(prob) ? prob : 0;
  const o = Number.isFinite(odd) ? odd : 0;
  const justo = p > 0 ? 1 / p : 0;          // odd que zera a vantagem (odd justa)
  const valorNaOdd = p * o;                 // retorno esperado por real apostado
  const ganhoPct = (valorNaOdd - 1) * 100;  // vantagem em pontos percentuais
  const vale = p > 0 && o > 1 && ganhoPct >= evMinimoPct;
  return { justo, valorNaOdd, ganhoPct, vale };
}
