// BELLA BETS — edge function `bootstrap`
//
// Porta o `npm run bootstrap`: popula o cache (times, ligas, H2H) e — a diferença
// importante da nuvem — AJUSTA o Dixon-Coles e persiste os parâmetros em `modelo_params`.
// O ajuste é a parte cara; fazendo aqui (semanal), a análise diária só lê parâmetro.
//
//   POST { "ligas": [72, 98] }   → só essas ligas
//   POST { "refit": true }       → não busca nada, só reajusta o Dixon-Coles do cache
//
// Ligas são processadas em lote pequeno pra não estourar o tempo limite: a resposta diz
// quais faltaram, e o dash reinvoca até acabar.

import { createClient } from 'jsr:@supabase/supabase-js@2';
// @ts-nocheck
import { ajustarDixonColes } from '../_shared/dixonColes.js';
import { chaveFootball } from '../_shared/fontes.js';

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


const API = 'https://v3.football.api-sports.io';
const PRIORIDADE = [72, 98]; // Série B e J-League primeiro

let reqs = 0;
async function api(rota: string, params: Record<string, unknown>) {
  const url = new URL(API + rota);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url, { headers: { 'x-apisports-key': chaveFootball() } });
  reqs++;
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) return { erro: String(Object.values(j.errors)[0]), response: [] };
  return { response: j.response ?? [], erro: null };
}

const normalizar = (f: any) => ({
  data: f.fixture.date.slice(0, 10),
  casa: f.teams.home.name,
  fora: f.teams.away.name,
  gols_casa: f.goals.home ?? 0,
  gols_fora: f.goals.away ?? 0,
});

