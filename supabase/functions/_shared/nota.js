/**
 * NOTA DE CONFIANÇA (0–100) — determinística, calculada no MOTOR.
 *
 * Mede a SOLIDEZ da oportunidade, não a chance de ganhar. Duas entradas de 70% de prob podem
 * ter solidez muito diferente: uma com dois modelos concordando, amostra cheia e jogo hoje;
 * outra com um modelo só, amostra curta e daqui a três dias. A nota separa as duas.
 *
 * Soma de 5 componentes (máximo 100):
 *   concordância dos modelos 30 · EV crível 25 · amostra 20 · maturidade da família 15 · horizonte 10
 *
 * Os componentes são gravados junto (nota_componentes) pra alimentar o detalhamento em linguagem
 * de apostador na tela ("modelos concordam: 28/30 · valor na faixa saudável: 22/25").
 */
import { familiaDoMercado } from './tipos.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * EV em % → 0..25. Pico chapado entre 4 e 15%; acima de 20% DECAI, porque valor implausível
 * (a casa "esqueceu" 25% na mesa num mercado popular) é sinal de erro de modelo/odd defasada,
 * não de oportunidade. A régua desce ANTES do teto de descarte (35%): a nota já pune o número
 * suspeito enquanto ele ainda passa no filtro.
 */
function pontuarEV(ev_pct) {
  const e = ev_pct;
  if (e <= 0) return 0;
  if (e < 4) return 25 * (e / 4);
  if (e <= 15) return 25;
  if (e <= 20) return 25 - (25 - 20) * ((e - 15) / 5);   // 25 → 20 (transição)
  if (e <= 35) return 20 - (20 - 2) * ((e - 20) / 15);   // 20 → 2  (implausibilidade)
  return 2;
}

/**
 * @param p        perna avaliada (aprovada). Usa prob_heuristica, prob_dixon_coles, ev_pct/ev,
 *                 amostra_mando, mercado, horizonte_dias, sem_odd_referencia, prob_final.
 * @param opts     { mandoPleno } — teto de amostra plena (default 7).
 */
export function calcularNota(p, { mandoPleno = 7 } = {}) {
  const escanteio = familiaDoMercado(p.mercado) === 'escanteios' || Boolean(p.sem_odd_referencia);

  // 1) CONCORDÂNCIA (30): linear na divergência entre modelos, 0 p.p.=30, 10 p.p.=0.
  //    Sem segundo modelo (escanteio de Poisson único, ou liga sem Dixon-Coles) não há
  //    concordância a medir → 0. A humildade já está na confiança rebaixada; a nota reflete.
  let divergencia_pp = null;
  let concordancia = 0;
  if (p.prob_heuristica != null && p.prob_dixon_coles != null) {
    divergencia_pp = Math.abs(p.prob_heuristica - p.prob_dixon_coles) * 100;
    concordancia = clamp(30 * (1 - divergencia_pp / 10), 0, 30);
  }

  // 2) EV CRÍVEL (25): mercado com preço pontua pela plausibilidade do EV. Escanteio sem odd de
  //    mercado pontua pela CONVICÇÃO do modelo (prob acima do mínimo 0.62), com teto menor (15).
  let ev;
  if (escanteio) {
    ev = 15 * clamp(((p.prob_final ?? 0) - 0.62) / (0.85 - 0.62), 0, 1);
  } else {
    ev = pontuarEV(p.ev_pct != null ? p.ev_pct : ((p.ev ?? 1) - 1) * 100);
  }

  // 3) AMOSTRA (20): mando pleno = 20, curta proporcional aos jogos disponíveis.
  const amostra = 20 * clamp((p.amostra_mando ?? 0) / mandoPleno, 0, 1);

  // 4) MATURIDADE DA FAMÍLIA (15): resultado/gols = 15 (dois modelos, histórico de acerto);
  //    escanteios = 7 (modelo novo, sem segundo modelo conferindo).
  const maturidade = escanteio ? 7 : 15;

  // 5) HORIZONTE (10): D+0 = 10, decaindo linear até D+3 = 0 (escalação indefinida = menos certeza).
  const horizonte = 10 * clamp(1 - (p.horizonte_dias ?? 0) / 3, 0, 1);

  const r1 = (x) => Math.round(x * 10) / 10;
  const componentes = {
    concordancia: r1(concordancia), ev: r1(ev), amostra: r1(amostra),
    maturidade: r1(maturidade), horizonte: r1(horizonte),
    divergencia_pp: divergencia_pp == null ? null : r1(divergencia_pp),
  };
  // TETO "UM OLHO SÓ" (calibração 23/07): sem odd de mercado, sem 2º modelo (Dixon-Coles nulo) e
  // NÃO escanteio → é heurística pura, sem âncora nenhuma. O retrovisor sozinho superestima "não
  // perder" de time empatador de liga fraca (caso Santa Fe x Caracas: 86% / justa @1.17, quando o
  // mercado real dá ~54%). Nota teto 40: nunca sai do EXPLORAR — um modelo só não afirma solidez.
  const familiaEscanteios = familiaDoMercado(p.mercado) === 'escanteios';
  const umOlho = Boolean(p.sem_odd_referencia) && p.prob_dixon_coles == null && !familiaEscanteios;
  const notaBruta = Math.round(concordancia + ev + amostra + maturidade + horizonte);
  const nota = clamp(umOlho ? Math.min(notaBruta, 40) : notaBruta, 0, 100);
  return { nota, componentes };
}
