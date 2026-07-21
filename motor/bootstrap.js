#!/usr/bin/env node
/**
 * BOOTSTRAP DO CACHE — popula data/historico_times.json de uma vez.
 *
 *   npm run bootstrap                 → ligas ativas, prioridade Série B e J-League
 *   npm run bootstrap -- 72 98        → só as ligas informadas
 *
 * Estratégia de cota (Pro = 7500/dia):
 *   1 req por liga  → TODOS os jogos encerrados da temporada (alimenta o Dixon-Coles)
 *   1 req por liga  → lista de times
 *   1 req por time  → últimos 15 jogos (forma REAL, cruza competições: copa, estadual)
 *   1 req por confronto da semana → H2H
 *
 * Jogo encerrado não muda: o que entra aqui não é buscado de novo (o analisar só lê o cache).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR_DADOS = path.join(RAIZ, 'data');
const ARQ_CACHE = path.join(DIR_DADOS, 'historico_times.json');
const API = 'https://v3.football.api-sports.io';

const cfg = JSON.parse(fs.readFileSync(path.join(DIR_DADOS, 'config.json'), 'utf8'));
const CHAVE = process.env.API_FOOTBALL_KEY || process.env.APIFOOTBALL_KEY;

/** Série B e J-League primeiro, como pedido; o resto na ordem do config. */
const PRIORIDADE = [72, 98];
const filtro = process.argv.slice(2).filter((a) => /^\d+$/.test(a)).map(Number);
const ligas = cfg.ligas
  .filter((l) => l.ativa && (!filtro.length || filtro.includes(l.id)))
  .sort((a, b) => (PRIORIDADE.indexOf(b.id) - PRIORIDADE.indexOf(a.id)));

let reqs = 0;
async function api(rota, params) {
  const url = new URL(API + rota);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const r = await fetch(url, { headers: { 'x-apisports-key': CHAVE } });
  reqs++;
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) {
    const msg = Object.values(j.errors)[0];
    if (/rate|limit/i.test(String(msg))) throw new Error(`COTA: ${msg}`);
    return { erro: String(msg), response: [] };
  }
  return { response: j.response ?? [] };
}

const normalizar = (f) => ({
  data: f.fixture.date.slice(0, 10),
  casa: f.teams.home.name,
  fora: f.teams.away.name,
  gols_casa: f.goals.home ?? 0,
  gols_fora: f.goals.away ?? 0,
});

/** A temporada corrente muda de rótulo por país (Brasil = 2026; Europa = 2025/26). */
async function descobrirTemporada(ligaId) {
  const ano = new Date().getFullYear();
  for (const s of [ano, ano - 1]) {
    const { response } = await api('/fixtures', { league: ligaId, season: s, status: 'FT' });
    if (response.length) return { season: s, jogos: response.map(normalizar) };
  }
  return { season: null, jogos: [] };
}

async function main() {
  if (!CHAVE) { console.error('\n❌ Sem API_FOOTBALL_KEY no .env\n'); process.exit(1); }

  const st = await api('/status', {});
  const plano = st.response?.subscription?.plan;
  const limite = st.response?.requests?.limit_day;
  console.log(`\n📦 BOOTSTRAP DO CACHE — plano ${plano} (${st.response?.requests?.current}/${limite} req hoje)`);
  console.log(`   ${ligas.length} liga(s): ${ligas.map((l) => l.nome).join(', ')}\n`);

  const cache = fs.existsSync(ARQ_CACHE)
    ? JSON.parse(fs.readFileSync(ARQ_CACHE, 'utf8'))
    : { times: {}, h2h: {}, ligas: {} };
  cache.times ??= {}; cache.h2h ??= {}; cache.ligas ??= {};

  const resumo = [];

  for (const liga of ligas) {
    process.stdout.write(`   ${liga.nome}… `);

    // 1) Todos os jogos encerrados da temporada → base do Dixon-Coles.
    const { season, jogos } = await descobrirTemporada(liga.id);
    if (!season) { console.log('sem temporada com jogos encerrados — pulada'); resumo.push({ liga: liga.nome, jogos: 0, times: 0, dc: false }); continue; }
    cache.ligas[liga.id] = { nome: liga.nome, season, jogos };

    // 2) Times da liga.
    const { response: times } = await api('/teams', { league: liga.id, season });

    // 3) Últimos 15 de cada time (pega copa/estadual, que a busca por liga não traz).
    let novos = 0;
    for (const t of times) {
      const nome = t.team.name;
      if (cache.times[nome]?.length) continue;
      const { response } = await api('/fixtures', { team: t.team.id, last: 15, status: 'FT' });
      cache.times[nome] = response.map(normalizar);
      novos++;
    }

    const dcOk = jogos.length >= cfg.dixon_coles.min_jogos_liga;
    console.log(`${jogos.length} jogos da temporada ${season} · ${times.length} times (${novos} novos) · Dixon-Coles ${dcOk ? 'OK' : 'INSUFICIENTE'}`);
    resumo.push({ liga: liga.nome, jogos: jogos.length, times: times.length, dc: dcOk });
    fs.writeFileSync(ARQ_CACHE, JSON.stringify(cache, null, 2));
  }

  // 4) H2H dos confrontos da semana (hoje +7 dias).
  console.log('\n   H2H dos confrontos da semana…');
  const hoje = new Date();
  const idsLiga = new Set(ligas.map((l) => l.id));
  let h2hNovos = 0, confrontos = 0;
  for (let d = 0; d < 7; d++) {
    const dia = new Date(hoje); dia.setDate(dia.getDate() + d);
    const data = dia.toISOString().slice(0, 10);
    const { response } = await api('/fixtures', { date: data });
    for (const f of response) {
      if (!idsLiga.has(f.league?.id)) continue;
      confrontos++;
      const chave = `${f.teams.home.id}-${f.teams.away.id}`;
      if (cache.h2h[chave]) continue;
      const { response: h } = await api('/fixtures/headtohead', { h2h: chave, last: 5, status: 'FT' });
      cache.h2h[chave] = h.map(normalizar);
      h2hNovos++;
    }
  }
  fs.writeFileSync(ARQ_CACHE, JSON.stringify(cache, null, 2));
  console.log(`   ${confrontos} confronto(s) na semana · ${h2hNovos} H2H novo(s)`);

  console.log('\n   ── RESUMO ──');
  for (const r of resumo) {
    console.log(`   ${r.dc ? '✓' : '✗'} ${r.liga.padEnd(24)} ${String(r.jogos).padStart(4)} jogos · ${r.times} times${r.dc ? '' : '  (Dixon-Coles não converge: amostra curta)'}`);
  }
  console.log(`\n💾 ${ARQ_CACHE.replace(RAIZ + path.sep, '')} · ${Object.keys(cache.times).length} times · ${Object.keys(cache.h2h).length} H2H`);
  console.log(`🔢 ${reqs} requisições nesta rodada (teto ${limite}/dia)\n`);
}

main().catch((e) => { console.error('\n❌', e.message, '\n'); process.exitCode = 1; });
