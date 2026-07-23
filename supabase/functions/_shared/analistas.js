/**
 * CAMADA DE ANALISTAS — a matemática de unir o contexto humano ao motor, SEM que ele mande.
 *
 * Três regras, todas mensuráveis e visíveis:
 *
 *   1. FATO consensual (2+ analistas, mesma categoria, mesmo jogo, <48h) = força total. Vira alerta
 *      LARANJA no card. Se um fato consensual CONTRARIA uma entrada aprovada (mercado_alvo + direção
 *      'contra'), a stake trava no piso e o motivo fica anotado. Fato não modula nota — ele avisa.
 *
 *   2. DADO_CITADO = contexto informativo (fonte + data). NUNCA modula nota. Só aparece no card.
 *
 *   3. OPINIÃO com mercado_alvo que o nosso motor cobre = ajuste na NOTA, decomposto e visível:
 *        · 1 analista:  ±4 no máximo
 *        · consenso 2+: até +8 (a favor) / −12 (contra)
 *      Assimetria proposital: a dúvida freia mais do que o entusiasmo empurra. E o ajuste NUNCA,
 *      sozinho, empurra a nota pra faixa sólida (80+) — verde é solidez do modelo, não do palpite.
 *
 * Além disso: CLÁUSULA DA RESSURREIÇÃO (consenso forte ressuscita entrada reprovada só por
 * divergência de modelos) e PESO DINÂMICO (recalibra a cada 30 palpites, 2..15, nunca zera).
 *
 * Módulo puro (Node/Deno). Consome linhas de `analista_extracoes` já filtradas pra janela.
 */
import { familiaDoMercado, partesLinha, rotuloMercado, MERCADOS_AH } from './tipos.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Convicção → fator de voto. */
const CONV_FATOR = { baixa: 0.5, media: 1.0, alta: 1.5 };
/** Peso do analista (2..15) → fator relativo ao neutro (peso 8 = 1.0). */
export const pesoFator = (peso) => clamp((peso ?? 8) / 8, 0.25, 1.9);

/** Janela de consenso de FATOS: 48h. */
const CONSENSO_MS = 48 * 3600 * 1000;

/**
 * Um mercado é "do nosso motor" se a matriz/heurística sabe respondê-lo: resultado, dupla chance,
 * linhas de gols/escanteios, handicap. Cartões, escanteios por tempo (HT), etc. ficam de fora —
 * contam no placar do analista, mas NÃO modulam a nota (não há entrada nossa correspondente).
 */
export function mercadoNoNossoMotor(mercado) {
  const m = String(mercado ?? '');
  if (!m) return false;
  if (['dupla_chance_casa', 'dupla_chance_fora', 'resultado_casa', 'resultado_fora'].includes(m)) return true;
  if (MERCADOS_AH.includes(m)) return true;
  return Boolean(partesLinha(m)); // over/under de gols ou escanteios (esc_)
}

/** Chave de uma perna no índice: jogo + mercado. */
const chavePerna = (jogoId, mercado) => `${jogoId}|${mercado}`;

/**
 * Índice das extrações por jogo (partida) e por (jogo, mercado). Recebe as linhas cruas de
 * analista_extracoes já restritas à janela do dia. `distintosPorMercado` guarda opiniões separadas
 * por direção contando ANALISTAS distintos (dois vídeos do mesmo canal não viram "consenso").
 */
export function indexarExtracoes(extracoes) {
  const porJogo = new Map();       // partida → { fatos, dados_citados, opinioes }
  const porMercado = new Map();    // "jogoId|mercado" → [opinioes]
  for (const e of extracoes ?? []) {
    const partida = e.partida ?? null;
    if (partida) {
      if (!porJogo.has(partida)) porJogo.set(partida, { fatos: [], dados_citados: [], opinioes: [] });
      const bucket = porJogo.get(partida);
      if (e.tipo === 'fato') bucket.fatos.push(e);
      else if (e.tipo === 'dado_citado') bucket.dados_citados.push(e);
      else bucket.opinioes.push(e);
    }
    if (e.tipo === 'opiniao' && e.mercado_alvo && (e.jogo_id != null || partida)) {
      const k = chavePerna(e.jogo_id ?? partida, e.mercado_alvo);
      if (!porMercado.has(k)) porMercado.set(k, []);
      porMercado.get(k).push(e);
    }
  }
  return { porJogo, porMercado };
}

