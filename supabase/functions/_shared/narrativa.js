/**
 * CONTAGENS PRA LINGUAGEM DE APOSTADOR.
 *
 * O dash fala em "não perde em casa há 9 de 10", não em "82%". Percentual é conclusão;
 * contagem é fato — e é assim que a conversa acontece na mesa.
 *
 * Aqui só se conta. A FRASE é montada no dash, por template determinístico: mesma análise
 * sempre gera o mesmo texto, e mudar a redação não obriga a reprocessar análise nenhuma.
 */

function contarTime(jogos, time, mando) {
  const noMando = jogos.filter((j) => (mando === 'casa' ? j.casa === time : j.fora === time)).slice(0, 10);
  const geral = jogos.slice(0, 10);

  const stats = (lista) => {
    let venceu = 0, empatou = 0, perdeu = 0, over15 = 0, marcou = 0, sofreu = 0;
    for (const j of lista) {
      const eCasa = j.casa === time;
      const pro = eCasa ? j.gols_casa : j.gols_fora;
      const contra = eCasa ? j.gols_fora : j.gols_casa;
      if (pro > contra) venceu++; else if (pro === contra) empatou++; else perdeu++;
      if (j.gols_casa + j.gols_fora >= 2) over15++;
      marcou += pro; sofreu += contra;
    }
    return {
      n: lista.length, venceu, empatou, perdeu,
      nao_perdeu: venceu + empatou,
      over15,
      media_marcou: lista.length ? +(marcou / lista.length).toFixed(1) : 0,
      media_sofreu: lista.length ? +(sofreu / lista.length).toFixed(1) : 0,
    };
  };

  return { time, mando: stats(noMando), geral: stats(geral) };
}

/** Contagens dos dois lados de uma partida, prontas pro dash virar frase. */
export function contagensDoJogo(jogo, historico) {
  return {
    casa: contarTime(historico[jogo.casa] ?? [], jogo.casa, 'casa'),
    fora: contarTime(historico[jogo.fora] ?? [], jogo.fora, 'fora'),
  };
}
