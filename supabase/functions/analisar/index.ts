// BELLA BETS — edge function `analisar`
//
// JANELA D+0..D+3 (pilar timing). O mesmo jogo é reanalisado a cada dia até a véspera;
// a trajetória da odd fica em odds_trajetoria (primeira vista, melhor vista, atual).
//
// Custo: as odds da janela inteira vêm na MESMA chamada por liga (a The Odds API devolve
// os próximos ~9 dias de uma vez), então ampliar a janela não custa crédito de odds —
// só +1 request de fixtures por dia extra na API-Football.
//
//   POST {}                        → janela padrão (config.filtros.dias_janela)
//   POST { "data": "2026-07-22" }  → só esse dia
//   POST { "dias": 1 }             → só hoje
//   POST { "demo": true }          → modo demo

import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-nocheck — os módulos do método são JS puro, copiados sem alteração de propósito.
import { probHeuristica } from '../_shared/heuristica.js';
import { matrizPlacares, mercadosDaMatriz, probTotalDaMatriz } from '../_shared/dixonColes.js';
import { pernasEscanteios } from '../_shared/escanteios.js';
import { avaliarPerna } from '../_shared/filtros.js';
import { montarBilhetes, cardsHandicap } from '../_shared/montador.js';
import { contagensDoJogo } from '../_shared/narrativa.js';
import {
  temChaves, gerarDemo, buscarJogosDoDia, buscarHistoricoTime,
  buscarOddsDosJogos, cota, limitacoesPlano,
} from '../_shared/fontes.js';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

// CORS: o dash roda em bella-bets-maikon.netlify.app e chama daqui. Sem responder o
// preflight (OPTIONS) e sem devolver os cabecalhos em TODA resposta, o Safari aborta a
// chamada antes de ela sair — vira 'Load failed' no iPhone, sem log nenhum no servidor.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });


const hojeSP = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

