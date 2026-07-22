/**
 * PARTE 6 — ESCANTEIOS (fase 2, modo híbrido SEM odd de referência).
 *
 * Por que é diferente de tudo o que veio antes: nos mercados de resultado e gols existe uma
 * odd publicada, e o método caça a diferença entre a probabilidade do modelo e o preço da casa.
 * Em escanteios a The Odds API não publica preço nenhum — só existe metade da conta.
 *
 * A saída é honesta: o sistema estima a probabilidade e a ODD JUSTA, e o Maikon digita a odd
 * que a casa dele está pagando. Sem odd digitada, não há EV — e sem EV não se registra aposta.
 * É o inverso do fluxo normal: aqui o número que falta vem do usuário, não da API.
 *
 * Modelo: mesma anatomia da heurística de gols (mando 50% / geral 30% / H2H 20%, com o mesmo
 * rebaixamento de mando curto), só que a grandeza é a MÉDIA DE ESCANTEIOS TOTAIS do jogo em vez
 * de uma taxa de acerto. Dessa média sai um λ e um Poisson simples responde as linhas.
 *
 * Poisson simples e não Dixon-Coles de propósito: DC corrige placares baixos de GOL (0x0, 1x1),
 * um fenômeno de futebol que não tem análogo em escanteio. Copiar a correção pra cá seria
 * empurrar uma calibração de um fenômeno em cima de outro.
 *
 * Confiança SEMPRE rebaixada: modelo novo, sem segundo modelo pra conferir e sem histórico de
 * acerto acumulado. Vira CONFIANCA.APROVADA quando (e se) o histórico justificar.
 */
import { CONFIANCA, MOTIVO, chaveLinha, partesLinha } from './tipos.js';

/** Linhas padrão do mercado — as três que as casas brasileiras publicam com liquidez. */
export const LINHAS_ESCANTEIOS = [8.5, 9.5, 10.5];

/** Mercados de escanteios avaliados por jogo: over e under de cada linha. */
export const MERCADOS_ESCANTEIOS = LINHAS_ESCANTEIOS.flatMap((l) => [
  chaveLinha('esc_', 'over', l),
  chaveLinha('esc_', 'under', l),
]);