/**
 * Ajuste da nota de UMA perna pelas opiniões de mercado_alvo igual. Decomposto e assimétrico.
 * Retorna { ajuste, componentes } — ajuste é inteiro (p.p. na nota); componentes descreve pra tela.
 */
export function ajusteDaPerna(perna, opinioes, pesoPorAnalista = {}) {
  if (!mercadoNoNossoMotor(perna.mercado)) return { ajuste: 0, componentes: null };
  const rel = (opinioes ?? []).filter((o) => o.direcao === 'a_favor' || o.direcao === 'contra');
  if (!rel.length) return { ajuste: 0, componentes: null };

  const votoDe = (o) => (CONV_FATOR[o.conviccao] ?? 1.0) * pesoFator(pesoPorAnalista[o.analista_id]);
  const favor = rel.filter((o) => o.direcao === 'a_favor');
  const contra = rel.filter((o) => o.direcao === 'contra');
  const nA = new Set(favor.map((o) => o.analista_id)).size;
  const nC = new Set(contra.map((o) => o.analista_id)).size;
  const Sa = favor.reduce((s, o) => s + votoDe(o), 0);
  const Sc = contra.reduce((s, o) => s + votoDe(o), 0);

  // Tetos: 1 analista limita a ±4; consenso (2+) abre até +8 a favor / −12 contra (a dúvida
  // freia mais do que o entusiasmo empurra). 4 pontos por "voto" cheio (convicção média, peso 8).
  const tetoPos = nA >= 2 ? 8 : 4;
  const tetoNeg = nC >= 2 ? 12 : 4;
  const ajustePos = Math.min(tetoPos, Math.round(4 * Sa));
  const ajusteNeg = Math.min(tetoNeg, Math.round(4 * Sc));
  const ajuste = ajustePos - ajusteNeg;
  if (ajuste === 0) return { ajuste: 0, componentes: null };

  return {
    ajuste,
    componentes: {
      a_favor: nA, contra: nC,
      consenso: nA >= 2 || nC >= 2,
      soma_favor: +Sa.toFixed(2), soma_contra: +Sc.toFixed(2),
      ajuste_pos: ajustePos, ajuste_neg: ajusteNeg,
      opinioes: rel.map((o) => ({
        analista_id: o.analista_id, direcao: o.direcao, conviccao: o.conviccao, texto: o.texto_resumo,
      })),
    },
  };
}

/**
 * Aplica o ajuste à nota preservando a assimetria e a trava do verde: o ajuste positivo NUNCA
 * sozinho leva uma perna de <80 pra 80+. Retorna a nota nova + a decomposição "modelo X, analistas
 * ±Y" pra tela.
 */
export function aplicarAjusteNota(notaBase, ajuste) {
  if (!ajuste) return { nota: notaBase, nota_base: notaBase, ajuste: 0, teto_solida: false };
  let nova = clamp(notaBase + ajuste, 0, 100);
  let tetoSolida = false;
  if (ajuste > 0 && notaBase < 80 && nova >= 80) { nova = 79; tetoSolida = true; }
  return { nota: nova, nota_base: notaBase, ajuste, teto_solida: tetoSolida };
}

/**
 * FATOS CONSENSUAIS: agrupa fatos por (jogo, categoria) e marca consenso quando 2+ analistas
 * distintos falam a mesma coisa dentro de 48h. Devolve, por jogo, os grupos consensuais (alerta
 * laranja) e a lista de contradições (fato consensual com mercado_alvo + direção 'contra').
 */
