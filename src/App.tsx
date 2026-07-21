import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { Login } from './Login';
import {
  useConfig, useDatas, useAnalise, useBilhetes,
  useRegistrarBilhete, useDefinirResultado, useSalvarConfig, useRodarMotor, useJanela,
  type Bilhete,
} from './dados';
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
  const [sessao, setSessao] = useState<Session | null>(null);
  const [carregandoSessao, setCarregando] = useState(true);

  useEffect(() => {
    // Sinal POSITIVO de que o app montou. A guarda de boot no index.html so age se
    // esta flag nao existir — heuristica de "#root esta vazio" nao distingue "nunca montou"
    // de "montou e o React desmontou por um erro", e foi isso que gerou o loop de reload.
    (window as unknown as { __BELLA_MOUNTED?: boolean }).__BELLA_MOUNTED = true;

    supabase.auth.getSession().then(({ data }) => { setSessao(data.session); setCarregando(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (carregandoSessao) return <div className="flex min-h-screen items-center justify-center bg-fundo text-t3">…</div>;
  if (!sessao) return <Login />;
  return <Dash />;
}

function Dash() {
  const [aba, setAba] = useState<Aba>('hoje');
  const [dataSel, setDataSel] = useState<string | null>(null);

  const qConfig = useConfig();
  const qDatas = useDatas();
  const config = qConfig.data;
  const datas = qDatas.data;
  const data = dataSel ?? datas?.[0] ?? null;
  const qAnalise = useAnalise(data);
  const analise = qAnalise.data;
  const { data: bilhetes } = useBilhetes();
  const { data: janela } = useJanela(data);

  // Falha de consulta NAO pode virar tela vazia: sem isso, 'sem dado' e 'sem conexao'
  // ficam iguais na tela e o diagnostico vira advinhacao.
  const erroQuery = qConfig.error ?? qDatas.error ?? qAnalise.error;

  const registrar = useRegistrarBilhete();
  const definirResultado = useDefinirResultado();
  const salvarConfig = useSalvarConfig();
  const motor = useRodarMotor();
  const [aviso, setAviso] = useState<string | null>(null);

  async function rodar(funcao: 'analisar' | 'bootstrap', corpo?: Record<string, unknown>) {
    setAviso(funcao === 'analisar' ? 'analisando…' : 'atualizando cache…');
    try {
      const r = await motor.mutateAsync({ funcao, corpo });
      setAviso(
        funcao === 'analisar'
          ? `análise pronta: ${r.resumo?.jogos ?? 0} jogos, ${r.resumo?.aprovadas ?? 0} pernas aprovadas · ${r.req?.football ?? 0}+${r.req?.odds ?? 0} requests`
          : `cache atualizado · ${r.req_football ?? 0} requests${(r.faltam?.length ?? 0) ? ` · faltam ${r.faltam.length} liga(s)` : ''}`,
      );
    } catch (e) {
      setAviso(`falhou: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div className="min-h-screen bg-fundo">
      <header className="sticky top-0 z-10 border-b border-borda bg-fundo/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 px-4 py-3">
          <span className="text-lg font-bold tracking-tight text-t1">
            BELLA<span className="text-rosa">BETS</span>
          </span>
          <button
            onClick={() => rodar('analisar')} disabled={motor.isPending}
            className="ml-auto rounded border border-azul px-2 py-1 text-[11px] text-azul disabled:opacity-40"
          >
            Analisar agora
          </button>
          <button
            onClick={() => rodar('bootstrap', { lote: 2 })} disabled={motor.isPending}
            className="rounded border border-borda px-2 py-1 text-[11px] text-t2 disabled:opacity-40"
          >
            Bootstrap
          </button>
          {datas && datas.length > 0 && (
            <select
              value={data ?? ''} onChange={(e) => setDataSel(e.target.value)}
              className="rounded border border-borda bg-card px-2 py-1 text-xs text-t2 outline-none"
            >
              {datas.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          )}
          <button onClick={() => supabase.auth.signOut()} className="text-[11px] text-t3 hover:text-t2">sair</button>
        </div>
        {aviso && <div className="mx-auto max-w-4xl px-4 pb-2 text-[11px] text-azul">{aviso}</div>}
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

      <main className="mx-auto max-w-4xl px-4 py-5 pb-16">
        {erroQuery && (
          <div className="mb-4 rounded-lg border border-vermelho/40 bg-vermelho/10 px-4 py-3 text-sm text-vermelho">
            <b>Falha ao carregar dados.</b> {(erroQuery as Error).message}
          </div>
        )}
        {aba === 'hoje' && (
          <Hoje
            analise={analise ?? null}
            carregando={qAnalise.isLoading}
            data={data}
            onAnalisar={() => rodar('analisar', { data })}
            janela={janela ?? []}
            jaRegistrados={(bilhetes ?? []).map((b) => ({ ...b, stake_rs: b.stake_real })) as never}
            onRegistrar={(b: Bilhete, valor: number) =>
              data && registrar.mutate({ bilhete: b, data, valor })}
          />
        )}
        {aba === 'analises' && <Analises analise={analise ?? null} />}
        {aba === 'historico' && config && (
          <Historico
            registros={(bilhetes ?? []).map((b) => ({ ...b, stake_rs: b.stake_real })) as never}
            config={config as never}
            onResultado={(id: string, r: 'ganhou' | 'perdeu') => {
              const reg = (bilhetes ?? []).find((x) => x.id === id);
              if (reg) definirResultado.mutate({ registro: reg, resultado: r, banca: config.banca });
            }}
          />
        )}
        {aba === 'config' && config && (
          <Configuracoes config={config as never} onSalvar={(c) => salvarConfig.mutate(c as never)} />
        )}
      </main>
    </div>
  );
}
