#!/usr/bin/env node
/**
 * BELLA BETS — PIPELINE DE INGESTÃO DOS ANALISTAS (roda no PC, não no servidor).
 *
 *   node scripts/ingerir-analistas.mjs            # todos os canais ativos
 *   node scripts/ingerir-analistas.mjs @freitastipster   # um canal só
 *   node scripts/ingerir-analistas.mjs --limite 1        # só o vídeo mais novo de cada
 *
 * Por que no PC: o YouTube bloqueia scraping de datacenter (o RSS e a página do watch vêm com
 * captcha/consent quando vêm de IP de servidor). No PC do Maikon, com IP residencial, passa.
 * Agendar 2x/dia no Task Scheduler (~8h e ~17h) — ver README.
 *
 * Pipeline por canal ativo:
 *   1. resolve o channel_id (UC…) a partir do @handle (1ª vez) — chaveia o RSS
 *   2. lê o RSS (sem API key): vídeos recentes → os que ainda não estão em analista_conteudos
 *   3. baixa a transcrição (timedtext do YouTube; sem transcrição = marca 'sem_transcricao' e segue)
 *   4. extrai com a API Anthropic (Haiku) em JSON estruturado: SEPARA fato/opinião/dado_citado,
 *      categoriza, mapeia a partida com a janela, quebra bilhete múltiplo em palpites, e traduz o
 *      FORMATO DO FREITAS (bloco MENOR = convicção alta, MAIOR = média)
 *   5. grava analista_conteudos + analista_extracoes (processado_por='pipeline'), com custo logado
 *
 * Falha de extração NUNCA derruba o pipeline: loga, marca 'erro' e passa pro próximo vídeo.
 *
 * PRÉ-REQUISITO: ANTHROPIC_API_KEY no .env. Sem a chave, o script faz tudo até a extração e PARA
 * ali com uma mensagem clara (o resto do pipeline fica provado, só falta ligar a chave).
 */
import 'dotenv/config';

const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SECRET_KEY;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
if (!U || !K) { console.error('faltam SUPABASE_URL / SUPABASE_SECRET_KEY no .env'); process.exit(2); }

const MODELO = 'claude-haiku-4-5';
// Preço do Haiku 4.5 (USD por 1M tokens) — pra estimar custo/mês no relatório.
const PRECO = { input: 1.0, output: 5.0 };

const args = process.argv.slice(2);
const canalFiltro = args.find((a) => a.startsWith('@'));
const limite = Number(args[args.indexOf('--limite') + 1]) || 3;