const somarDias = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const t0 = Date.now();
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch { /* sem corpo = janela padrão */ }

  const auth = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const ehServico = auth === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!ehServico) {
    const { data: u } = await sb.auth.getUser(auth);
    if (!u?.user) return json({ ok: false, erro: 'não autenticado' }, 401);
  }

  const forcarDemo = Boolean(corpo.demo);
  const disparo = corpo.disparo === 'cron' ? 'cron' : 'manual';

  const { data: exec } = await sb.from('execucoes')
    .insert({ funcao: 'analisar', disparo }).select('id').single();

  try {
    const { data: cfgRow, error: eCfg } = await sb.from('config').select('*').eq('id', 1).single();
    if (eCfg) throw new Error(`config: ${eCfg.message}`);
    const cfg = {
      banca: Number(cfgRow.banca),
      stake_padrao_pct: Number(cfgRow.stake_padrao_pct),
      stake_confianca_maxima_pct: Number(cfgRow.stake_confianca_maxima_pct),
      teto_exposicao_diaria_pct: Number(cfgRow.teto_exposicao_diaria_pct),
      filtros: cfgRow.filtros, pesos_heuristica: cfgRow.pesos_heuristica,
      dixon_coles: cfgRow.dixon_coles, mercados_em_bilhete: cfgRow.mercados_em_bilhete,
      ligas: cfgRow.ligas,
    };
    const ligasAtivas = (cfg.ligas as any[]).filter((l) => l.ativa);
    // Mercados de chave fixa. Os de GOLS não entram aqui: a linha cotada varia por jogo
    // (a casa publica 2.5 num, 1.5 e 2.5 noutro), então são descobertos das odds recebidas.
    const MERCADOS_FIXOS = [
      ...(cfg.mercados_em_bilhete as string[]).filter((m: string) => !/^(over|under)_/.test(m)),
      'ah_casa_m05', 'ah_casa_m10', 'ah_fora_p05',
    ];
    const evAntecipado = Number((cfg.filtros as any).ev_minimo_antecipado ?? 1.06);

    const base = (corpo.data as string) ?? hojeSP();
    const nDias = corpo.data ? 1 : Number(corpo.dias ?? (cfg.filtros as any).dias_janela ?? 4);
    const datas = Array.from({ length: nDias }, (_, i) => somarDias(base, i));
    const modo = forcarDemo || !temChaves() ? 'demo' : 'real';

    // ── 1. Fixtures de TODA a janela (1 request por dia) + cache
    const jogosPorData: Record<string, any[]> = {};
    let historico: Record<string, any[]> = {};
    let h2h: Record<string, any[]> = {};
    let odds: any = {};
    let jogosPorLiga: Record<string, any[]> = {};
    const avisos: string[] = [];

    if (modo === 'demo') {
      for (const d of datas) {
        const g = gerarDemo(d, ligasAtivas);
        jogosPorData[d] = g.jogos;
        historico = { ...historico, ...g.historico };
        h2h = { ...h2h, ...g.h2h };
        odds = { ...odds, ...g.odds };
      }
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

      // Busca por dia UTC, agrupa por dia de SAO PAULO. Um dia SP comeca as 03:00 UTC, entao
      // pra cobrir a janela inteira precisamos de um dia UTC a mais no fim.
      const diasUTC = [...datas, somarDias(base, nDias)];
      const brutos: any[] = [];
      for (const d of diasUTC) brutos.push(...await buscarJogosDoDia(ligasAtivas, d));
      const vistosId = new Set<string>();
      for (const d of datas) jogosPorData[d] = [];
      for (const j of brutos) {
        if (vistosId.has(j.id)) continue;
        vistosId.add(j.id);
        if (jogosPorData[j.data]) jogosPorData[j.data].push(j);   // j.data ja e o dia SP
      }
      for (const d of datas) jogosPorData[d].sort((a, b) => (a.inicio ?? '').localeCompare(b.inicio ?? ''));

      const todosJogos = datas.flatMap((d) => jogosPorData[d]);
      for (const j of todosJogos) {
        historico[j.casa] = await buscarHistoricoTime(j.casa_id, j.casa, cache);
        historico[j.fora] = await buscarHistoricoTime(j.fora_id, j.fora, cache);
        h2h[j.id] = cache.h2h[`${j.casa_id}-${j.fora_id}`] ?? cache.h2h[`${j.fora_id}-${j.casa_id}`] ?? [];
      }

      // ── 2. Odds da janela INTEIRA numa tacada: a API devolve os próximos dias na mesma
      // resposta, então agrupar por liga (não por dia) é o que mantém o custo igual ao de antes.
      const res = await buscarOddsDosJogos(todosJogos, (cfg.filtros as any).casa_preferida ?? null);
      odds = res.odds;
      avisos.push(...res.diagnostico);
      if (limitacoesPlano.size) avisos.push(...[...limitacoesPlano]);

      // ── 3. Trajetória da odd (pilar timing)
      for (const j of todosJogos) {
        for (const [mercado, odd] of Object.entries(odds[j.id] ?? {})) {
          if (odd == null) continue;
          await sb.rpc('registrar_odd', {
            p_jogo_id: j.id, p_mercado: mercado, p_odd: odd,
            p_partida: `${j.casa} x ${j.fora}`, p_liga: j.liga, p_data_jogo: j.data,
          });
        }
      }
    }

    // ── 3b. Escanteios: histórico por time, direto do cache (não gasta API na análise).
    // Indexado por nome de time igual ao histórico de gols, então o módulo de escanteios
    // recebe a mesma forma de dado que a heurística já consome.
    const escanteios: Record<string, any[]> = {};
    const escPorPar: Record<string, any[]> = {};
    {
      const { data: rows } = await sb.from('historico_escanteios')
        .select('data,casa,fora,esc_casa,esc_fora').order('data', { ascending: false });
      for (const r of rows ?? []) {
        (escanteios[r.casa] ??= []).push(r);
        (escanteios[r.fora] ??= []).push(r);
        const par = [r.casa, r.fora].sort().join('|');
        (escPorPar[par] ??= []).push(r);
      }
    }

    // ── 4. Dixon-Coles: só parâmetros salvos (ajustar aqui derruba a function)
    const { data: paramsRows } = await sb.from('modelo_params').select('*');
    const paramsPorLiga = Object.fromEntries((paramsRows ?? []).map((p) => [p.liga, p]));
    const dcDe = (liga: string) => {
      const s = paramsPorLiga[liga];
      return s?.disponivel
        ? { disponivel: true, ataque: s.ataque, defesa: s.defesa, mando: Number(s.mando), rho: Number(s.rho), n_jogos: s.n_jogos }
        : { disponivel: false, motivo: s?.motivo ?? 'sem parâmetros — rode o bootstrap (refit)', n_jogos: s?.n_jogos ?? 0 };
    };

    // ── 5. Uma análise por dia da janela
    const { data: trajRows } = await sb.from('odds_trajetoria').select('*');
    const traj = Object.fromEntries((trajRows ?? []).map((t) => [`${t.jogo_id}|${t.mercado}`, t]));
    const porDia: any[] = [];

    for (const [iDia, dataAlvo] of datas.entries()) {
      const jogos = jogosPorData[dataAlvo] ?? [];
      // Horizonte vem da DISTANCIA ate hoje, nao do indice do laco: analisar um dia isolado
      // (POST {data}) tem que continuar sabendo que aquele jogo e daqui a 3 dias.
      const horizonte = Math.max(0, Math.round(
        (new Date(dataAlvo + 'T12:00:00Z').getTime() - new Date(hojeSP() + 'T12:00:00Z').getTime()) / 864e5));
      const pernas: any[] = [];
      const matrizes: Record<string, any> = {};
      const dcPorLiga: Record<string, any> = {};

      for (const jogo of jogos) {
        dcPorLiga[jogo.liga] ??= dcDe(jogo.liga);
        const matriz = matrizPlacares(dcPorLiga[jogo.liga], jogo.casa, jogo.fora, (cfg.dixon_coles as any).max_gols_matriz);
        matrizes[jogo.id] = matriz;
        const probsDC = mercadosDaMatriz(matriz);

        // Linhas de gols efetivamente cotadas neste jogo (over_25, under_25, over_15…).
        // É o conserto do mercado de gols: antes o sistema perguntava por três linhas fixas,
        // duas das quais a API nunca publica — over 0.5 e under 4.5 morriam em "sem odd".
        const linhasGols = Object.keys(odds[jogo.id] ?? {}).filter((k) => /^(over|under)_\d+$/.test(k));
        const MERCADOS = [...MERCADOS_FIXOS, ...linhasGols];

        for (const mercado of MERCADOS) {
          const h = probHeuristica({
            mercado, casa: jogo.casa, fora: jogo.fora,
            historico, h2h: h2h[jogo.id], pesos: cfg.pesos_heuristica,
          });
          if (h.prob == null) continue;
          const p = avaliarPerna({
            jogo, mercado,
            odd: odds[jogo.id]?.[mercado] ?? null,
            // Linha de gols que não está na lista fixa do Dixon-Coles é calculada na hora
            // pela matriz de placares — o segundo modelo continua existindo pra ela.
            probH: h.prob, probDC: probsDC?.[mercado] ?? probTotalDaMatriz(matriz, mercado),
            probPush: mercado === 'ah_casa_m10' ? (probsDC?.ah_casa_m10_push ?? 0) : 0,
            amostraMando: h.amostra_mando,
            filtros: { ...(cfg.filtros as any), mercados_em_bilhete: cfg.mercados_em_bilhete },
          });

          // ── Regra de entrada antecipada: jogo a 1-3 dias tem escalação indefinida, então a
          // margem dobra. Não reprova a perna — segura no radar até a véspera, quando a
          // informação melhora e o EV é reavaliado com o time provável já conhecido.
          p.horizonte_dias = horizonte;
          p.casa_odd = odds[jogo.id]?._casas?.[mercado] ?? null;   // de qual bookmaker veio
          if (p.aprovada && horizonte > 0 && (p.ev ?? 0) < evAntecipado) {
            p.elegivel_bilhete = false;
            p.radar = true;
            p.motivo_radar = `EV ${(((p.ev ?? 1) - 1) * 100).toFixed(1)}% abaixo dos ${((evAntecipado - 1) * 100).toFixed(0)}% exigidos a ${horizonte} dia(s) do jogo — aguardar véspera (escalação)`;
          }

          const t = traj[`${jogo.id}|${mercado}`];
          if (t) {
            p.trajetoria = {
              primeira_odd: Number(t.primeira_odd), melhor_odd: Number(t.melhor_odd),
              odd_atual: p.odd, observacoes: t.n_observacoes,
              idade_horas: Math.round((Date.now() - new Date(t.primeira_vista_em).getTime()) / 36e5),
              movimento: p.odd != null ? +(p.odd - Number(t.primeira_odd)).toFixed(2) : null,
            };
          }
          pernas.push(p);
        }

        // ── ESCANTEIOS: caminho próprio, sem odd de mercado. Não passa por avaliarPerna
        // porque os dois filtros centrais de lá (EV e divergência entre modelos) precisam de
        // um preço publicado. Aqui o preço é o que o Maikon digitar na tela.
        for (const p of pernasEscanteios({
          jogo, escanteios, h2hEsc: escPorPar[[jogo.casa, jogo.fora].sort().join('|')] ?? [],
          pesos: cfg.pesos_heuristica, filtros: cfg.filtros as any,
          banca: cfg.banca, stakePct: cfg.stake_padrao_pct,
        })) {
          p.horizonte_dias = horizonte;
          // A regra de entrada antecipada vale igual: escalação indefinida muda escanteio
          // tanto quanto muda gol. Sem EV pra comparar, o critério é a própria convicção.
          if (p.aprovada && horizonte > 0) {
            p.radar = true;
            p.motivo_radar = `escanteios a ${horizonte} dia(s) do jogo — aguardar a véspera (escalação muda ritmo e volume de ataque)`;
          }
          pernas.push(p);
        }
      }

      const aprovadas = pernas.filter((p) => p.aprovada);
      const resultado = montarBilhetes({ aprovadas, matrizes, config: cfg, banca: cfg.banca });
      const cardsAH = cardsHandicap({ todasPernas: pernas, config: cfg, banca: cfg.banca });
      const radar = pernas.filter((p) => p.radar);

      const resumo = {
        jogos: jogos.length, pernas_avaliadas: pernas.length,
        aprovadas: aprovadas.length, descartadas: pernas.length - aprovadas.length,
        bilhetes: resultado.bilhetes?.length ?? 0,
        sem_bilhete: Boolean(resultado.sem_bilhete),
        radar: radar.length, horizonte_dias: horizonte,
      };
      const payload = {
        data: dataAlvo, modo, gerado_em: new Date().toISOString(), banca_no_momento: cfg.banca,
        horizonte_dias: horizonte,
        // resumo vai TAMBEM aqui dentro, nao so na coluna: o dash le o payload inteiro e
        // esperava este campo. Gravar so na coluna deixava analise.resumo undefined no front
        // e derrubava a tela Hoje ("can t access property jogos").
        resumo,
        config_efetivo: { filtros: cfg.filtros, pesos_heuristica: cfg.pesos_heuristica, dixon_coles: cfg.dixon_coles },
        dixon_coles_por_liga: Object.fromEntries(
          Object.entries(dcPorLiga).map(([l, m]: any) => [l, { disponivel: m.disponivel, motivo: m.motivo ?? null, n_jogos: m.n_jogos ?? 0 }]),
        ),
        // Contagens por jogo: e o que vira frase de apostador na aba Analises
        // ("nao perde em casa ha 9 de 10"), sem o dash precisar do historico inteiro.
        jogos: jogos.map((j: any) => ({ ...j, contagens: contagensDoJogo(j, historico) })),
        pernas, radar,
        bilhetes: resultado.bilhetes ?? [],
        sem_bilhete: resultado.sem_bilhete ? { motivo: resultado.motivo } : null,
        exposicao: resultado.exposicao ?? null,
        cards_handicap: cardsAH, avisos,
      };

      await sb.from('analises').upsert({ data: dataAlvo, modo, resumo, payload, gerado_em: new Date().toISOString() });
      porDia.push({ data: dataAlvo, horizonte, ...resumo });
    }

    await sb.from('execucoes').update({
      terminado_em: new Date().toISOString(), ok: true,
      req_football: cota.football, req_odds: cota.odds,
      detalhe: { janela: datas, por_dia: porDia, ms: Date.now() - t0 },
    }).eq('id', exec?.id);

    return json({ ok: true, janela: datas, modo, por_dia: porDia, req: { football: cota.football, odds: cota.odds }, ms: Date.now() - t0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('execucoes').update({
      terminado_em: new Date().toISOString(), ok: false, detalhe: { erro: msg },
    }).eq('id', exec?.id);
    return json({ ok: false, erro: msg }, 500);
  }
});
