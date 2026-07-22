/**
 * PARTE 1 — SCORE HEURÍSTICO (o método manual do Maikon, formalizado).
 *
 * Três blocos por time: mando (50%), geral (30%), H2H (20%).
 * Sem H2H → redistribui 60/40. Amostra curta → usa o que existe e PENALIZA a confiança;
 * nunca completa buraco com chute.
 */

import { partesLinha } from './tipos.js';

/** Taxa de acerto de um mercado num conjunto de jogos, do ponto de vista de `time`. */
function taxaNoBloco(jogos, mercado, time) {
  const linha = partesLinha(mercado);
  if (!jogos.length) return null;
  let n = 0;
  let denominador = 0;
  for (const j of jogos) {
    const eCasa = j.casa === time;
    const golsPro = eCasa ? j.gols_casa : j.gols_fora;
    const golsContra = eCasa ? j.gols_fora : j.gols_casa;
    const total = j.gols_casa + j.gols_fora;
    const saldo = golsPro - golsContra;
    let bateu = false;
    denominador++;
    // Mercado de LINHA (over/under de gols) resolve genericamente: a linha é sempre meia
    // (2.5, 1.5…), então não existe devolução — ou passou, ou não passou.
    if (linha) {
      if (linha.lado === 'over' ? total > linha.linha : total < linha.linha) n++;
      continue;
    }
    switch (mercado) {
      // Dupla chance = não perder. O lado (casa/fora) é o do próprio time no jogo analisado.
      case 'dupla_chance_casa':
      case 'dupla_chance_fora':
        bateu = saldo >= 0;
        break;
      // Vitória seca (1x2) do lado apostado — a perspectiva já roteia pro time certo.
      case 'resultado_casa':
      case 'resultado_fora':
        bateu = saldo > 0;
        break;
      // Handicaps: taxa histórica REAL do time, não cópia do Dixon-Coles. Sem isso o filtro
      // de concordância viraria vazio pro AH (dois "modelos" com o mesmo número sempre
      // concordam) e todo handicap passaria batido.
      case 'ah_casa_m05':
        bateu = saldo > 0; // -0.5 → precisa vencer
        break;
      case 'ah_casa_m10':
        // -1.0 devolve a aposta quando vence por exatamente 1: o jogo sai do denominador.
        if (saldo === 1) { denominador--; bateu = false; } else bateu = saldo >= 2;
        break;
      case 'ah_fora_p05':
        bateu = saldo >= 0; // +0.5 → basta não perder
        break;
      default:
        bateu = false;
    }
    if (bateu) n++;
  }
  return denominador > 0 ? n / denominador : null;
}

/**
 * Mercado DIRECIONAL olha só o time do lado apostado; mercado de PLACAR olha os dois.
 *
 * Dupla chance é direcional: "1X" é o mandante não perder, "X2" é o visitante não perder.
 * Fazer média dos dois times dava o MESMO número pros dois mercados (1X = X2 = 52%), o que
 * é sem sentido — e gerava divergência falsa contra o Dixon-Coles, derrubando pernas boas.
 * Over/under continuam com os dois times: total de gols depende dos dois ataques e defesas.
 */
function perspectivaDoMercado(mercado, casa, fora) {
  if (mercado === 'ah_fora_p05' || mercado === 'dupla_chance_fora' || mercado === 'resultado_fora') return [fora];
  if (mercado.startsWith('ah_casa') || mercado === 'dupla_chance_casa' || mercado === 'resultado_casa') return [casa];
  return [casa, fora];
}

/**
 * Probabilidade heurística de um mercado para um jogo.
 * Combina os blocos dos DOIS times (média) — o mercado depende dos dois lados.
 */