const sb = {
  async get(rota) {
    const r = await fetch(`${U}/rest/v1/${rota}`, { headers: { apikey: K, Authorization: `Bearer ${K}` } });
    if (!r.ok) throw new Error(`supabase GET ${rota}: ${r.status} ${await r.text()}`);
    return r.json();
  },
  async post(tabela, corpo, prefer = 'return=representation') {
    const r = await fetch(`${U}/rest/v1/${tabela}`, {
      method: 'POST',
      headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json', Prefer: prefer },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) throw new Error(`supabase POST ${tabela}: ${r.status} ${await r.text()}`);
    return prefer.includes('representation') ? r.json() : null;
  },
  async patch(rota, corpo) {
    const r = await fetch(`${U}/rest/v1/${rota}`, {
      method: 'PATCH',
      headers: { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    if (!r.ok) throw new Error(`supabase PATCH ${rota}: ${r.status} ${await r.text()}`);
  },
};

/** @handle → channelId (UC…). Faz scrape da página do canal buscando "channelId":"UC…". */
async function resolverChannelId(handle) {
  const r = await fetch(`https://www.youtube.com/${handle}`, { headers: { 'Accept-Language': 'pt-BR' } });
  const html = await r.text();
  const m = /"channelId":"(UC[\w-]+)"/.exec(html) || /"externalId":"(UC[\w-]+)"/.exec(html);
  if (!m) throw new Error(`não achei o channelId de ${handle} (YouTube pode ter pedido consent — rode no PC)`);
  return m[1];
}

/** RSS do canal (sem API key). Devolve [{ video_id, titulo, data, url }] mais recentes primeiro. */
async function lerRSS(channelId) {
  const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!r.ok) throw new Error(`RSS ${channelId}: ${r.status}`);
  const xml = await r.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries.map((e) => {
    const b = e[1];
    const id = /<yt:videoId>(.*?)<\/yt:videoId>/.exec(b)?.[1] ?? null;
    const titulo = /<title>(.*?)<\/title>/.exec(b)?.[1] ?? '';
    const data = /<published>(.*?)<\/published>/.exec(b)?.[1] ?? null;
    return { video_id: id, titulo: decodeXml(titulo), data, url: `https://www.youtube.com/watch?v=${id}` };
  }).filter((v) => v.video_id);
}

const decodeXml = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

/**
 * Transcrição via timedtext do YouTube. Sem lib: pega a página do watch, acha a lista de
 * captionTracks e baixa a primeira (pt preferencial). Sem legendas = null (o chamador marca).
 */
async function baixarTranscricao(videoId) {
  const r = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=pt`, { headers: { 'Accept-Language': 'pt-BR' } });
  const html = await r.text();
  const tracks = /"captionTracks":(\[.*?\])/s.exec(html);
  if (!tracks) return null;
  let lista;
  try { lista = JSON.parse(tracks[1].replace(/\\u0026/g, '&')); } catch { return null; }
  if (!lista.length) return null;
  const pt = lista.find((t) => /pt/i.test(t.languageCode)) ?? lista[0];
  const rt = await fetch(pt.baseUrl);
  const legenda = await rt.text();
  const textos = [...legenda.matchAll(/<text[^>]*>(.*?)<\/text>/g)].map((m) => decodeXml(m[1]).replace(/<[^>]+>/g, ''));
  const bruto = textos.join(' ').replace(/\s+/g, ' ').trim();
  return bruto || null;
}

/** Jogos da janela (partidas + datas) — dá ao extrator o vocabulário pra mapear a partida certa. */
async function janelaDeJogos() {
  const hoje = new Date().toISOString().slice(0, 10);
  const rows = await sb.get(`analises?select=payload&data=gte.${hoje}&order=data.asc&limit=5`);
  const jogos = [];
  for (const r of rows) for (const j of r.payload?.jogos ?? []) jogos.push(`${j.casa} x ${j.fora} | ${r.payload.data} | ${j.liga}`);
  return [...new Set(jogos)];
}

const CATS = 'desfalque|escalacao|tecnico|clima|viagem|moral|palpite|estatistica';
const promptExtracao = (titulo, transcricao, jogos) => `Você é um extrator de conteúdo de canais de apostas de futebol. Recebe a TRANSCRIÇÃO de um vídeo e devolve APENAS um JSON (sem markdown, sem comentário) no formato:

{"extracoes":[{"tipo":"fato|opiniao|dado_citado","categoria":"${CATS}","partida":"Casa x Fora","jogo_data":"AAAA-MM-DD","texto_resumo":"...","mercado_alvo":"<chave|null>","direcao":"a_favor|contra|neutro","conviccao":"baixa|media|alta"}]}

REGRAS:
- SEPARE FATO (informação verificável: desfalque, escalação, viagem, clima) de OPINIÃO (palpite, leitura tática) de DADO_CITADO (número que o analista lê em voz alta: média do árbitro, escanteios por parte, previsão por mercado).
- BILHETE MÚLTIPLO ("bilhete pronto", "minha múltipla"): extraia CADA seleção como uma OPINIÃO separada (uma linha por perna).
- FORMATO DO FREITAS: se houver bloco "MENOR" (aposta mais segura), conviccao="alta"; bloco "MAIOR" (odd alta), conviccao="media".
- mercado_alvo em CHAVE CANÔNICA quando o mercado for do nosso motor: dupla_chance_casa, dupla_chance_fora, resultado_casa, resultado_fora, over_15, over_25, under_25, under_35, esc_over_95 (escanteios). Mercados fora do motor (cartões, escanteios por tempo): use um slug descritivo (ex.: cartoes_over_45) — vale pro placar do analista, só não modula nota.
- direcao: a_favor (aposta no mercado), contra (aposta contra), neutro (só contexto).
- MAPEIE a partida para uma das da janela abaixo (mesma grafia). Se não casar com nenhuma, use o nome como o analista falou e a data que ele indicar.
- Se a transcrição não tiver conteúdo de aposta, devolva {"extracoes":[]}.

JANELA DE JOGOS:
${jogos.join('\n') || '(sem jogos na janela)'}

TÍTULO: ${titulo}

TRANSCRIÇÃO:
${transcricao.slice(0, 14000)}`;

/** Chama a API Anthropic (Haiku) e devolve { extracoes, custo }. Lança se a chave faltar. */
async function extrair(titulo, transcricao, jogos) {
  if (!ANTHROPIC) throw new Error('SEM_CHAVE');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO, max_tokens: 4096,
      messages: [{ role: 'user', content: promptExtracao(titulo, transcricao, jogos) }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic: ${r.status} ${await r.text()}`);
  const j = await r.json();
  const texto = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const limpo = texto.replace(/```json\s*|```/g, '').trim();
  let parsed;
  try { parsed = JSON.parse(limpo); } catch { throw new Error(`JSON inválido do modelo: ${limpo.slice(0, 200)}`); }
  const uso = j.usage ?? {};
  const usd = (uso.input_tokens ?? 0) / 1e6 * PRECO.input + (uso.output_tokens ?? 0) / 1e6 * PRECO.output;
  return {
    extracoes: Array.isArray(parsed.extracoes) ? parsed.extracoes : [],
    custo: { modelo: MODELO, input_tokens: uso.input_tokens ?? 0, output_tokens: uso.output_tokens ?? 0, usd: +usd.toFixed(5) },
  };
}

async function main() {
  console.log(`\n🎬 BELLA BETS — ingestão de analistas${canalFiltro ? ` (${canalFiltro})` : ''}\n`);
  const { data: execRows } = { data: await sb.post('execucoes', { funcao: 'ingerir-analistas', disparo: 'manual' }) };
  const execId = execRows?.[0]?.id;

  let analistas = await sb.get('analistas?select=*&ativo=eq.true');
  if (canalFiltro) analistas = analistas.filter((a) => a.canal_youtube.toLowerCase() === canalFiltro.toLowerCase());
  if (!analistas.length) { console.log('nenhum analista ativo (rodou a migração migracao-analistas.sql?)'); return; }

  const jogos = await janelaDeJogos();
  const jaIngeridos = new Set((await sb.get('analista_conteudos?select=video_id')).map((c) => c.video_id));
  let custoTotal = 0, extraidos = 0, semTranscricao = 0, semChave = false;

  for (const a of analistas) {
    console.log(`— ${a.nome} (${a.canal_youtube})`);
    try {
      let channelId = a.channel_id;
      if (!channelId) {
        channelId = await resolverChannelId(a.canal_youtube);
        await sb.patch(`analistas?id=eq.${a.id}`, { channel_id: channelId });
        console.log(`   channel_id resolvido: ${channelId}`);
      }
      const videos = (await lerRSS(channelId)).slice(0, limite).filter((v) => !jaIngeridos.has(v.video_id));
      if (!videos.length) { console.log('   nada novo no RSS'); continue; }

      for (const v of videos) {
        console.log(`   • ${v.titulo}`);
        const transcricao = await baixarTranscricao(v.video_id);
        const [conteudo] = await sb.post('analista_conteudos', {
          analista_id: a.id, video_id: v.video_id, video_titulo: v.titulo, data_video: v.data,
          url: v.url, transcricao_bruta: transcricao, status: transcricao ? 'novo' : 'sem_transcricao',
        });
        jaIngeridos.add(v.video_id);
        if (!transcricao) { console.log('     sem transcrição — marcado e seguido'); semTranscricao++; continue; }

        let extracoes, custo;
        try { ({ extracoes, custo } = await extrair(v.titulo, transcricao, jogos)); }
        catch (e) {
          if (e.message === 'SEM_CHAVE') { semChave = true; console.log('     ⏸ ANTHROPIC_API_KEY ausente — transcrição salva, extração adiada'); continue; }
          await sb.patch(`analista_conteudos?id=eq.${conteudo.id}`, { status: 'erro', erro: String(e.message).slice(0, 500) });
          console.log(`     ✗ extração falhou (logado, seguindo): ${e.message}`);
          continue;
        }

        if (extracoes.length) {
          await sb.post('analista_extracoes', extracoes.map((x) => ({
            conteudo_id: conteudo.id, analista_id: a.id,
            jogo_ref: x.partida && x.jogo_data ? `${x.jogo_data}|${x.partida}` : null,
            jogo_data: x.jogo_data ?? null, partida: x.partida ?? null,
            tipo: x.tipo, categoria: x.categoria, texto_resumo: x.texto_resumo,
            mercado_alvo: x.mercado_alvo ?? null, direcao: x.direcao ?? 'neutro', conviccao: x.conviccao ?? 'media',
            processado_por: 'pipeline',
          })), 'return=minimal');
        }
        await sb.patch(`analista_conteudos?id=eq.${conteudo.id}`, { status: 'extraido', custo, processado_em: new Date().toISOString() });
        custoTotal += custo.usd; extraidos++;
        console.log(`     ✓ ${extracoes.length} extração(ões) · US$ ${custo.usd.toFixed(4)}`);
      }
    } catch (e) {
      console.log(`   ✗ ${a.nome}: ${e.message}`);
    }
  }

  console.log(`\n💰 custo do run: US$ ${custoTotal.toFixed(4)} · ${extraidos} vídeo(s) extraído(s) · ${semTranscricao} sem transcrição`);
  if (semChave) console.log('⏸ ANTHROPIC_API_KEY ausente: transcrições salvas, extração pendente. Preencha a chave no .env e rode de novo.');
  // Projeção: ~2 runs/dia × ~4 canais × ~1 vídeo. Estimativa grosseira no relatório.
  const est = custoTotal * 2 * 30;
  if (extraidos) console.log(`📈 projeção grosseira: ~US$ ${est.toFixed(2)}/mês (2 runs/dia, mesmo volume)`);
  if (execId) await sb.patch(`execucoes?id=eq.${execId}`, { terminado_em: new Date().toISOString(), ok: true, detalhe: { extraidos, semTranscricao, custo_usd: +custoTotal.toFixed(4), semChave } });
}

main().catch((e) => { console.error('\n❌ Erro:', e.message, '\n'); process.exit(1); });
