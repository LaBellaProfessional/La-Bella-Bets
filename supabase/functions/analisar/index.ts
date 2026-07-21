// BELLA BETS — edge function `analisar`
//
// Porta o `npm run analisar` pra nuvem. O MÉTODO é o mesmo código: os módulos de
// _shared/ são cópia literal de motor/lib/. O que muda é só de onde vem e pra onde vai o
// dado — Postgres no lugar de arquivo.
//
//   POST /functions/v1/analisar            → analisa hoje
//   POST { "data": "2026-07-22" }          → analisa a data
//   POST { "demo": true }                  → força modo demo
//
// Disparo: cron diário (09:00 America/Sao_Paulo) ou botão "Analisar agora" no dash.

import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-nocheck — os módulos do método são JS puro, copiados sem alteração de propósito.
import { probHeuristica } from '../_shared/heuristica.js';
import { ajustarDixonColes, matrizPlacares, mercadosDaMatriz } from '../_shared/dixonColes.js';
import { avaliarPerna } from '../_shared/filtros.js';
import { montarBilhetes, cardsHandicap } from '../_shared/montador.js';
import {
  temChaves, gerarDemo, buscarJogosDoDia, buscarHistoricoTime,
  buscarOddsDosJogos, cota, limitacoesPlano,
} from '../_shared/fontes.js';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const hojeSP = () =>
  new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
    .toISOString().slice(0, 10);

