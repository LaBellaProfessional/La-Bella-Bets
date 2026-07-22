/**
 * PAPER TRADING — a sugestão vira aposta VIRTUAL, liquidada pelo placar real.
 *
 * A ideia: toda entrada que o método aprovou (e as de radar) é registrada como se tivesse sido
 * apostada 1 unidade na odd de referência. Quando o jogo termina, o placar diz se ganhou. Isso
 * mede duas coisas que nenhum backtest de odd faz sozinho:
 *
 *   1. CALIBRAÇÃO — o modelo diz "76% de chance". Em 100 sugestões de 76%, quantas deram certo?
 *      Se deu 60%, o modelo é superconfiante e o filtro de EV está deixando passar lixo.
 *   2. ROI VIRTUAL — a stake fixa de 1 unidade, quanto renderia? É TETO, não promessa: usa a
 *      odd de referência (a melhor casa europeia), e a casa brasileira do Maikon paga menos.
 *
 * Escanteios não têm odd de mercado — a "odd de referência" deles é a odd JUSTA do modelo, então
 * o ROI virtual de escanteio fica ~0 por construção (aposta no preço justo não tem margem). Pra
 * eles o que vale é a calibração. Por isso `odd_e_mercado` distingue os dois: o ROI agregado só
 * soma onde havia preço de mercado de verdade.
 */
import { partesLinha, familiaDoMercado, rotuloMercado } from './tipos.js';

/** CONFIANCA.* → rótulo curto e estável usado no breakdown. */
function normalizarConfianca(c) {
  const v = String(c || '').toUpperCase();
  if (v.includes('MAXIMA')) return 'maxima';
  if (v.includes('REBAIXADA')) return 'rebaixada';
  return 'aprovada';
}

/**
 * Converte uma perna aprovada (ou de radar) na linha da tabela de sugestões.
 * Devolve null quando a perna não é sugestão registrável (não aprovada, sem odd, sem prob).
 */
export function sugestaoDaPerna(p, data, snapshot = null) {
  if (!p || !p.aprovada) return null;
  if (p.prob_final == null) return null;

  const ehMercado = !p.sem_odd_referencia;            // escanteio não tem preço publicado
  const odd = ehMercado ? p.odd : (p.odd_justa ?? null);
  if (odd == null) return null;

  const linha = partesLinha(p.mercado);
  return {
    data,
    jogo_id: String(p.jogo_id),
    partida: p.partida,
    liga: p.liga,
    casa: p.casa,
    fora: p.fora,
    mercado: p.mercado,
    rotulo: rotuloMercado(p.mercado),
    familia: familiaDoMercado(p.mercado),
    linha: linha ? linha.linha : null,
    odd_referencia: odd,
    odd_e_mercado: ehMercado,
    prob_modelo: p.prob_final,
    confianca: normalizarConfianca(p.confianca),
    radar: Boolean(p.radar),
    horizonte_dias: p.horizonte_dias ?? 0,
    // Nota de confiança + componentes, gravados na sugestão pra o corte por faixa na calibração.
    nota: p.nota ?? null,
    nota_componentes: p.nota_componentes ?? null,
    // Foto dos parâmetros que geraram ESTA sugestão. Quando formos testar variações de config
    // contra o histórico, é o que diz qual "versão do método" produziu cada resultado — sem
    // isso, um ROI de junho misturaria pesos que já mudaram e não provaria nada.
    config_snapshot: snapshot,
  };
}

/**
 * Liquida uma sugestão contra o placar real. Devolve 'ganhou' | 'perdeu' | null.
 * null = ainda não dá pra liquidar (faltou o dado: placar de gols ou total de escanteios).
 *
 * Todas as linhas do sistema são MEIA-LINHA (x.5): não existe push, ou passou ou não passou.
 */
export function resultadoSugestao(sug, res) {
  const linha = partesLinha(sug.mercado);

  if (linha && linha.familia === 'escanteios') {
    if (res.escanteiosTotal == null) return null;
    return (linha.lado === 'over' ? res.escanteiosTotal > linha.linha : res.escanteiosTotal < linha.linha)
      ? 'ganhou' : 'perdeu';
  }
  if (linha && linha.familia === 'gols') {
    if (res.golsCasa == null || res.golsFora == null) return null;
    const total = res.golsCasa + res.golsFora;
    return (linha.lado === 'over' ? total > linha.linha : total < linha.linha) ? 'ganhou' : 'perdeu';
  }
  if (res.golsCasa == null || res.golsFora == null) return null;
  // Dupla chance = não perder o lado apostado.
  if (sug.mercado === 'dupla_chance_casa') return res.golsCasa >= res.golsFora ? 'ganhou' : 'perdeu';
  if (sug.mercado === 'dupla_chance_fora') return res.golsFora >= res.golsCasa ? 'ganhou' : 'perdeu';
  // 1x2 seco (modo odd manual) = vitória do lado apostado.
  if (sug.mercado === 'resultado_casa') return res.golsCasa > res.golsFora ? 'ganhou' : 'perdeu';
  if (sug.mercado === 'resultado_fora') return res.golsFora > res.golsCasa ? 'ganhou' : 'perdeu';
  return null;
}
