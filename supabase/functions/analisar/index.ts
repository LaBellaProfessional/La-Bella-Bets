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
import { sugestaoDaPerna } from '../_shared/sugestoes.js';
import { calcularNota } from '../_shared/nota.js';
import {
  indexarExtracoes, ajusteDaPerna, aplicarAjusteNota, fatosConsensuais,
  ressurreicoesPossiveis, palpiteDaExtracao,
} from '../_shared/analistas.js';
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
    // MODO ODD MANUAL: set fixo avaliado quando o jogo NÃO tem linha da API. Só mercados que a
    // matriz/heurística respondem sem preço: dupla chance, 1x2 seco (com gatilho no filtro) e as
    // linhas de gols padrão. Sem AH aqui — é o mercado de maior variância e o pior sem odd pra ancorar.
    const MERCADOS_SEM_LINHA = [
      'dupla_chance_casa', 'dupla_chance_fora', 'resultado_casa', 'resultado_fora',
      'over_15', 'over_25', 'under_25', 'under_35',
    ];
    // Formato unificado: ev_minimo_antecipado gravado em % inteiro (6). Motor usa multiplicador.
    const evAntecipado = 1 + Number((cfg.filtros as any).ev_minimo_antecipado ?? 6) / 100;

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

    // ── 5b. CAMADA DE ANALISTAS: extrações da janela + peso por analista. Best-effort — se as
    // tabelas ainda não existirem (migração não aplicada), segue sem analistas. NUNCA derruba a
    // análise. As extrações vêm por jogo_data dentro da janela; casamos com o fixture por partida.
    let extracoesJanela: any[] = [];
    let pesoPorAnalista: Record<string, number> = {};
    let nomePorAnalista: Record<string, string> = {};
    try {
      const [{ data: exs }, { data: ans }] = await Promise.all([
        sb.from('analista_extracoes').select('*').gte('jogo_data', datas[0]).lte('jogo_data', datas[datas.length - 1]),
        sb.from('analistas').select('id,nome,peso_atual,ativo'),
      ]);
      const ativos = new Set((ans ?? []).filter((a) => a.ativo).map((a) => a.id));
      extracoesJanela = (exs ?? []).filter((e) => ativos.has(e.analista_id));
      pesoPorAnalista = Object.fromEntries((ans ?? []).map((a) => [a.id, Number(a.peso_atual)]));
      nomePorAnalista = Object.fromEntries((ans ?? []).map((a) => [a.id, a.nome]));
    } catch { /* sem camada de analistas ainda — segue */ }

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
      const jogosSemLinha = new Set<string>();   // ids dos jogos sem linha da API (modo odd manual)

      for (const jogo of jogos) {
        dcPorLiga[jogo.liga] ??= dcDe(jogo.liga);
        const matriz = matrizPlacares(dcPorLiga[jogo.liga], jogo.casa, jogo.fora, (cfg.dixon_coles as any).max_gols_matriz);
        matrizes[jogo.id] = matriz;
        const probsDC = mercadosDaMatriz(matriz);

        // JOGO SEM LINHA DA API: nenhum mercado cotado (Sula/Libertadores, às vezes Série B).
        // Os modelos rodam igual (histórico existe) — então em vez de virar cards de reprovadas,
        // o jogo entra no MODO ODD MANUAL: avalia um set fixo de mercados da matriz sem odd, e o
        // Maikon digita a odd da casa dele. (`_casas` é metadado, não conta como mercado cotado.)
        const linhasGols = Object.keys(odds[jogo.id] ?? {}).filter((k) => /^(over|under)_\d+$/.test(k));
        const jogoSemLinha = Object.keys(odds[jogo.id] ?? {}).filter((k) => k !== '_casas').length === 0;
        if (jogoSemLinha) jogosSemLinha.add(jogo.id);
        const MERCADOS = jogoSemLinha ? MERCADOS_SEM_LINHA : [...MERCADOS_FIXOS, ...linhasGols];

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
            permitirSemOdd: jogoSemLinha,   // sem preço da API mas com modelos → avalia sem EV
          });
          if (jogoSemLinha) p.sem_linha = true;

          // ── Regra de entrada antecipada: jogo a 1-3 dias tem escalação indefinida, então a
          // margem dobra. Não reprova a perna — segura no radar até a véspera.
          p.horizonte_dias = horizonte;
          p.casa_odd = odds[jogo.id]?._casas?.[mercado] ?? null;   // de qual bookmaker veio
          if (p.aprovada && horizonte > 0) {
            if (p.sem_odd_referencia) {
              // Sem EV pra comparar (modo manual): segura no radar pela mesma razão dos escanteios.
              p.radar = true;
              p.motivo_radar = `sem linha da API a ${horizonte} dia(s) do jogo — aguardar a véspera (escalação)`;
            } else if ((p.ev ?? 0) < evAntecipado) {
              p.elegivel_bilhete = false;
              p.radar = true;
              p.motivo_radar = `EV ${(((p.ev ?? 1) - 1) * 100).toFixed(1)}% abaixo dos ${((evAntecipado - 1) * 100).toFixed(0)}% exigidos a ${horizonte} dia(s) do jogo — aguardar véspera (escalação)`;
            }
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
          if (jogoSemLinha) p.sem_linha = true;   // agrupa junto do resto do jogo sem linha
          // A regra de entrada antecipada vale igual: escalação indefinida muda escanteio
          // tanto quanto muda gol. Sem EV pra comparar, o critério é a própria convicção.
          if (p.aprovada && horizonte > 0) {
            p.radar = true;
            p.motivo_radar = `escanteios a ${horizonte} dia(s) do jogo — aguardar a véspera (escalação muda ritmo e volume de ataque)`;
          }
          pernas.push(p);
        }
      }

      // ── CAMADA DE ANALISTAS (por dia) ──────────────────────────────────────────────────────
      // Casa cada extração da janela com um jogo do dia pela PARTIDA (o pipeline nem sempre tem o
      // fixture id quando processa o vídeo). Só as que casam entram; o resto fica pra outro dia.
      const partidaToId: Record<string, string> = {};
      for (const j of jogos) partidaToId[`${j.casa} x ${j.fora}`] = j.id;
      const exsDia = extracoesJanela
        .filter((e: any) => e.partida && partidaToId[e.partida])
        .map((e: any) => ({ ...e, jogo_id: partidaToId[e.partida] }));
      const idxAnalistas = indexarExtracoes(exsDia);
      const resumoExtracao = (e: any) => ({
        analista: nomePorAnalista[e.analista_id] ?? '—',
        tipo: e.tipo, categoria: e.categoria, texto: e.texto_resumo,
        mercado: e.mercado_alvo ?? null, direcao: e.direcao ?? null, conviccao: e.conviccao ?? null,
        data: e.jogo_data ?? (e.criado_em ? String(e.criado_em).slice(0, 10) : null),
        manual: e.processado_por === 'manual_bootstrap',
      });

      // CLÁUSULA DA RESSURREIÇÃO: reprovada SÓ por divergência de modelos + consenso forte a favor
      // (3 analistas, convicção alta) volta REBAIXADA, stake no piso, origem 'analistas'.
      const reprovadasDia = pernas.filter((p: any) => !p.aprovada);
      const ressuscitadas: any[] = [];
      for (const r of ressurreicoesPossiveis(reprovadasDia, idxAnalistas.porMercado)) {
        const alvo = pernas.find((p: any) => p.jogo_id === r.jogo_id && p.mercado === r.mercado && !p.aprovada);
        if (!alvo) continue;
        alvo.aprovada = true;
        alvo.confianca = 'REBAIXADA';
        alvo.origem = 'analistas';
        alvo.ressuscitada = true;
        alvo.elegivel_bilhete = false;
        alvo.motivo_ressurreicao = `${r.n_fontes} analistas (convicção alta) a favor — reprovada só por divergência de modelos`;
        alvo.justificativa = `Ressuscitada pelo consenso dos analistas — confiança rebaixada, stake no piso. ${alvo.motivo_ressurreicao}.`;
        ressuscitadas.push({ partida: alvo.partida, mercado: alvo.mercado, n_fontes: r.n_fontes });
      }

      // FATOS CONSENSUAIS (2+ analistas, mesma categoria/jogo, <48h) → alerta laranja no card. Se
      // um fato consensual CONTRARIA uma entrada aprovada, trava a stake no piso e anota o motivo.
      const consenso = fatosConsensuais(exsDia.filter((e: any) => e.tipo === 'fato'), Date.now());
      const alertaPorPartida: Record<string, any> = {};
      for (const c of consenso) {
        alertaPorPartida[c.partida] = c;
        for (const ct of c.contra) {
          const alvo = pernas.find((p: any) => p.partida === c.partida && p.mercado === ct.mercado && p.aprovada);
          if (!alvo) continue;
          if (alvo.confianca === 'CONFIANCA_MAXIMA') alvo.confianca = 'APROVADA';
          alvo.trava_analistas = `fato consensual (${c.n_analistas} analistas · ${c.categoria}) contraria: ${ct.texto} — stake travada no piso`;
        }
      }

      // Contexto por jogo pro card (fatos / dados citados / opiniões + alerta laranja).
      const analistasPorJogo: Record<string, any> = {};
      for (const [partida, ctx] of idxAnalistas.porJogo.entries()) {
        const a = alertaPorPartida[partida];
        analistasPorJogo[partida] = {
          fatos: ctx.fatos.map(resumoExtracao),
          dados_citados: ctx.dados_citados.map(resumoExtracao),
          opinioes: ctx.opinioes.map(resumoExtracao),
          consenso_laranja: a ? { categoria: a.categoria, n_analistas: a.n_analistas, textos: a.textos } : null,
        };
      }

      // NOTA DE CONFIANÇA (0-100): determinística, atribuída a cada perna ANTES de montar os
      // bilhetes, pra que as pernas dentro de um bilhete já carreguem a nota. Grava também os
      // componentes pro detalhamento na tela. O ajuste dos analistas entra AQUI, decomposto e
      // assimétrico, com trava do verde (o palpite não leva a nota sozinho pra 80+).
      const mandoPleno = (cfg.filtros as any).mando_pleno ?? 7;
      for (const p of pernas) {
        const { nota, componentes } = calcularNota(p, { mandoPleno });
        const opsMercado = idxAnalistas.porMercado.get(`${p.jogo_id}|${p.mercado}`) ?? [];
        const { ajuste, componentes: compA } = ajusteDaPerna(p, opsMercado, pesoPorAnalista);
        const ap = aplicarAjusteNota(nota, ajuste);
        p.nota = ap.nota;
        p.nota_base = ap.nota_base;
        p.nota_componentes = componentes;
        p.analistas_ajuste = ap.ajuste || 0;
        p.analistas_componentes = compA;
        p.analistas_teto_solida = ap.teto_solida;
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
        jogos: jogos.map((j: any) => ({ ...j, sem_linha: jogosSemLinha.has(j.id), contagens: contagensDoJogo(j, historico) })),
        pernas, radar,
        bilhetes: resultado.bilhetes ?? [],
        sem_bilhete: resultado.sem_bilhete ? { motivo: resultado.motivo } : null,
        exposicao: resultado.exposicao ?? null,
        cards_handicap: cardsAH, avisos,
        // CAMADA DE ANALISTAS: contexto por jogo (fatos/dados/opiniões + alerta laranja) e as
        // entradas ressuscitadas pelo consenso. O card e o placar leem daqui, casando por partida.
        analistas_por_jogo: analistasPorJogo,
        analistas_ressuscitadas: ressuscitadas,
      };

      await sb.from('analises').upsert({ data: dataAlvo, modo, resumo, payload, gerado_em: new Date().toISOString() });

      // PAPER TRADING: cada perna aprovada (inclusive as de radar) vira sugestão virtual.
      // Upsert por (jogo_id, mercado) SEM tocar em status/gols: a captura roda todo dia até a
      // véspera, guardando o estado mais informado (D+0), e nunca sobrescreve uma sugestão já
      // liquidada. Envolto em try/catch de propósito — paper trading é acessório, não pode
      // derrubar a análise do dia se a tabela falhar.
      try {
        const snapshot = {
          filtros: cfg.filtros, pesos: cfg.pesos_heuristica, dixon_coles: cfg.dixon_coles,
          modelo_por_liga: Object.fromEntries(
            Object.entries(dcPorLiga).map(([l, m]: any) => [l, { disponivel: m.disponivel, n_jogos: m.n_jogos ?? 0 }]),
          ),
        };
        const sugestoes = pernas.map((p: any) => sugestaoDaPerna(p, dataAlvo, snapshot)).filter(Boolean);
        if (sugestoes.length) {
          await sb.from('sugestoes_liquidadas').upsert(sugestoes, { onConflict: 'jogo_id,mercado' });
        }
      } catch (e) {
        avisos.push(`captura de sugestões falhou: ${e instanceof Error ? e.message : e}`);
      }

      // PALPITES DOS ANALISTAS: cada opinião com mercado_alvo vira linha de placar virtual, com a
      // odd do dia como referência quando o mercado é do nosso motor e a linha existe. A liquidação
      // é do cron (liquidar-sugestoes). Best-effort — não derruba a análise.
      try {
        const palpites = exsDia
          .filter((e: any) => e.tipo === 'opiniao' && e.mercado_alvo)
          .map((e: any) => {
            const oddRef = odds[partidaToId[e.partida]]?.[e.mercado_alvo] ?? null;
            const pal = palpiteDaExtracao(e, { oddReferencia: oddRef });
            if (!pal) return null;
            pal.data = e.jogo_data ?? dataAlvo;
            pal.jogo_id = partidaToId[e.partida] ?? pal.jogo_id;
            pal.peso_no_registro = pesoPorAnalista[e.analista_id] ?? null;
            return pal;
          })
          .filter(Boolean);
        if (palpites.length) await sb.from('analista_palpites_liquidados').upsert(palpites, { onConflict: 'extracao_id' });
      } catch (e) {
        avisos.push(`captura de palpites de analistas falhou: ${e instanceof Error ? e.message : e}`);
      }

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
