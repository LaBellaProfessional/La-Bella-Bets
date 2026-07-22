/**
 * HARNESS DE VIEWPORT — gera a página que o `medir-viewport` mede.
 *
 * O dash exige sessão, e medir a tela de login não prova nada sobre as telas que têm cards.
 * Este script puxa uma análise REAL do Supabase e monta um HTML que renderiza as telas com
 * esses dados, sem login. É o que permitiu achar a tabela de 520px em 21/07.
 *
 *   node scripts/harness-viewport.mjs [data]      # default: a análise mais recente
 *   npm run dev
 *   npm run medir-viewport -- http://localhost:5173/viewport.html 390 844
 *
 * Gera `viewport.html` e `src/_viewport.tsx` na raiz — os dois são gitignorados.
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';

const U = process.env.SUPABASE_URL;
const K = process.env.SUPABASE_SECRET_KEY;
if (!U || !K) { console.error('faltam SUPABASE_URL / SUPABASE_SECRET_KEY no .env'); process.exit(2); }

const h = { apikey: K, Authorization: `Bearer ${K}` };
const pegar = async (rota) => (await fetch(`${U}/rest/v1/${rota}`, { headers: h })).json();

const data = process.argv[2];
const filtro = data ? `data=eq.${data}` : 'order=data.desc&limit=1';
const [analise] = await pegar(`analises?select=data,payload&${filtro}`);
if (!analise) { console.error(`sem análise para ${data ?? '(mais recente)'}`); process.exit(1); }
const [config] = await pegar('config?id=eq.1&select=*');
const bilhetes = await pegar('bilhetes?select=*&order=registrado_em.desc');
const sugestoes = await pegar('sugestoes_liquidadas?select=*&order=data.desc');

const APP = `// Gerado por scripts/harness-viewport.mjs — não editar, não versionar.
import { createRoot } from 'react-dom/client';
import { Inicio } from './telas/Inicio';
import { Analises } from './telas/Analises';
import { Historico } from './telas/Historico';
import { Configuracoes } from './telas/Configuracoes';
import './index.css';

const w = window as unknown as { __ANALISE: never; __CONFIG: never; __BILHETES: never; __SUGESTOES: never };

createRoot(document.getElementById('root')!).render(
  <div className="min-h-screen bg-fundo">
    <header className="sticky top-0 z-10 border-b border-borda bg-fundo/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-3">
        <span className="text-lg font-bold tracking-tight text-t1">BELLA<span className="text-rosa">BETS</span></span>
        <button className="ml-auto rounded border border-azul px-2 py-1 text-[11px] text-azul">Analisar agora</button>
        <button className="rounded border border-borda px-2 py-1 text-[11px] text-t2">Bootstrap</button>
        <select className="rounded border border-borda bg-card px-2 py-1 text-xs text-t2"><option>2026-07-21</option></select>
        <button className="text-[11px] text-t3">sair</button>
      </div>
      <nav className="mx-auto flex max-w-4xl gap-1 px-2">
        {['Início', 'Análises', 'Histórico', 'Config'].map((n) => (
          <button key={n} className="px-3 py-2 text-sm text-t3">{n}</button>
        ))}
      </nav>
    </header>
    <main className="mx-auto max-w-4xl px-4 py-5 pb-16">
      <Inicio janela={[w.__ANALISE]} config={w.__CONFIG} jaRegistrados={w.__BILHETES} rascunhos={new Map()} onRegistrar={async () => {}} onSalvarRascunho={() => {}} />
      <Analises analise={w.__ANALISE} />
      <Historico
        registros={(w.__BILHETES as never as { stake_real: number }[]).map((b) => ({ ...b, stake_rs: b.stake_real })) as never}
        config={w.__CONFIG as never}
        sugestoes={w.__SUGESTOES}
        onResultado={() => {}}
      />
      <Configuracoes config={w.__CONFIG as never} onSalvar={() => {}} />
    </main>
  </div>,
);
`;

const HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>harness de viewport</title>
<script>
window.__ANALISE = ${JSON.stringify(analise.payload)};
window.__CONFIG = ${JSON.stringify(config)};
window.__BILHETES = ${JSON.stringify(bilhetes)};
window.__SUGESTOES = ${JSON.stringify(sugestoes)};
<\/script></head>
<body><div id="root"></div><script type="module" src="/src/_viewport.tsx"><\/script></body></html>`;

writeFileSync('src/_viewport.tsx', APP);
writeFileSync('viewport.html', HTML);

const r = analise.payload.resumo ?? {};
console.log(`harness pronto para ${analise.data}`);
console.log(`  ${r.jogos ?? 0} jogos · ${r.aprovadas ?? 0} pernas aprovadas · ${analise.payload.bilhetes?.length ?? 0} bilhetes · ${bilhetes.length} registros`);
console.log('  → npm run dev  e  npm run medir-viewport -- http://localhost:5173/viewport.html 390 844');
