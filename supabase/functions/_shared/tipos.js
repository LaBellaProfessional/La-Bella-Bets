/**
 * Vocabulário único do projeto. O motor e o dash falam a mesma língua:
 * o que o motor grava em /data é exatamente o que o dash lê.
 *
 * Mercado (chave canônica, usada em config, análise e bilhete):
 *   dupla_chance_casa | dupla_chance_fora | over_05 | over_15 | under_45
 *   ah_casa_m05 | ah_casa_m10 | ah_fora_p05   (só card de simples, nunca em bilhete)
 */

/** Rótulo humano dos mercados de chave fixa. Os de linha (gols/escanteios) são gerados. */
export const ROTULO_MERCADO = {
  dupla_chance_casa: 'Dupla chance casa (1X)',
  dupla_chance_fora: 'Dupla chance fora (X2)',
  resultado_casa: 'Vitória casa (1)',
  resultado_fora: 'Vitória fora (2)',
  ah_casa_m05: 'Handicap asiático casa -0.5',
  ah_casa_m10: 'Handicap asiático casa -1.0',
  ah_fora_p05: 'Handicap asiático fora +0.5',
};

/**
 * MERCADOS DE LINHA — chave canônica `<lado>_<ponto sem ponto decimal>`.
 *   over_25  = over 2.5 gols       under_25 = under 2.5 gols
 *   esc_over_95 = over 9.5 escanteios
 *
 * A convenção antiga (over_05, over_15, under_45) é exatamente esse mesmo formato, então
 * nada quebra: o que muda é que a linha deixou de ser uma lista fixa de três e passou a ser
 * QUALQUER linha que a casa cotou. Descoberta de 21/07: a The Odds API praticamente só
 * publica 1.5/2.0/2.25/2.5 — 0.5 e 4.5 nunca vinham, então dois dos três mercados de gols
 * do sistema estavam mortos por construção.
 */
export const chaveLinha = (prefixo, lado, ponto) =>
  `${prefixo}${lado}_${String(ponto).replace('.', '')}`;

/** Decompõe `over_25` / `esc_under_105` em {familia, lado, linha}. Devolve null se não for de linha. */
export function partesLinha(mercado) {
  const m = /^(esc_)?(over|under)_(\d+)$/.exec(mercado ?? '');
  if (!m) return null;
  const d = m[3];
  // '05' → 0.5, '25' → 2.5, '105' → 10.5. Sempre meia-linha: o último dígito é a fração.
  const linha = Number(d.slice(0, -1) || '0') + Number(d.slice(-1)) / 10;
  return { familia: m[1] ? 'escanteios' : 'gols', lado: m[2], linha };
}

export const ehEscanteio = (m) => String(m ?? '').startsWith('esc_');
export const ehGols = (m) => { const p = partesLinha(m); return Boolean(p) && p.familia === 'gols'; };

/** Família do mercado — é o que agrupa as entradas do dia na aba Início. */
export function familiaDoMercado(mercado) {
  if (ehEscanteio(mercado)) return 'escanteios';
  if (ehGols(mercado)) return 'gols';
  return 'resultado';
}

export function rotuloMercado(mercado) {
  if (ROTULO_MERCADO[mercado]) return ROTULO_MERCADO[mercado];
  const p = partesLinha(mercado);
  if (!p) return mercado;
  const lado = p.lado === 'over' ? 'Over' : 'Under';
  return `${lado} ${p.linha.toFixed(1)} ${p.familia === 'escanteios' ? 'escanteios' : 'gols'}`;
}

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
  ESC_PROB_BAIXA: (p, min) =>
    `escanteios: ${(p * 100).toFixed(0)}% de chance, abaixo do mínimo de ${(min * 100).toFixed(0)}% exigido de um modelo sem odd de mercado pra conferir`,
  ESC_AMOSTRA: (n, min) => `escanteios: só ${n} jogo(s) com estatística no bloco (mínimo ${min})`,
  // Modo odd manual (jogo sem linha da API).
  SEM_MODELO: () => 'sem histórico suficiente pros modelos rodarem neste jogo',
  GATILHO_1X2: (p, gatilho) =>
    `vitória seca com ${(p * 100).toFixed(0)}% — abaixo do gatilho de ${(gatilho * 100).toFixed(0)}% exigido sem preço de mercado`,
  CONVICCAO_BAIXA: (p, piso) =>
    `${(p * 100).toFixed(0)}% de convicção do modelo, abaixo do mínimo de ${(piso * 100).toFixed(0)}% pra sugerir sem preço de mercado`,
  PREMIO_INEXISTENTE: (justa, min) =>
    `odd justa @${justa.toFixed(2)} abaixo de @${min.toFixed(2)} — pra pagar acima do justo a casa teria que ofertar o que não oferta`,
};

/**
 * Classificação de perna aprovada.
 * REBAIXADA: aprovada, mas com confiança propositalmente limitada — é o caso dos escanteios,
 * modelo novo, sem segundo modelo pra conferir e sem histórico de acerto acumulado.
 */
export const CONFIANCA = { MAXIMA: 'CONFIANCA_MAXIMA', APROVADA: 'APROVADA', REBAIXADA: 'REBAIXADA' };
