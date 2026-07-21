import { useMemo, useState } from 'react';
import { useDados, type Bilhete, type Registro } from './dados';
import { Hoje } from './telas/Hoje';
import { Analises } from './telas/Analises';
import { Historico } from './telas/Historico';
import { Configuracoes } from './telas/Configuracoes';

type Aba = 'hoje' | 'analises' | 'historico' | 'config';
const ABAS: { id: Aba; nome: string }[] = [
  { id: 'hoje', nome: 'Hoje' },
  { id: 'analises', nome: 'Análises' },
  { id: 'historico', nome: 'Histórico' },
  { id: 'config', nome: 'Config' },
];

export default function App() {
  const { dados, erro, salvarBilhetes, salvarConfig } = useDados();
  const [aba, setAba] = useState<Aba>('hoje');
  const [dataSel, setDataSel] = useState<string | null>(null);

  const data = dataSel ?? dados?.datas[0] ?? null;
  const analise = useMemo(() => (data && dados ? dados.analises[data] : null), [data, dados]);

  async function registrarBilhete(b: Bilhete, valor: number) {
    if (!dados || !analise) return;
    const novo: Registro = {
      id: `${analise.data}-${b.ordem}-${Date.now()}`,
      data: analise.data,
      registrado_em: new Date().toISOString(),
      pernas: b.pernas.map((p) => ({ partida: p.partida, mercado: p.mercado, odd: p.odd ?? 0 })),
      odd_total: b.odd_total,
      prob_combinada: b.prob_combinada,
      ev_pct: b.ev_pct,
      stake_rs: valor,
      resultado: 'pendente',
      retorno_rs: 0,
      banca_depois: null,
    };
    await salvarBilhetes([...dados.bilhetes, novo]);
  }

  async function definirResultado(id: string, resultado: 'ganhou' | 'perdeu') {
    if (!dados) return;
    const lista = dados.bilhetes.map((r) => {
      if (r.id !== id) return r;
      const retorno = resultado === 'ganhou' ? +(r.stake_rs * r.odd_total).toFixed(2) : 0;
      return { ...r, resultado, retorno_rs: retorno };
    });
    const alvo = lista.find((r) => r.id === id)!;
    // A banca só muda aqui: registrar o resultado é o ato que move dinheiro de verdade.
    const delta = alvo.retorno_rs - alvo.stake_rs;
    const banca = +(dados.config.banca + delta).toFixed(2);
    alvo.banca_depois = banca;
    await salvarBilhetes(lista);
    await salvarConfig({ ...dados.config, banca });
  }

  if (erro) {
    return (
      <Layout aba={aba} setAba={setAba} datas={[]} data={null} setData={setDataSel}>
        <div className="rounded-xl border border-vermelho/40 bg-vermelho/10 p-6 text-sm text-vermelho">
          Não consegui ler <code>/data</code>: {erro}
          <div className="mt-2 text-t2">
            O dash precisa do dev server (<code>npm run dev</code>) — é ele que lê e grava os JSONs.
          </div>
        </div>
      </Layout>
    );
  }
  if (!dados) {
    return (
      <Layout aba={aba} setAba={setAba} datas={[]} data={null} setData={setDataSel}>
        <div className="text-t3">carregando…</div>
      </Layout>
    );
  }

  return (
    <Layout aba={aba} setAba={setAba} datas={dados.datas} data={data} setData={setDataSel}>
      {aba === 'hoje' && <Hoje analise={analise} jaRegistrados={dados.bilhetes} onRegistrar={registrarBilhete} />}
      {aba === 'analises' && <Analises analise={analise} />}
      {aba === 'historico' && <Historico registros={dados.bilhetes} config={dados.config} onResultado={definirResultado} />}
      {aba === 'config' && <Configuracoes config={dados.config} onSalvar={salvarConfig} />}
    </Layout>
  );
}

function Layout({
  aba, setAba, datas, data, setData, children,
}: {
  aba: Aba; setAba: (a: Aba) => void; datas: string[]; data: string | null;
  setData: (d: string) => void; children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-fundo">
      <header className="sticky top-0 z-10 border-b border-borda bg-fundo/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-lg font-bold tracking-tight text-t1">
            BELLA<span className="text-rosa">BETS</span>
          </span>
          {datas.length > 0 && (
            <select
              value={data ?? ''} onChange={(e) => setData(e.target.value)}
              className="ml-auto rounded border border-borda bg-card px-2 py-1 text-xs text-t2 outline-none"
            >
              {datas.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
        </div>
        <nav className="mx-auto flex max-w-4xl gap-1 px-2">
          {ABAS.map((a) => (
            <button
              key={a.id} onClick={() => setAba(a.id)}
              className={`px-3 py-2 text-sm transition-colors ${
                aba === a.id ? 'border-b-2 border-rosa font-semibold text-t1' : 'text-t3 hover:text-t2'
              }`}
            >
              {a.nome}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-5 pb-16">{children}</main>
    </div>
  );
}
