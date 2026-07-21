// BELLA BETS — edge function `bootstrap-escanteios`
//
// Coleta a estatística de escanteios dos jogos já encerrados das ligas ativas.
//
// Por que é uma function separada do `bootstrap`: aqui o custo é por JOGO, não por time.
// A API-Football só entrega estatística de partida em /fixtures/statistics?fixture=ID —
// uma requisição por jogo, sem lote. Misturar isso no bootstrap normal (que é por liga e por
// time) esconderia o custo real e estouraria o tempo da function.
//
//   POST { "ligas": [72, 71, 98], "por_liga": 150, "lote": 60 }
//
// Idempotente: jogo já coletado não é buscado de novo (o placar de escanteios de um jogo
// encerrado nunca muda). A resposta diz quantos faltam — o chamador reinvoca até zerar.

import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-nocheck
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
let reqs = 0;

async function api(rota: string, params: Record<string, unknown>) {
  const url = new URL(API + rota);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url, { headers: { 'x-apisports-key': chaveFootball() } });
  reqs++;
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) return { response: [], erro: String(Object.values(j.errors)[0]) };
  return { response: j.response ?? [], erro: null };
}

/** Escanteios de um time no bloco de estatísticas da partida. */
function escanteiosDe(bloco: any): number | null {
  const s = (bloco?.statistics ?? []).find((x: any) => /corner/i.test(String(x.type)));
  const v = s?.value;
  return v == null ? null : Number(v);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const t0 = Date.now();
  let corpo: any = {};
  try { corpo = await req.json(); } catch { /* vazio */ }

  const auth = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const ehServico = auth === Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!ehServico) {
    const { data: u } = await sb.auth.getUser(auth);
    if (!u?.user) return json({ ok: false, erro: 'não autenticado' }, 401);
  }

  const { data: exec } = await sb.from('execucoes')
    .insert({ funcao: 'bootstrap-escanteios', disparo: corpo.disparo === 'cron' ? 'cron' : 'manual' })
    .select('id').single();

  try {
    const porLiga = Number(corpo.por_liga ?? 150);
    const lote = Number(corpo.lote ?? 60);
    const ligas: number[] = corpo.ligas ?? [72, 71, 98];

    const { data: jaTem } = await sb.from('historico_escanteios').select('fixture_id');
    const conhecidos = new Set((jaTem ?? []).map((r) => Number(r.fixture_id)));

    // 1) Lista de jogos encerrados por liga (1 request por liga). Só os `por_liga` mais
    //    recentes: cobrir a temporada inteira dobraria o custo sem melhorar o modelo, que
    //    olha no máximo os últimos 10 jogos de cada time.
    const pendentes: any[] = [];
    const porLigaResumo: any[] = [];
    for (const ligaId of ligas) {
      let lista: any[] = [];
      let season: number | null = null;
      const ano = new Date().getFullYear();
      for (const s of [ano, ano - 1]) {
        const { response } = await api('/fixtures', { league: ligaId, season: s, status: 'FT' });
        if (response.length) { lista = response; season = s; break; }
      }
      const recentes = lista
        .sort((a: any, b: any) => String(a.fixture.date).localeCompare(String(b.fixture.date)))
        .slice(-porLiga);
      const faltando = recentes.filter((f: any) => !conhecidos.has(Number(f.fixture.id)));
      porLigaResumo.push({ liga_id: ligaId, season, encerrados: lista.length, alvo: recentes.length, faltando: faltando.length });
      pendentes.push(...faltando);
    }

    // 2) Estatística jogo a jogo, até o tamanho do lote.
    const doLote = pendentes.slice(0, lote);
    const linhas: any[] = [];
    let semEstatistica = 0;
    for (const f of doLote) {
      const { response } = await api('/fixtures/statistics', { fixture: f.fixture.id });
      const casa = response.find((t: any) => t.team?.id === f.teams.home.id);
      const fora = response.find((t: any) => t.team?.id === f.teams.away.id);
      const eCasa = escanteiosDe(casa), eFora = escanteiosDe(fora);
      // Jogo sem escanteio registrado não vira zero: zero é um dado, ausência é outra coisa.
      // Fica de fora e será tentado de novo numa próxima rodada.
      if (eCasa == null || eFora == null) { semEstatistica++; continue; }
      linhas.push({
        fixture_id: f.fixture.id, liga_id: f.league.id, data: String(f.fixture.date).slice(0, 10),
        casa: f.teams.home.name, fora: f.teams.away.name,
        esc_casa: eCasa, esc_fora: eFora, atualizado_em: new Date().toISOString(),
      });
    }
    if (linhas.length) {
      const { error } = await sb.from('historico_escanteios').upsert(linhas);
      if (error) throw new Error(`gravar escanteios: ${error.message}`);
    }

    const faltam = Math.max(0, pendentes.length - doLote.length);
    const detalhe = {
      gravados: linhas.length, sem_estatistica: semEstatistica, faltam,
      por_liga: porLigaResumo, ms: Date.now() - t0,
    };
    await sb.from('execucoes').update({
      terminado_em: new Date().toISOString(), ok: true, req_football: reqs, detalhe,
    }).eq('id', exec?.id);

    return json({ ok: true, ...detalhe, req_football: reqs });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('execucoes').update({
      terminado_em: new Date().toISOString(), ok: false, detalhe: { erro: msg },
    }).eq('id', exec?.id);
    return json({ ok: false, erro: msg }, 500);
  }
});