export function fatosConsensuais(fatos, agoraMs) {
  const porCatJogo = new Map();
  for (const f of fatos ?? []) {
    const t = f.criado_em ? new Date(f.criado_em).getTime() : agoraMs;
    if (agoraMs - t > CONSENSO_MS) continue;
    const k = `${f.partida}|${f.categoria}`;
    if (!porCatJogo.has(k)) porCatJogo.set(k, []);
    porCatJogo.get(k).push(f);
  }
  const consensuais = [];
  for (const grupo of porCatJogo.values()) {
    const analistas = new Set(grupo.map((f) => f.analista_id));
    if (analistas.size >= 2) {
      consensuais.push({
        partida: grupo[0].partida,
        categoria: grupo[0].categoria,
        n_analistas: analistas.size,
        textos: grupo.map((f) => f.texto_resumo),
        // Contradição só quando o fato aponta um mercado que cobrimos, contra ele.
        contra: grupo
          .filter((f) => f.direcao === 'contra' && f.mercado_alvo && mercadoNoNossoMotor(f.mercado_alvo))
          .map((f) => ({ mercado: f.mercado_alvo, jogo_id: f.jogo_id ?? null, texto: f.texto_resumo })),
      });
    }
  }
  return consensuais;
}

/**
 * CLÁUSULA DA RESSURREIÇÃO. Uma entrada só pode voltar dos mortos se caiu EXCLUSIVAMENTE por
 * divergência de modelos (motivo com "divergem") E há consenso forte a favor: 3+ analistas
 * distintos, todos convicção alta, mesmo mercado, direção a_favor. Volta REBAIXADA, stake no piso,
 * origem 'analistas'. Nunca inventa entrada onde o método não avaliou nada.
 */
export function ressurreicoesPossiveis(reprovadas, porMercado) {
  const out = [];
  for (const p of reprovadas ?? []) {
    const soDivergencia = /diverg/i.test(String(p.motivo ?? ''));
    if (!soDivergencia) continue;
    const ops = porMercado.get(chavePerna(p.jogo_id, p.mercado)) ?? [];
    const aFavorAlta = ops.filter((o) => o.direcao === 'a_favor' && o.conviccao === 'alta');
    const analistas = new Set(aFavorAlta.map((o) => o.analista_id));
    if (analistas.size >= 3) {
      out.push({
        jogo_id: p.jogo_id, partida: p.partida, mercado: p.mercado,
        n_fontes: analistas.size,
        textos: aFavorAlta.map((o) => o.texto_resumo),
      });
    }
  }
  return out;
}

/**
 * PESO DINÂMICO — recalibra o peso (2..15) a cada 30 palpites liquidados, comparando o acerto do
 * analista ao implícito médio das odds dos palpites dele (a barra que o mercado já embutia). Acima
 * do implícito → sobe; abaixo → desce; nunca zera (o piso 2 é o direito à dúvida). Sem 30 palpites
 * ou sem odds pra ancorar, mantém o peso atual.
 *
 * @param acerto            taxa observada (0..1) nos liquidados com odd de mercado
 * @param implicitoMedio    média de (1/odd) dos mesmos palpites
 * @param nComOdd           quantos palpites entraram na conta
 * @param pesoAtual         peso vigente
 */
export function recalibrarPeso({ acerto, implicitoMedio, nComOdd, pesoAtual = 8 }) {
  if (nComOdd < 30 || acerto == null || implicitoMedio == null) {
    return { peso: pesoAtual, mudou: false, motivo: 'menos de 30 palpites com odd — mantém' };
  }
  // Edge do analista sobre o mercado, em p.p. Escala: cada +5 p.p. de edge ≈ +1 no peso, centrado
  // em 8. Saturação suave e clamp no [2,15].
  const edge = acerto - implicitoMedio;         // + = acerta mais do que a odd previa
  const bruto = 8 + edge * 100 / 5;
  const peso = +clamp(bruto, 2, 15).toFixed(1);
  return {
    peso, mudou: peso !== pesoAtual,
    edge_pp: +(edge * 100).toFixed(1),
    motivo: `acerto ${(acerto * 100).toFixed(0)}% vs implícito ${(implicitoMedio * 100).toFixed(0)}% (${nComOdd} palpites)`,
  };
}

