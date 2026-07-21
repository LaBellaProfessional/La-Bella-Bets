#!/usr/bin/env node
/**
 * MIGRAÇÃO /data → Supabase. Idempotente (upsert): pode rodar de novo sem duplicar.
 *
 *   npm run migrar
 *
 * Usa a SECRET key (service_role) — ignora RLS de propósito, é carga administrativa.
 * Nada se perde: config, cache de times/ligas/H2H e todas as análises já geradas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(RAIZ, 'data');
const URL_SB = process.env.SUPABASE_URL;
const SECRET = process.env.SUPABASE_SECRET_KEY;

if (!URL_SB || !SECRET) { console.error('\n❌ Faltam SUPABASE_URL / SUPABASE_SECRET_KEY no .env\n'); process.exit(1); }

const ler = (p, padrao) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8')); } catch { return padrao; } };

async function upsert(tabela, linhas, conflito) {
  if (!linhas.length) return 0;
  let total = 0;
  // Lotes: payloads grandes (temporada inteira de liga) estouram o limite da requisição.
  for (let i = 0; i < linhas.length; i += 50) {
    const lote = linhas.slice(i, i + 50);
    const r = await fetch(`${URL_SB}/rest/v1/${tabela}?on_conflict=${conflito}`, {
      method: 'POST',
      headers: {
        apikey: SECRET, Authorization: `Bearer ${SECRET}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(lote),
    });
    if (!r.ok) throw new Error(`${tabela}: HTTP ${r.status} — ${(await r.text()).slice(0, 200)}`);
    total += lote.length;
    process.stdout.write(`\r   ${tabela}: ${total}/${linhas.length}`);
  }
  process.stdout.write('\n');
  return total;
}

const main = async () => {
  console.log('\n📤 MIGRANDO /data → Supabase\n');

  // ── config (linha única)
  const cfg = ler('config.json', null);
  if (cfg) {
    await upsert('config', [{
      id: 1, banca: cfg.banca,
      stake_padrao_pct: cfg.stake_padrao_pct,
      stake_confianca_maxima_pct: cfg.stake_confianca_maxima_pct,
      teto_exposicao_diaria_pct: cfg.teto_exposicao_diaria_pct,
      filtros: cfg.filtros, pesos_heuristica: cfg.pesos_heuristica,
      dixon_coles: cfg.dixon_coles, mercados_em_bilhete: cfg.mercados_em_bilhete,
      ligas: cfg.ligas, atualizado_em: new Date().toISOString(),
    }], 'id');
  }

  // ── cache
  const cache = ler('historico_times.json', { times: {}, h2h: {}, ligas: {} });
  await upsert('historico_times',
    Object.entries(cache.times ?? {}).map(([time_nome, jogos]) => ({ time_nome, jogos })), 'time_nome');
  await upsert('historico_ligas',
    Object.entries(cache.ligas ?? {}).map(([liga_id, l]) => ({
      liga_id: Number(liga_id), nome: l.nome, season: l.season, jogos: l.jogos ?? [],
    })), 'liga_id');
  await upsert('historico_h2h',
    Object.entries(cache.h2h ?? {}).map(([par, jogos]) => ({ par, jogos })), 'par');

  // ── análises
  const dirAnalises = path.join(DIR, 'analises');
  const arquivos = fs.existsSync(dirAnalises) ? fs.readdirSync(dirAnalises).filter((f) => f.endsWith('.json')) : [];
  await upsert('analises', arquivos.map((f) => {
    const a = JSON.parse(fs.readFileSync(path.join(dirAnalises, f), 'utf8'));
    return { data: a.data, modo: a.modo, gerado_em: a.gerado_em, resumo: a.resumo, payload: a };
  }), 'data');

  // ── bilhetes já registrados
  const bilhetes = ler('bilhetes.json', []);
  if (bilhetes.length) {
    await upsert('bilhetes', bilhetes.map((b) => ({
      data: b.data, registrado_em: b.registrado_em, pernas: b.pernas,
      n_pernas: b.pernas?.length ?? 0, odd_total: b.odd_total,
      prob_combinada: b.prob_combinada, ev_pct: b.ev_pct,
      stake_sugerido: b.stake_rs, stake_real: b.stake_rs,
      resultado: b.resultado, retorno_rs: b.retorno_rs, banca_depois: b.banca_depois,
      mercados: [...new Set((b.pernas ?? []).map((p) => p.mercado))],
    })), 'id');
  }

  console.log('\n✅ migração concluída\n');
};

main().catch((e) => { console.error('\n❌', e.message, '\n'); process.exitCode = 1; });