Deno.serve(async (req) => {
  const t0 = Date.now();
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { /* sem corpo = hoje */ }

  // Só service_role (cron/admin) ou sessão de usuário válida. Sem isso, qualquer um com a
  // URL dispara análise e queima a cota das APIs pagas.
  const auth = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const ehServico = auth === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!ehServico) {
    const { data: u } = await sb.auth.getUser(auth);
    if (!u?.user) return Response.json({ ok: false, erro: 'não autenticado' }, { status: 401 });
  }

  const dataAlvo = (corpo.data as string) ?? hojeSP();
  const forcarDemo = Boolean(corpo.demo);
  const disparo = corpo.disparo === 'cron' ? 'cron' : 'manual';
  // Reproduz o ajuste do motor local: ignora modelo_params e refaz o fit com a temporada da
  // liga MAIS o histórico dos times do dia. É o modo usado pra provar que o porte não mexeu
  // no método; a operação diária usa os parâmetros salvos (barato).
  const fitLocal = Boolean(corpo.fit_local);

  const { data: exec } = await sb.from('execucoes')
    .insert({ funcao: 'analisar', disparo }).select('id').single();

  try {
    // ── config
    const { data: cfgRow, error: eCfg } = await sb.from('config').select('*').eq('id', 1).single();
    if (eCfg) throw new Error(`config: ${eCfg.message}`);
    const cfg = {
      banca: Number(cfgRow.banca),
      stake_padrao_pct: Number(cfgRow.stake_padrao_pct),
      stake_confianca_maxima_pct: Number(cfgRow.stake_confianca_maxima_pct),
      teto_exposicao_diaria_pct: Number(cfgRow.teto_exposicao_diaria_pct),
      filtros: cfgRow.filtros,
      pesos_heuristica: cfgRow.pesos_heuristica,
      dixon_coles: cfgRow.dixon_coles,
      mercados_em_bilhete: cfgRow.mercados_em_bilhete,
      ligas: cfgRow.ligas,
    };
    const ligasAtivas = (cfg.ligas as any[]).filter((l) => l.ativa);
    const MERCADOS = [...(cfg.mercados_em_bilhete as string[]), 'ah_casa_m05', 'ah_casa_m10', 'ah_fora_p05'];

    const modo = forcarDemo || !temChaves() ? 'demo' : 'real';

    // ── dados
    let jogos: any[], historico: Record<string, any[]>, h2h: Record<string, any[]>, odds: any;
    let jogosPorLiga: Record<string, any[]> = {};
    const avisos: string[] = [];

    if (modo === 'demo') {
      ({ jogos, historico, h2h, odds } = gerarDemo(dataAlvo, ligasAtivas));
    } else {
      const [{ data: times }, { data: ligasCache }, { data: h2hCache }] = await Promise.all([
        sb.from('historico_times').select('time_nome,jogos'),
        sb.from('historico_ligas').select('liga_id,nome,jogos'),
        sb.from('historico_h2h').select('par,jogos'),
      ]);
      const cache = {
        times: Object.fromEntries((times ?? []).map((t) => [t.time_nome, t.jogos])),
        h2h: Object.fromEntries((h2hCache ?? []).map((h) => [h.par, h.jogos])),
      };
      jogosPorLiga = Object.fromEntries((ligasCache ?? []).map((l) => [l.nome, l.jogos ?? []]));

      jogos = await buscarJogosDoDia(ligasAtivas, dataAlvo);
      historico = {}; h2h = {};
      for (const j of jogos) {
        historico[j.casa] = await buscarHistoricoTime(j.casa_id, j.casa, cache);
        historico[j.fora] = await buscarHistoricoTime(j.fora_id, j.fora, cache);
        h2h[j.id] = cache.h2h[`${j.casa_id}-${j.fora_id}`] ?? cache.h2h[`${j.fora_id}-${j.casa_id}`] ?? [];
      }
      const res = await buscarOddsDosJogos(jogos);
      odds = res.odds;
      avisos.push(...res.diagnostico);
      if (limitacoesPlano.size) avisos.push(...[...limitacoesPlano]);
    }

    // ── Dixon-Coles: usa os parâmetros já ajustados (modelo_params). Ajustar 10 ligas aqui
    // dentro estouraria o tempo limite da function — o refit é semanal, no bootstrap.
    const { data: paramsRows } = await sb.from('modelo_params').select('*');
    const paramsPorLiga = Object.fromEntries((paramsRows ?? []).map((p) => [p.liga, p]));

    const dcPorLiga: Record<string, any> = {};
    for (const liga of new Set(jogos.map((j) => j.liga))) {
      const salvo = fitLocal ? null : paramsPorLiga[liga];
      if (salvo?.disponivel) {
        dcPorLiga[liga] = {
          disponivel: true, ataque: salvo.ataque, defesa: salvo.defesa,
          mando: Number(salvo.mando), rho: Number(salvo.rho), n_jogos: salvo.n_jogos,
        };
        continue;
      }
      // Sem parâmetro salvo, o modelo fica INDISPONÍVEL — e o método já sabe lidar com isso
      // (opera só com heurística, com confiança rebaixada).
      //
      // Ajustar aqui dentro NÃO é opção: o fit é numérico e pesado (a Champions tem 336 jogos
      // e 42 times) e derruba a function com WORKER_RESOURCE_LIMIT. Quem ajusta é o bootstrap,
      // fora do caminho crítico. Se caiu aqui, é sinal de rodar o refit — não de improvisar.
      dcPorLiga[liga] = {
        disponivel: false,
        motivo: salvo?.motivo ?? 'sem parâmetros ajustados para esta liga — rode o bootstrap (refit)',
        n_jogos: salvo?.n_jogos ?? 0,
      };
    }

    // ── pernas (idêntico ao local)
    const pernas: any[] = [];
    const matrizes: Record<string, any> = {};
    for (const jogo of jogos) {
      const matriz = matrizPlacares(dcPorLiga[jogo.liga], jogo.casa, jogo.fora, (cfg.dixon_coles as any).max_gols_matriz);
      matrizes[jogo.id] = matriz;
      const probsDC = mercadosDaMatriz(matriz);
      for (const mercado of MERCADOS) {
        const h = probHeuristica({
          mercado, casa: jogo.casa, fora: jogo.fora,
          historico, h2h: h2h[jogo.id], pesos: cfg.pesos_heuristica,
        });
        if (h.prob == null) continue;
        pernas.push(avaliarPerna({
          jogo, mercado,
          odd: odds[jogo.id]?.[mercado] ?? null,
          probH: h.prob,
          probDC: probsDC?.[mercado] ?? null,
          probPush: mercado === 'ah_casa_m10' ? (probsDC?.ah_casa_m10_push ?? 0) : 0,
          amostraMando: h.amostra_mando,
          filtros: { ...(cfg.filtros as any), mercados_em_bilhete: cfg.mercados_em_bilhete },
        }));
      }
    }

    const aprovadas = pernas.filter((p) => p.aprovada);
    const resultado = montarBilhetes({ aprovadas, matrizes, config: cfg, banca: cfg.banca });
    const cardsAH = cardsHandicap({ todasPernas: pernas, config: cfg, banca: cfg.banca });

    const payload = {
      data: dataAlvo, modo, gerado_em: new Date().toISOString(), banca_no_momento: cfg.banca,
      config_efetivo: { filtros: cfg.filtros, pesos_heuristica: cfg.pesos_heuristica, dixon_coles: cfg.dixon_coles },
      dixon_coles_por_liga: Object.fromEntries(
        Object.entries(dcPorLiga).map(([l, m]: any) => [l, { disponivel: m.disponivel, motivo: m.motivo ?? null, n_jogos: m.n_jogos ?? 0 }]),
      ),
      jogos, pernas,
      bilhetes: resultado.bilhetes ?? [],
      sem_bilhete: resultado.sem_bilhete ? { motivo: resultado.motivo } : null,
      exposicao: resultado.exposicao ?? null,
      cards_handicap: cardsAH,
      avisos,
    };
    const resumo = {
      jogos: jogos.length,
      pernas_avaliadas: pernas.length,
      aprovadas: aprovadas.length,
      descartadas: pernas.length - aprovadas.length,
      bilhetes: resultado.bilhetes?.length ?? 0,
      sem_bilhete: Boolean(resultado.sem_bilhete),
    };

    await sb.from('analises').upsert({ data: dataAlvo, modo, resumo, payload, gerado_em: new Date().toISOString() });
    await sb.from('execucoes').update({
      terminado_em: new Date().toISOString(), ok: true,
      req_football: cota.football, req_odds: cota.odds,
      detalhe: { ...resumo, ms: Date.now() - t0 },
    }).eq('id', exec?.id);

    return Response.json({ ok: true, data: dataAlvo, modo, resumo, req: { football: cota.football, odds: cota.odds }, ms: Date.now() - t0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('execucoes').update({
      terminado_em: new Date().toISOString(), ok: false, detalhe: { erro: msg },
    }).eq('id', exec?.id);
    return Response.json({ ok: false, erro: msg }, { status: 500 });
  }
});