/* ─────────────────────── PALPITE VIRTUAL (espelho de sugestoes) ─────────────────────── */

/**
 * Extração (opinião com mercado_alvo) → linha de analista_palpites_liquidados. Devolve null quando
 * a extração não é palpite liquidável (sem mercado_alvo, sem partida ou direção neutra).
 * odd_referencia/odd_e_mercado entram quando o dado de odds do dia tiver a linha (passado por fora).
 */
export function palpiteDaExtracao(e, { oddReferencia = null } = {}) {
  if (!e || e.tipo !== 'opiniao' || !e.mercado_alvo || !e.partida) return null;
  if (e.direcao !== 'a_favor' && e.direcao !== 'contra') return null;
  const noMotor = mercadoNoNossoMotor(e.mercado_alvo);
  const linha = partesLinha(e.mercado_alvo);
  const [casa, fora] = String(e.partida).split(' x ');
  return {
    extracao_id: e.id,
    analista_id: e.analista_id,
    data: e.jogo_data ?? null,
    jogo_id: e.jogo_id != null ? String(e.jogo_id) : null,
    partida: e.partida,
    casa: casa ?? null,
    fora: fora ?? null,
    mercado: e.mercado_alvo,
    rotulo: noMotor ? rotuloMercado(e.mercado_alvo) : e.mercado_alvo,
    familia: noMotor ? familiaDoMercado(e.mercado_alvo) : 'fora_do_motor',
    linha: linha ? linha.linha : null,
    direcao: e.direcao,
    conviccao: e.conviccao ?? 'media',
    no_nosso_motor: noMotor,
    odd_referencia: oddReferencia,
    odd_e_mercado: oddReferencia != null,
    status: 'pendente',
  };
}

/**
 * Liquida um palpite de analista contra o placar real. Igual à liquidação das sugestões, mas
 * respeita a DIREÇÃO: 'contra' inverte (o analista acertou se o mercado NÃO bateu). Mercados fora
 * do nosso motor não têm como liquidar automaticamente → 'sem_liquidacao'.
 * Devolve 'ganhou' | 'perdeu' | 'sem_liquidacao' | null (null = ainda falta o dado).
 */
export function liquidarPalpiteAnalista(palpite, res) {
  if (!palpite.no_nosso_motor) return 'sem_liquidacao';
  const bateu = mercadoBateu(palpite.mercado, res);
  if (bateu == null) return null;
  const acertou = palpite.direcao === 'a_favor' ? bateu : !bateu;
  return acertou ? 'ganhou' : 'perdeu';
}

/** O mercado "bateu" (aconteceu)? true/false, ou null se falta o dado. Meia-linha: sem push. */
function mercadoBateu(mercado, res) {
  const linha = partesLinha(mercado);
  if (linha && linha.familia === 'escanteios') {
    if (res.escanteiosTotal == null) return null;
    return linha.lado === 'over' ? res.escanteiosTotal > linha.linha : res.escanteiosTotal < linha.linha;
  }
  if (linha && linha.familia === 'gols') {
    if (res.golsCasa == null || res.golsFora == null) return null;
    const total = res.golsCasa + res.golsFora;
    return linha.lado === 'over' ? total > linha.linha : total < linha.linha;
  }
  if (res.golsCasa == null || res.golsFora == null) return null;
  if (mercado === 'dupla_chance_casa') return res.golsCasa >= res.golsFora;
  if (mercado === 'dupla_chance_fora') return res.golsFora >= res.golsCasa;
  if (mercado === 'resultado_casa') return res.golsCasa > res.golsFora;
  if (mercado === 'resultado_fora') return res.golsFora > res.golsCasa;
  return null;
}