/** A temporada corrente muda de rótulo por país (Brasil/Japão = 2026; Europa = 2025/26). */
async function descobrirTemporada(ligaId: number) {
  const ano = new Date().getFullYear();
  for (const s of [ano, ano - 1]) {
    const { response } = await api('/fixtures', { league: ligaId, season: s, status: 'FT' });
    if (response.length) return { season: s, jogos: response.map(normalizar) };
  }
  return { season: null, jogos: [] as any[] };
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
    .insert({ funcao: 'bootstrap', disparo: corpo.disparo === 'cron' ? 'cron' : 'manual' })
    .select('id').single();

  try {
    const { data: cfgRow } = await sb.from('config').select('*').eq('id', 1).single();
    const cfg = cfgRow!;
    const minJogos = (cfg.dixon_coles as any).min_jogos_liga;
    const xi = (cfg.dixon_coles as any).xi;

    // ── REFIT: só reajusta o modelo com o cache que já existe (não gasta API)
    if (corpo.refit) {
      // Uma liga por vez (lote pequeno): o fit e numerico e pesado, e refazer 10 de uma vez
      // estoura o WORKER_RESOURCE_LIMIT. Devolve 'faltam' e o chamador reinvoca ate zerar.
      const { data: todasLigas } = await sb.from('historico_ligas').select('nome,jogos');
      const pedidasRefit: string[] = corpo.ligas_nomes ?? [];
      const alvo = (todasLigas ?? []).filter((l) => !pedidasRefit.length || pedidasRefit.includes(l.nome));
      const ligas = alvo.slice(0, Number(corpo.lote ?? 1));
      const faltamRefit = alvo.slice(ligas.length).map((l) => l.nome);
      const feitos: string[] = [];
      for (const l of ligas ?? []) {
        // Só os jogos da própria liga: é o que cabe no orçamento de CPU da edge function.
        // Liga de amostra curta (copa em fase inicial) fica indisponível aqui e o método opera
        // com heurística — ou recebe um fit melhor via 'npm run sincronizar-modelo' (local).
        const m = ajustarDixonColes(l.jogos ?? [], { xi, minJogos, hoje: new Date() });
        await sb.from('modelo_params').upsert({
          liga: l.nome, disponivel: m.disponivel, motivo: m.motivo ?? null, n_jogos: m.n_jogos ?? 0,
          ataque: m.ataque ?? {}, defesa: m.defesa ?? {}, mando: m.mando ?? null, rho: m.rho ?? null,
          ajustado_em: new Date().toISOString(),
        });
        feitos.push(`${l.nome}: ${m.disponivel ? 'ajustado com ' + m.n_jogos + ' jogos' : m.motivo}`);
      }
      await sb.from('execucoes').update({
        terminado_em: new Date().toISOString(), ok: true, detalhe: { refit: feitos, ms: Date.now() - t0 },
      }).eq('id', exec?.id);
      return json({ ok: true, refit: feitos, faltam: faltamRefit, ms: Date.now() - t0 });
    }

    // ── BOOTSTRAP: busca dados. Lote pequeno por invocação (tempo limite da function).
    const pedidas: number[] = corpo.ligas ?? [];
    const todas = (cfg.ligas as any[]).filter((l) => l.ativa && (!pedidas.length || pedidas.includes(l.id)))
      .sort((a, b) => PRIORIDADE.indexOf(b.id) - PRIORIDADE.indexOf(a.id));
    const lote = todas.slice(0, Number(corpo.lote ?? 2));

    const resumo: any[] = [];
    for (const liga of lote) {
      const { season, jogos } = await descobrirTemporada(liga.id);
      if (!season) { resumo.push({ liga: liga.nome, jogos: 0, erro: 'sem temporada com jogos encerrados' }); continue; }

      await sb.from('historico_ligas').upsert({
        liga_id: liga.id, nome: liga.nome, season, jogos, atualizado_em: new Date().toISOString(),
      });

      const { response: times } = await api('/teams', { league: liga.id, season });
      const { data: jaTem } = await sb.from('historico_times').select('time_nome');
      const conhecidos = new Set((jaTem ?? []).map((t) => t.time_nome));

      let novos = 0;
      for (const t of times) {
        const nome = t.team.name;
        if (conhecidos.has(nome)) continue;
        const { response } = await api('/fixtures', { team: t.team.id, last: 15, status: 'FT' });
        await sb.from('historico_times').upsert({
          time_nome: nome, jogos: response.map(normalizar), atualizado_em: new Date().toISOString(),
        });
        novos++;
      }

      // Ajusta e persiste o modelo desta liga — é o que a análise diária vai consumir.
      const m = ajustarDixonColes(jogos, { xi, minJogos, hoje: new Date() });
      await sb.from('modelo_params').upsert({
        liga: liga.nome, disponivel: m.disponivel, motivo: m.motivo ?? null, n_jogos: m.n_jogos ?? 0,
        ataque: m.ataque ?? {}, defesa: m.defesa ?? {}, mando: m.mando ?? null, rho: m.rho ?? null,
        ajustado_em: new Date().toISOString(),
      });

      resumo.push({ liga: liga.nome, season, jogos: jogos.length, times: times.length, novos, dixon_coles: m.disponivel });
    }

    // ── H2H dos próximos 3 dias (só das ligas ativas)
    const idsAtivas = new Set((cfg.ligas as any[]).filter((l) => l.ativa).map((l) => l.id));
    let h2hNovos = 0;
    if (corpo.h2h !== false) {
      const { data: jaH2H } = await sb.from('historico_h2h').select('par');
      const conhecidos = new Set((jaH2H ?? []).map((h) => h.par));
      for (let d = 0; d < 3; d++) {
        const dia = new Date(); dia.setDate(dia.getDate() + d);
        const { response } = await api('/fixtures', { date: dia.toISOString().slice(0, 10) });
        for (const f of response) {
          if (!idsAtivas.has(f.league?.id)) continue;
          const par = `${f.teams.home.id}-${f.teams.away.id}`;
          if (conhecidos.has(par)) continue;
          const { response: h } = await api('/fixtures/headtohead', { h2h: par, last: 5, status: 'FT' });
          await sb.from('historico_h2h').upsert({ par, jogos: h.map(normalizar), atualizado_em: new Date().toISOString() });
          conhecidos.add(par); h2hNovos++;
        }
      }
    }

    const faltam = todas.slice(lote.length).map((l) => l.id);
    await sb.from('execucoes').update({
      terminado_em: new Date().toISOString(), ok: true, req_football: reqs,
      detalhe: { resumo, h2h_novos: h2hNovos, faltam, ms: Date.now() - t0 },
    }).eq('id', exec?.id);

    return json({ ok: true, resumo, h2h_novos: h2hNovos, faltam, req_football: reqs, ms: Date.now() - t0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sb.from('execucoes').update({
      terminado_em: new Date().toISOString(), ok: false, detalhe: { erro: msg },
    }).eq('id', exec?.id);
    return json({ ok: false, erro: msg }, 500);
  }
});
