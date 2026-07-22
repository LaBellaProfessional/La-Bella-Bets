// BELLA BETS — edge function `liquidar-sugestoes`
//
// Paper trading: pega as sugestões PENDENTES de jogos já encerrados e as liquida contra o
// placar real. Roda 30 min depois do `analisar` (o cron das 9h), quando os jogos de ontem
// já têm resultado.
//
// CUSTO DE REQUESTS — o cuidado do pedido:
//   · placar de gols: 1 request por DATA com pendência (fixtures?date devolve todos os jogos
//     do dia com o placar), não 1 por jogo.
//   · escanteios: primeiro tenta o cache do bootstrap semanal (historico_escanteios); só se
//     faltar é que busca fixtures/statistics daquele jogo. Jogo de liga coberta pelo bootstrap
//     quase nunca precisa da chamada avulsa.
//
//   POST {}  → liquida tudo que der

import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-nocheck
import { resultadoSugestao } from '../_shared/sugestoes.js';
import { chaveFootball } from '../_shared/fontes.js';

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } },
);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const API = 'https://v3.football.api-sports.io';
const FINALIZADO = new Set(['FT', 'AET', 'PEN']);
let reqs = 0;

async function api(rota: string, params: Record<string, unknown>) {
  const url = new URL(API + rota);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url, { headers: { 'x-apisports-key': chaveFootball() } });
  reqs++;
  const j = await r.json();
  return j.response ?? [];
}

const hojeSP = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const t0 = Date.now();

  const auth = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const ehServico = auth === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!ehServico) {
    const { data: u } = await sb.auth.getUser(auth);
    if (!u?.user) return json({ ok: false, erro: 'não autenticado' }, 401);
  }

  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* vazio */ }
  const { data: exec } = await sb.from('execucoes')
    .insert({ funcao: 'liquidar-sugestoes', disparo: corpo.disparo === 'cron' ? 'cron' : 'manual' })
    .select('id').single();

  try {
    const hoje = hojeSP();
    // Inclui HOJE: o que segura jogo não terminado é o status FT lá embaixo, não a data.
    // Liquidar no mesmo dia (assim que o jogo acaba) em vez de esperar a virada é mais correto
    // e custa só 1 request a mais (as fixtures de hoje).
    const { data: pendentes } = await sb.from('sugestoes_liquidadas')
      .select('*').eq('status', 'pendente').lte('data', hoje);

    if (!pendentes?.length) {
      await sb.from('execucoes').update({ terminado_em: new Date().toISOString(), ok: true, detalhe: { nada: true } }).eq('id', exec?.id);
      return json({ ok: true, liquidadas: 0, pendentes: 0, msg: 'nada pendente de dias anteriores' });
    }

    // 1) Placar por ID DE FIXTURE, não por data.
    // Buscar por data cai na armadilha de fuso: a sugestão guarda o dia de São Paulo, mas o
    // parâmetro `date` da API filtra por dia UTC — um jogo 21:35 SP é 00:35 UTC do dia seguinte
    // e sumiria da consulta do "seu" dia. Buscar pelos ids exatos não tem ambiguidade nenhuma.
    // A API aceita até 20 ids por chamada (ids=1-2-3), então some poucas requisições no total.
    const ids = [...new Set(pendentes.map((s) => String(s.jogo_id)))];
    const placar: Record<string, { status: string; gc: number; gf: number }> = {};
    for (let i = 0; i < ids.length; i += 20) {
      const lote = ids.slice(i, i + 20);
      const fx = await api('/fixtures', { ids: lote.join('-') });
      for (const f of fx) {
        const sc = f.score?.fulltime;
        placar[String(f.fixture.id)] = {
          status: f.fixture.status.short,
          gc: sc?.home ?? f.goals?.home ?? null,
          gf: sc?.away ?? f.goals?.away ?? null,
        };
      }
    }

    // 2) Escanteios — cache primeiro; só os jogos com sugestão de escanteio PENDENTE e ainda
    // ausentes do cache é que geram uma chamada avulsa.
    const precisaEsc = new Set(
      pendentes.filter((s) => s.familia === 'escanteios').map((s) => String(s.jogo_id)),
    );
    const escTotal: Record<string, number> = {};
    if (precisaEsc.size) {
      const { data: cacheEsc } = await sb.from('historico_escanteios')
        .select('fixture_id,esc_casa,esc_fora').in('fixture_id', [...precisaEsc].map(Number));
      for (const c of cacheEsc ?? []) escTotal[String(c.fixture_id)] = (c.esc_casa ?? 0) + (c.esc_fora ?? 0);

      for (const id of precisaEsc) {
        if (escTotal[id] != null) continue;                 // veio do cache do bootstrap
        if (!FINALIZADO.has(placar[id]?.status)) continue;   // jogo não terminou: deixa pendente
        const est = await api('/fixtures/statistics', { fixture: id });
        let total = 0, achou = false;
        for (const t of est) {
          const s = (t.statistics ?? []).find((x: any) => /corner/i.test(String(x.type)));
          if (s?.value != null) { total += Number(s.value); achou = true; }
        }
        if (achou) escTotal[id] = total;
      }
    }

    // 3) Liquida uma a uma.
    let liquidadas = 0, semDado = 0;
    const porResultado = { ganhou: 0, perdeu: 0 };
    for (const s of pendentes) {
      const pl = placar[String(s.jogo_id)];
      if (!pl || !FINALIZADO.has(pl.status)) { semDado++; continue; }

      const r = resultadoSugestao(s, {
        golsCasa: pl.gc, golsFora: pl.gf,
        escanteiosTotal: s.familia === 'escanteios' ? escTotal[String(s.jogo_id)] ?? null : null,
      });
      if (r == null) { semDado++; continue; }

      await sb.from('sugestoes_liquidadas').update({
        status: r, gols_casa: pl.gc, gols_fora: pl.gf,
        escanteios_total: s.familia === 'escanteios' ? escTotal[String(s.jogo_id)] ?? null : null,
        liquidado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
      }).eq('id', s.id);
      liquidadas++;
      porResultado[r]++;
    }

    const detalhe = { liquidadas, por_resultado: porResultado, sem_dado_ainda: semDado, req_football: reqs, ms: Date.now() - t0 };
    await sb.from('execucoes').update({ terminado_em: new Date().toISOString(), ok: true, req_football: reqs, detalhe }).eq('id', exec?.id);
    return json({ ok: true, ...detalhe });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('execucoes').update({ terminado_em: new Date().toISOString(), ok: false, detalhe: { erro: msg } }).eq('id', exec?.id);
    return json({ ok: false, erro: msg }, 500);
  }
});