export function probHeuristica({ mercado, casa, fora, historico, h2h, pesos }) {
  const blocosDe = (time, mandoDesejado) => {
    const todos = historico[time] ?? [];
    const noMando = todos.filter((j) => (mandoDesejado === 'casa' ? j.casa === time : j.fora === time));
    return {
      mando: noMando.slice(0, 10),
      geral: todos.slice(0, 10),
    };
  };

  const bCasa = blocosDe(casa, 'casa');
  const bFora = blocosDe(fora, 'fora');
  const h2hJogos = (h2h ?? []).slice(0, 3);
  const temH2H = h2hJogos.length > 0;

  const pBase = temH2H ? pesos : { mando: pesos.sem_h2h.mando, geral: pesos.sem_h2h.geral, h2h: 0 };

  // Quem entra na conta: os dois times (mercados simétricos) ou só o lado apostado (handicap
  // e dupla chance). A amostra do mando segue a mesma regra — num mercado direcional, o que
  // importa é quantos jogos o TIME APOSTADO tem naquele mando.
  const ladosAmostra = perspectivaDoMercado(mercado, casa, fora);
  const amostraMando =
    ladosAmostra.length === 2 ? Math.min(bCasa.mando.length, bFora.mando.length)
    : ladosAmostra[0] === casa ? bCasa.mando.length
    : bFora.mando.length;

  // MANDO CURTO — rebaixar, não descartar (regra de 21/07).
  // Com menos jogos no mando do que o ideal, o bloco de mando perde peso PROPORCIONALMENTE e
  // a diferença vai pro bloco geral, que tem amostra maior. Jogar a perna fora desperdiçaria
  // os 15 jogos gerais que já estão em cache — informação que o método manual sempre usou.
  // Linear e simples: fator = jogos_no_mando / mando_pleno.
  //   7+ jogos → fator 1.00 → mando 50%, geral 30%
  //   6 jogos  → fator 0.86 → mando 43%, geral 37%
  //   5 jogos  → fator 0.71 → mando 36%, geral 44%
  const mandoPleno = pesos.mando_pleno ?? 7;
  const fatorMando = Math.min(1, amostraMando / mandoPleno);
  const pesoMando = pBase.mando * fatorMando;
  const p = {
    mando: pesoMando,
    geral: pBase.geral + (pBase.mando - pesoMando), // a diferença não some: migra pro geral
    h2h: pBase.h2h,
  };
  const amostraCurta = fatorMando < 1;

  // Cada bloco vira a média das taxas dos dois times (o H2H já é compartilhado).
  const media = (a, b) => {
    const vals = [a, b].filter((v) => v !== null);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  };

  // Quem entra na conta: os dois times (mercados simétricos) ou só o lado apostado (handicap).
  const lados = perspectivaDoMercado(mercado, casa, fora);
  const usaCasa = lados.includes(casa);
  const usaFora = lados.includes(fora);

  const tMando = media(
    usaCasa ? taxaNoBloco(bCasa.mando, mercado, casa) : null,
    usaFora ? taxaNoBloco(bFora.mando, mercado, fora) : null
  );
  const tGeral = media(
    usaCasa ? taxaNoBloco(bCasa.geral, mercado, casa) : null,
    usaFora ? taxaNoBloco(bFora.geral, mercado, fora) : null
  );
  const tH2H = temH2H
    ? media(
        usaCasa ? taxaNoBloco(h2hJogos, mercado, casa) : null,
        usaFora ? taxaNoBloco(h2hJogos, mercado, fora) : null
      )
    : null;

  // Renormaliza os pesos sobre os blocos que existem de verdade.
  let soma = 0;
  let acc = 0;
  if (tMando !== null) { acc += tMando * p.mando; soma += p.mando; }
  if (tGeral !== null) { acc += tGeral * p.geral; soma += p.geral; }
  if (tH2H !== null) { acc += tH2H * p.h2h; soma += p.h2h; }
  if (soma === 0) return { prob: null, amostra_mando: amostraMando, amostra_curta: amostraCurta, confianca_amostra: 0, blocos: {} };

  const prob = acc / soma;

  // Confiança da amostra: 10 jogos no mando = 1.0; cai proporcional. É o freio contra
  // achar que 3 jogos valem tanto quanto 10.
  const confAmostra = Math.min(1, amostraMando / 10);

  return {
    prob,
    amostra_mando: amostraMando,
    amostra_curta: amostraCurta,
    confianca_amostra: confAmostra,
    peso_mando_efetivo: +p.mando.toFixed(3),
    peso_geral_efetivo: +p.geral.toFixed(3),
    blocos: {
      mando: tMando,
      geral: tGeral,
      h2h: tH2H,
      pesos_aplicados: { mando: p.mando, geral: p.geral, h2h: p.h2h, tinha_h2h: temH2H },
    },
  };
}
