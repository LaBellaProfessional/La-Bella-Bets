#!/usr/bin/env node
/**
 * BELLA BETS — BOOTSTRAP MANUAL DOS ANALISTAS (ponte até a ANTHROPIC_API_KEY chegar).
 *
 *   node scripts/bootstrap-analistas-manual.mjs [caminho.json]
 *   (default: data/analistas-manual.json; se não existir, usa data/analistas-manual.exemplo.json)
 *
 * Enquanto a chave da plataforma não libera, este script insere extrações processadas À MÃO no
 * MESMO formato do extrator automático, marcadas com processado_por='manual_bootstrap' — pra
 * distinguir do que a máquina extraiu. Com isso a cadeia inteira (contexto no card, ajuste de
 * nota, placar da tripulação) valida hoje; o pipeline automático fica pronto, só aguardando a chave.
 *
 * Formato do JSON (uma entrada por vídeo processado):
 * {
 *   "videos": [
 *     {
 *       "canal_youtube": "@freitastipster",
 *       "video_id": "UvLktenl4us",
 *       "video_titulo": "PALPITES ... 23/07",
 *       "data_video": "2026-07-22T20:43:51Z",
 *       "url": "https://www.youtube.com/watch?v=UvLktenl4us",
 *       "extracoes": [
 *         { "tipo":"fato|opiniao|dado_citado", "categoria":"desfalque|...|estatistica",
 *           "partida":"Casa x Fora", "jogo_data":"AAAA-MM-DD", "texto_resumo":"...",
 *           "mercado_alvo":"dupla_chance_casa|over_25|esc_over_95|cartoes_over_45|null",
 *           "direcao":"a_favor|contra|neutro", "conviccao":"baixa|media|alta" }
 *       ]
 *     }
 *   ]
 * }
 *
 * Regras do Freitas embutidas no processamento à mão: bloco MENOR → conviccao 'alta',
 * bloco MAIOR → 'media'; bilhete múltiplo quebrado em uma extração por perna.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SECRET_KEY;
if (!U || !K) { console.error('faltam SUPABASE_URL / SUPABASE_SECRET_KEY no .env'); process.exit(2); }

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '..');
const arg = process.argv[2];
const caminho = arg
  ? path.resolve(arg)
  : (fs.existsSync(path.join(RAIZ, 'data/analistas-manual.json'))
    ? path.join(RAIZ, 'data/analistas-manual.json')
    : path.join(RAIZ, 'data/analistas-manual.exemplo.json'));

const sb = {
  async get(rota) {
    const r = await fetch(`${U}/rest/v1/${rota}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } });
    if (!r.ok) throw new Error(`GET ${rota}: ${r.status} ${await r.text()}`);
    return r.json();
  },
  async post(tabela, corpo, prefer = 'return=representation') {
    const r = await fetch(`${U}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: prefer },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) throw new Error(`POST ${tabela}: ${r.status} ${await r.text()}`);
    return prefer.includes('representation') ? r.json() : null;
  },
};

async function main() {
  console.log(`\n📋 BELLA BETS — bootstrap manual de analistas\n   fonte: ${path.relative(RAIZ, caminho)}\n`);
  if (!fs.existsSync(caminho)) { console.error(`arquivo não encontrado: ${caminho}`); process.exit(1); }
  const dados = JSON.parse(fs.readFileSync(caminho, 'utf8'));

  const analistas = await sb.get('analistas?select=id,canal_youtube');
  if (!analistas.length) { console.error('nenhum analista cadastrado — rode migracao-analistas.sql (faz o seed dos 4 canais)'); process.exit(1); }
  const idPorCanal = Object.fromEntries(analistas.map((a) => [a.canal_youtube.toLowerCase(), a.id]));

  let totalExtr = 0;
  for (const v of dados.videos ?? []) {
    const analistaId = idPorCanal[String(v.canal_youtube).toLowerCase()];
    if (!analistaId) { console.log(`⚠ canal ${v.canal_youtube} não cadastrado — pulei`); continue; }

    const [conteudo] = await sb.post('analista_conteudos', {
      analista_id: analistaId, video_id: v.video_id, video_titulo: v.video_titulo,
      data_video: v.data_video ?? null, url: v.url ?? null,
      transcricao_bruta: v.transcricao_bruta ?? null,
      status: 'extraido', processado_por: 'manual_bootstrap', processado_em: new Date().toISOString(),
    });

    const linhas = (v.extracoes ?? []).map((x) => ({
      conteudo_id: conteudo.id, analista_id: analistaId,
      jogo_ref: x.partida && x.jogo_data ? `${x.jogo_data}|${x.partida}` : null,
      jogo_data: x.jogo_data ?? null, partida: x.partida ?? null,
      tipo: x.tipo, categoria: x.categoria, texto_resumo: x.texto_resumo,
      mercado_alvo: x.mercado_alvo ?? null, direcao: x.direcao ?? 'neutro', conviccao: x.conviccao ?? 'media',
      processado_por: 'manual_bootstrap',
    }));
    if (linhas.length) await sb.post('analista_extracoes', linhas, 'return=minimal');
    totalExtr += linhas.length;
    console.log(`✓ ${v.canal_youtube} · ${v.video_titulo?.slice(0, 50) ?? v.video_id} → ${linhas.length} extração(ões)`);
  }

  console.log(`\n✅ ${totalExtr} extração(ões) inseridas (manual_bootstrap).`);
  console.log('   Rode a análise (dash → Analisar agora, ou a edge analisar) pra o motor casar as');
  console.log('   extrações com os jogos da janela e popular card + nota + placar.\n');
}

main().catch((e) => { console.error('\n❌ Erro:', e.message, '\n'); process.exit(1); });
