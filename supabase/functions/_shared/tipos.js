/**
 * Vocabulário único do projeto. O motor e o dash falam a mesma língua:
 * o que o motor grava em /data é exatamente o que o dash lê.
 *
 * Mercado (chave canônica, usada em config, análise e bilhete):
 *   dupla_chance_casa | dupla_chance_fora | over_05 | over_15 | under_45
 *   ah_casa_m05 | ah_casa_m10 | ah_fora_p05   (só card de simples, nunca em bilhete)
 */

/** Rótulo humano de cada mercado. */
export const ROTULO_MERCADO = {
  dupla_chance_casa: 'Dupla chance casa (1X)',
  dupla_chance_fora: 'Dupla chance fora (X2)',
  over_05: 'Over 0.5 gols',
  over_15: 'Over 1.5 gols',
  under_45: 'Under 4.5 gols',
  ah_casa_m05: 'Handicap asiático casa -0.5',
  ah_casa_m10: 'Handicap asiático casa -1.0',
  ah_fora_p05: 'Handicap asiático fora +0.5',
};

/** Mercados de handicap: calculados, mas proibidos em bilhete combinado. */
export const MERCADOS_AH = ['ah_casa_m05', 'ah_casa_m10', 'ah_fora_p05'];

/** Motivos de descarte — texto exato que aparece na tela Análises. */
export const MOTIVO = {
  ODD_BAIXA: (odd, min) => `odd ${odd.toFixed(2)} abaixo do mínimo ${min.toFixed(2)}`,
  SEM_ODD: () => 'sem odd disponível na casa para este mercado',
  EV_NEGATIVO: (ev, min) =>
    `EV ${((ev - 1) * 100).toFixed(1)}% abaixo da margem mínima de ${((min - 1) * 100).toFixed(1)}%`,
  DIVERGEM: (h, dc, max) =>
    `modelos divergem: heurística ${(h * 100).toFixed(0)}% × Dixon-Coles ${(dc * 100).toFixed(0)}% (limite ${max} p.p.)`,
  AMOSTRA: (n, min) => `amostra insuficiente no mando: ${n} jogos (mínimo ${min})`,
  MERCADO_FORA: () => 'mercado não permitido em bilhete (só card de simples)',
  AH_SEM_DC: () => 'handicap sem Dixon-Coles disponível — sem matriz de placares vira chute',
  EV_SUSPEITO: (ev, teto) =>
    `EV implausível de ${((ev - 1) * 100).toFixed(0)}% (teto ${(teto * 100).toFixed(0)}%) — erro de modelo ou odd defasada, não é edge`,
};

/** Classificação de perna aprovada. */
export const CONFIANCA = { MAXIMA: 'CONFIANCA_MAXIMA', APROVADA: 'APROVADA' };