const fatorial = (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
const poisson = (k, lambda) => (Math.exp(-lambda) * Math.pow(lambda, k)) / fatorial(k);

/** P(total > linha) por Poisson, somando a cauda de baixo e complementando. */
function probOver(lambda, linha) {
  let acc = 0;
  for (let k = 0; k <= Math.floor(linha); k++) acc += poisson(k, lambda);
  return Math.min(0.999, Math.max(0.001, 1 - acc));
}

/** Média de escanteios TOTAIS do jogo num conjunto de partidas. */
function mediaTotal(jogos) {
  if (!jogos?.length) return null;
  const soma = jogos.reduce((s, j) => s + (j.esc_casa ?? 0) + (j.esc_fora ?? 0), 0);
  return soma / jogos.length;
}

/**
 * λ de escanteios do confronto.
 *
 * @param escanteios Record<time, jogos[]> — jogos com estatística, mais recentes primeiro
 * @param h2hEsc     jogos do confronto direto com estatística
 */
export function lambdaEscanteios({ casa, fora, escanteios, h2hEsc, pesos }) {
  const doTime = (time, mando) => {
    const todos = escanteios[time] ?? [];
    return {
      mando: todos.filter((j) => (mando === 'casa' ? j.casa === time : j.fora === time)).slice(0, 10),
      geral: todos.slice(0, 10),
    };
  };
  const bCasa = doTime(casa, 'casa');
  const bFora = doTime(fora, 'fora');
  const h2hJogos = (h2hEsc ?? []).slice(0, 3);
  const temH2H = h2hJogos.length > 0;

  const pBase = temH2H ? pesos : { mando: pesos.sem_h2h.mando, geral: pesos.sem_h2h.geral, h2h: 0 };

  // Mesma regra de mando curto dos outros mercados: o bloco de mando perde peso proporcional
  // e a diferença migra pro geral, que tem amostra maior. Nada de descartar por 1 jogo a menos.
  const amostraMando = Math.min(bCasa.mando.length, bFora.mando.length);
  const mandoPleno = pesos.mando_pleno ?? 7;
  const fator = Math.min(1, amostraMando / mandoPleno);
  const p = {
    mando: pBase.mando * fator,
    geral: pBase.geral + (pBase.mando - pBase.mando * fator),
    h2h: pBase.h2h,
  };

  const media2 = (a, b) => {
    const v = [a, b].filter((x) => x !== null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const mMando = media2(mediaTotal(bCasa.mando), mediaTotal(bFora.mando));
  const mGeral = media2(mediaTotal(bCasa.geral), mediaTotal(bFora.geral));
  const mH2H = temH2H ? mediaTotal(h2hJogos) : null;

  let acc = 0, soma = 0;
  if (mMando !== null) { acc += mMando * p.mando; soma += p.mando; }
  if (mGeral !== null) { acc += mGeral * p.geral; soma += p.geral; }
  if (mH2H !== null) { acc += mH2H * p.h2h; soma += p.h2h; }
  if (!soma) return { lambda: null, amostra_mando: amostraMando, amostra_curta: fator < 1, blocos: {} };

  return {
    lambda: acc / soma,
    amostra_mando: amostraMando,
    amostra_geral: Math.min(bCasa.geral.length, bFora.geral.length),
    amostra_curta: fator < 1,
    blocos: {
      mando: mMando, geral: mGeral, h2h: mH2H,
      pesos_aplicados: { mando: p.mando, geral: p.geral, h2h: p.h2h, tinha_h2h: temH2H },
    },
  };
}

/**
 * Avalia as pernas de escanteios de um jogo.
 *
 * Sem odd de mercado não existe filtro de EV nem de divergência entre modelos — os dois freios
 * que seguram o resto do sistema. O que entra no lugar é uma exigência maior de convicção:
 * a probabilidade tem que passar de `escanteios_prob_minima` (0.62 por padrão, contra o
 * equivalente a ~0.50 dos mercados com preço). É deliberadamente conservador enquanto não
 * houver histórico de acerto pra calibrar.
 */
export function pernasEscanteios({ jogo, escanteios, h2hEsc, pesos, filtros, banca, stakePct }) {
  // Formato unificado: escanteios_prob_minima gravado em % inteiro (62). Motor usa fração.
  const probMin = (filtros.escanteios_prob_minima ?? 62) / 100;
  const amostraMin = filtros.escanteios_amostra_minima ?? 6;
  const est = lambdaEscanteios({ casa: jogo.casa, fora: jogo.fora, escanteios, h2hEsc, pesos });

  const base = (mercado) => ({
    jogo_id: jogo.id, partida: `${jogo.casa} x ${jogo.fora}`, liga: jogo.liga, hora: jogo.hora,
    casa: jogo.casa, fora: jogo.fora, mercado,
    odd: null,                    // sem odd de referência: é a marca do mercado
    sem_odd_referencia: true,
    prob_heuristica: null, prob_dixon_coles: null,
    amostra_mando: est.amostra_mando,
    lambda_escanteios: est.lambda != null ? +est.lambda.toFixed(2) : null,
  });

  if (est.lambda == null) {
    return MERCADOS_ESCANTEIOS.map((m) => ({
      ...base(m), aprovada: false, motivo: MOTIVO.ESC_AMOSTRA(0, amostraMin),
    }));
  }

  const amostraUtil = Math.max(est.amostra_mando, est.amostra_geral ?? 0);
  if (amostraUtil < amostraMin) {
    return MERCADOS_ESCANTEIOS.map((m) => ({
      ...base(m), aprovada: false, motivo: MOTIVO.ESC_AMOSTRA(amostraUtil, amostraMin),
    }));
  }

  return MERCADOS_ESCANTEIOS.map((mercado) => {
    const { linha, lado } = partesLinha(mercado);
    const pOver = probOver(est.lambda, linha);
    const prob = lado === 'over' ? pOver : 1 - pOver;
    const b = {
      ...base(mercado),
      prob_final: prob,
      odd_justa: +(1 / prob).toFixed(2),
      blocos_escanteios: est.blocos,
      amostra_curta: est.amostra_curta,
      badge_amostra: est.amostra_curta ? `amostra curta no mando (${est.amostra_mando} jogos com estatística)` : null,
    };
    if (prob < probMin) return { ...b, aprovada: false, motivo: MOTIVO.ESC_PROB_BAIXA(prob, probMin) };
    return {
      ...b,
      aprovada: true,
      // Confiança rebaixada por regra, não por circunstância: enquanto não houver histórico
      // de acerto do modelo de escanteios, nenhuma perna dessas puxa stake maior.
      confianca: CONFIANCA.REBAIXADA,
      dixon_coles_disponivel: false,
      // NUNCA em bilhete combinado: sem preço de mercado não dá pra checar a odd do conjunto,
      // e correlação escanteio×gol não está modelada. Só simples.
      elegivel_bilhete: false,
      stake_pct: stakePct,
      stake_rs: +(banca * (stakePct / 100)).toFixed(2),
      justificativa:
        `média projetada de ${est.lambda.toFixed(1)} escanteios no jogo (mando ${est.blocos.mando?.toFixed(1) ?? '—'}, ` +
        `geral ${est.blocos.geral?.toFixed(1) ?? '—'}${est.blocos.h2h != null ? `, H2H ${est.blocos.h2h.toFixed(1)}` : ''}) ` +
        `→ ${(prob * 100).toFixed(0)}% de chance, odd justa @${(1 / prob).toFixed(2)}.`,
    };
  });
}
