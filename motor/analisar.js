#!/usr/bin/env node
/**
 * BELLA BETS — motor de análise pré-jogo.
 *
 *   npm run analisar              → analisa hoje
 *   npm run analisar -- 2026-07-25 → analisa a data informada
 *   npm run analisar -- --demo     → força modo demo mesmo com chaves
 *
 * Pipeline: fixtures → histórico (cache) → heurística → Dixon-Coles → filtros → montador.
 * Grava data/analises/YYYY-MM-DD.json com TUDO: aprovados, descartados com motivo, bilhetes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

import { probHeuristica } from './lib/heuristica.js';
import { ajustarDixonColes, matrizPlacares, mercadosDaMatriz } from './lib/dixonColes.js';
import { avaliarPerna } from './lib/filtros.js';
import { montarBilhetes, cardsHandicap } from './lib/montador.js';
import { contagensDoJogo } from './lib/narrativa.js';
import { temChaves, gerarDemo, lerCache, gravarCache, buscarJogosDoDia, buscarHistoricoTime, buscarOddsDosJogos, cota, limitacoesPlano } from './lib/fontes.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_DADOS = path.join(RAIZ, 'data');

const args = process.argv.slice(2);
const forcarDemo = args.includes('--demo');
const dataAlvo = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);

const cfg = JSON.parse(fs.readFileSync(path.join(DIR_DADOS, 'config.json'), 'utf8'));
const ligasAtivas = cfg.ligas.filter((l) => l.ativa);
const MERCADOS = [...cfg.mercados_em_bilhete, 'ah_casa_m05', 'ah_casa_m10', 'ah_fora_p05'];

const log = (...a) => console.log(...a);
const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

async function main() {
  const modo = forcarDemo || !temChaves() ? 'demo' : 'real';
  log(`\n🎯 BELLA BETS — análise de ${dataAlvo}  [modo ${modo.toUpperCase()}]`);
  if (modo === 'demo') log('   (sem chaves de API — dados simulados, determinísticos por data)\n');
  else log('');

  // ── 1. Dados
  let jogos, historico, h2h, odds;
  let jogosPorLiga = {};
  if (modo === 'demo') {
    ({ jogos, historico, h2h, odds } = gerarDemo(dataAlvo, ligasAtivas));
  } else {
    const cache = lerCache(path.join(DIR_DADOS, 'historico_times.json'));
    jogos = await buscarJogosDoDia(ligasAtivas, dataAlvo);
    log(`   ${cota.football} req à API-Football (fixtures das ligas ativas)`);
    historico = {}; h2h = {};
    for (const j of jogos) {
      historico[j.casa] = await buscarHistoricoTime(j.casa_id, j.casa, cache);
      historico[j.fora] = await buscarHistoricoTime(j.fora_id, j.fora, cache);
      // H2H vem do bootstrap, chaveado por par de ids (a ordem do mando pode inverter).
      h2h[j.id] = cache.h2h?.[`${j.casa_id}-${j.fora_id}`] ?? cache.h2h?.[`${j.fora_id}-${j.casa_id}`] ?? [];
    }
    // Jogos da temporada por liga: base MUITO melhor pro Dixon-Coles do que juntar o
    // histórico dos 2 times do dia (que só enxerga um pedaço da liga).
    jogosPorLiga = Object.fromEntries(
      Object.values(cache.ligas ?? {}).map((l) => [l.nome, l.jogos ?? []])
    );
    const semCache = jogos.filter((j) => !(historico[j.casa] ?? []).length || !(historico[j.fora] ?? []).length);
    if (semCache.length) log(`   ⚠ ${semCache.length} jogo(s) com time fora do cache — rode: npm run bootstrap`);
    gravarCache(path.join(DIR_DADOS, 'historico_times.json'), cache);
    const res = await buscarOddsDosJogos(jogos);
    odds = res.odds;
    log(`   ${cota.football} req API-Football · ${cota.odds} req The Odds API (limite gratuito: 100/dia e 500/mês)`);
    const comOdds = Object.keys(odds).length;
    log(`   odds casadas: ${comOdds}/${jogos.length} jogos`);
    if (res.diagnostico.length) {
      log(`   ⚠ ${res.diagnostico.length} aviso(s) de odds:`);
      res.diagnostico.slice(0, 5).forEach((d) => log(`      · ${d}`));
    }
    const semHistorico = jogos.filter((j) => !(historico[j.casa] ?? []).length).length;
    if (limitacoesPlano.size) {
      log('');
      log('   ┌─ BLOQUEIO DO PLANO API-FOOTBALL ────────────────────────────────');
      [...limitacoesPlano].forEach((m) => log(`   │ ${m}`));
      log(`   │ ${semHistorico}/${jogos.length} jogos ficaram SEM histórico.`);
      log('   │ Sem os últimos 10 jogos não há heurística nem Dixon-Coles — o');
      log('   │ método inteiro depende disso. O sistema não vai aprovar perna');
      log('   │ nenhuma, e está certo: sem dado, não se aposta.');
      log('   └──────────────────────────────────────────────────────────────────');
    }
    log('');
  }

  if (!jogos.length) {
    log('Nenhum jogo encontrado nas ligas ativas para esta data.\n');
    gravarAnalise({ modo, jogos: [], pernas: [], resultado: { sem_bilhete: true, motivo: 'nenhum jogo nas ligas ativas hoje', bilhetes: [] }, cardsAH: [], dc: {} });
    return;
  }
  log(`📅 ${jogos.length} jogo(s) nas ligas ativas\n`);

  // ── 2. Dixon-Coles por liga
  const dcPorLiga = {};
  for (const liga of new Set(jogos.map((j) => j.liga))) {
    const daLiga = jogos.filter((j) => j.liga === liga);
    const times = new Set(daLiga.flatMap((j) => [j.casa, j.fora]));
    // Preferência: temporada inteira da liga (bootstrap). Só cai pro histórico dos times do
    // dia quando o cache não tem a liga — aí a amostra é menor e o modelo pode se declarar
    // indisponível, que é o comportamento certo.
    const jogosLiga = [...(jogosPorLiga[liga] ?? [])];
    const vistos = new Set(jogosLiga.map((jg) => `${jg.data}|${jg.casa}|${jg.fora}`));
    for (const t of times) {
      for (const jg of historico[t] ?? []) {
        const chave = `${jg.data}|${jg.casa}|${jg.fora}`;
        if (!vistos.has(chave)) { vistos.add(chave); jogosLiga.push(jg); }
      }
    }
    const modelo = ajustarDixonColes(jogosLiga, {
      xi: cfg.dixon_coles.xi,
      minJogos: cfg.dixon_coles.min_jogos_liga,
      hoje: new Date(dataAlvo),
    });
    dcPorLiga[liga] = modelo;
    log(`   ${modelo.disponivel ? '✓' : '✗'} Dixon-Coles ${liga}: ${modelo.disponivel ? `ajustado (${modelo.n_jogos} jogos)` : modelo.motivo}`);
  }
  log('');

  // ── 3. Pernas
  const pernas = [];
  const matrizes = {};
  for (const jogo of jogos) {
    const modelo = dcPorLiga[jogo.liga];
    const matriz = matrizPlacares(modelo, jogo.casa, jogo.fora, cfg.dixon_coles.max_gols_matriz);
    matrizes[jogo.id] = matriz;
    const probsDC = mercadosDaMatriz(matriz);

    for (const mercado of MERCADOS) {
      // Heurística de verdade pra TODO mercado, inclusive handicap. Alimentar o handicap com
      // a própria saída do Dixon-Coles tornaria o filtro de concordância decorativo.
      const h = probHeuristica({
        mercado,
        casa: jogo.casa, fora: jogo.fora, historico, h2h: h2h[jogo.id], pesos: cfg.pesos_heuristica,
      });
      if (h.prob == null) continue;
      pernas.push(
        avaliarPerna({
          jogo, mercado,
          odd: odds[jogo.id]?.[mercado] ?? null,
          probH: h.prob,
          probDC: probsDC?.[mercado] ?? null,
          probPush: mercado === 'ah_casa_m10' ? (probsDC?.ah_casa_m10_push ?? 0) : 0,
          amostraMando: h.amostra_mando,
          filtros: { ...cfg.filtros, mercados_em_bilhete: cfg.mercados_em_bilhete },
        })
      );
    }
  }

  const aprovadas = pernas.filter((p) => p.aprovada);
  log(`🔍 ${pernas.length} perna(s) avaliada(s) → ${aprovadas.length} aprovada(s), ${pernas.length - aprovadas.length} descartada(s)\n`);

  // ── 4. Bilhetes + cards de handicap
  const resultado = montarBilhetes({ aprovadas, matrizes, config: cfg, banca: cfg.banca });
  const cardsAH = cardsHandicap({ todasPernas: pernas, config: cfg, banca: cfg.banca });

  if (resultado.sem_bilhete) {
    log('🚫 SEM BILHETE HOJE');
    log(`   ${resultado.motivo}\n`);
  } else {
    log(`🎟️  ${resultado.bilhetes.length} bilhete(s) — exposição R$ ${resultado.exposicao.total_rs} (${resultado.exposicao.pct_banca}% da banca, teto ${resultado.exposicao.teto_pct}%)\n`);
    for (const b of resultado.bilhetes) {
      log(`   ── BILHETE ${b.ordem} ─ odd ${b.odd_total.toFixed(2)} · prob ${pct(b.prob_combinada)} · EV +${b.ev_pct.toFixed(1)}% · stake R$ ${b.stake_rs}${b.todas_confianca_maxima ? ' · CONFIANÇA MÁXIMA' : ''}`);
      for (const p of b.pernas) log(`      • ${p.partida} — ${p.mercado} @ ${p.odd} · ${p.justificativa}`);
      if (b.correlacao_intra_jogo) log('      ↳ pernas do mesmo jogo: prob conjunta pela matriz de placares (não multiplicação)');
      log('');
    }
  }
  if (cardsAH.length) {
    log(`⚡ ${cardsAH.length} alternativa(s) em SIMPLES (handicap asiático — fora do bilhete):`);
    for (const c of cardsAH) log(`   • ${c.partida} — ${c.mercado} @ ${c.odd} · EV +${c.ev_pct.toFixed(1)}% (${c.vantagem_pp} p.p. acima da dupla chance)`);
    log('');
  }

  gravarAnalise({ modo, jogos, historico, pernas, resultado, cardsAH, dc: dcPorLiga });
  log(`💾 data/analises/${dataAlvo}.json gravado\n`);
}

function gravarAnalise({ modo, jogos, historico, pernas, resultado, cardsAH, dc }) {
  const saida = {
    data: dataAlvo,
    modo,
    gerado_em: new Date().toISOString(),
    banca_no_momento: cfg.banca,
    // Uma análise só é interpretável junto dos parâmetros que a produziram: mudar a faixa de
    // odd ou o EV mínimo muda o veredito do mesmo jogo. Fica gravado com o resultado.
    config_efetivo: { filtros: cfg.filtros, pesos_heuristica: cfg.pesos_heuristica, dixon_coles: cfg.dixon_coles },
    resumo: {
      jogos: jogos.length,
      pernas_avaliadas: pernas.length,
      aprovadas: pernas.filter((p) => p.aprovada).length,
      descartadas: pernas.filter((p) => !p.aprovada).length,
      bilhetes: resultado.bilhetes?.length ?? 0,
      sem_bilhete: Boolean(resultado.sem_bilhete),
    },
    dixon_coles_por_liga: Object.fromEntries(
      Object.entries(dc).map(([liga, m]) => [liga, { disponivel: m.disponivel, motivo: m.motivo ?? null, n_jogos: m.n_jogos ?? 0 }])
    ),
    jogos: jogos.map((j) => ({ ...j, contagens: contagensDoJogo(j, historico) })),
    pernas,
    bilhetes: resultado.bilhetes ?? [],
    sem_bilhete: resultado.sem_bilhete ? { motivo: resultado.motivo } : null,
    exposicao: resultado.exposicao ?? null,
    cards_handicap: cardsAH,
  };
  const dir = path.join(DIR_DADOS, 'analises');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${dataAlvo}.json`), JSON.stringify(saida, null, 2));
}

main().catch((e) => { console.error('\n❌ Erro:', e.message, '\n'); process.exit(1); });
