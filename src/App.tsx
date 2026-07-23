import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { Login } from './Login';
import {
  useConfig, useBilhetes, useSugestoes,
  useAlterarResultado, useSalvarConfig, useRodarMotor, useJanelaCompleta, useRegistrarEntrada,
  useApostarFaro, useMontarBilheteFaro, useConciliarBanca, useRascunhos, useSalvarRascunho, indiceSugestoes, classificarAposta,
  brl, emJogoDe, saldoDaSemana, type Registro,
} from './dados';
import { BannerAtualizacao } from './pwa';
import { Inicio } from './telas/Inicio';
import { Apostas } from './telas/Apostas';
import { Historico } from './telas/Historico';
import { Configuracoes } from './telas/Configuracoes';

// A GRANDE SIMPLIFICAÇÃO: a aba Análises deixou de existir — o conteúdo dela vive nos drill-downs
// da Início ("ver análise completa"). "Placar" é a fusão do Histórico (resultado/tripulação/calibração).
type Aba = 'inicio' | 'apostas' | 'historico' | 'config';
const ABAS: { id: Aba; nome: string }[] = [
  { id: 'inicio', nome: 'Início' },
  { id: 'apostas', nome: 'Apostas' },
  { id: 'historico', nome: 'Placar' },
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

  // Banner de atualização SEMPRE montado (login e dash): a checagem ativa não pode depender de
  // estar logado, e o SW novo pode chegar em qualquer tela.
  return (
    <>
      <BannerAtualizacao />
      {carregandoSessao
        ? <div className="flex min-h-screen items-center justify-center bg-fundo text-t3">…</div>
        : !sessao ? <Login /> : <Dash />}
    </>
  );
}

function Dash() {
  const [aba, setAba] = useState<Aba>('inicio');

  const qConfig = useConfig();
  const config = qConfig.data;
  const hojeISO = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
    .toISOString().slice(0, 10);
  const { data: bilhetes } = useBilhetes();
  const { data: sugestoes } = useSugestoes();
  const { data: rascunhos } = useRascunhos();
  const qJanela = useJanelaCompleta(hojeISO);
  const janela = qJanela.data;

  // Índice da liquidação virtual → pré-sugestão das apostas pendentes + badge de "aguardando".
  const sugIndex = useMemo(() => indiceSugestoes(sugestoes), [sugestoes]);
  const nAguardando = useMemo(
    () => (bilhetes ?? []).filter((b) => classificarAposta(b, sugIndex).estado === 'aguardando').length,
    [bilhetes, sugIndex],
  );

  // Falha de consulta NAO pode virar tela vazia: sem isso, 'sem dado' e 'sem conexao'
  // ficam iguais na tela e o diagnostico vira advinhacao.
  const erroQuery = qConfig.error ?? qJanela.error;

  const registrar = useRegistrarEntrada();
  const apostarFaro = useApostarFaro();
  const montarBilhete = useMontarBilheteFaro();
  const conciliar = useConciliarBanca();
  const alterarResultado = useAlterarResultado();
  const salvarRascunho = useSalvarRascunho();
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
      <header className="safe-top sticky top-0 z-20 border-b border-borda bg-fundo/95 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
          <span className="text-lg font-bold tracking-tight text-t1">
            BELLA<span className="text-rosa">BETS</span>
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* Chip da banca consolidada — sempre visível, popover com as camadas. */}
            <ChipBanca banca={config?.banca ?? 0} registros={bilhetes ?? []} />
            {/* Ações que antes eram botões soltos, agora no menu. */}
            <MenuAcoes
              ocupado={motor.isPending}
              onAnalisar={() => rodar('analisar')}
              onAtualizar={() => rodar('bootstrap', { lote: 2 })}
              onSair={() => supabase.auth.signOut()}
            />
          </div>
        </div>
        {aviso && <div className="mx-auto max-w-4xl px-4 pb-2 text-[11px] text-azul">{aviso}</div>}
        <nav className="mx-auto flex max-w-4xl gap-1 px-2">
          {ABAS.map((a) => (
            <button
              key={a.id} onClick={() => setAba(a.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                aba === a.id ? 'border-b-2 border-rosa font-semibold text-t1' : 'text-t3 hover:text-t2'
              }`}
            >
              {a.nome}
              {/* Badge = nº de apostas aguardando confirmação (jogo acabou, falta o dedo). */}
              {a.id === 'apostas' && nAguardando > 0 && (
                <span className="rounded-full bg-ambar px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                  {nAguardando}
                </span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="safe-bottom mx-auto max-w-4xl px-4 py-5">
        {erroQuery && (
          <div className="mb-4 rounded-lg border border-vermelho/40 bg-vermelho/10 px-4 py-3 text-sm text-vermelho">
            <b>Falha ao carregar dados.</b> {(erroQuery as Error).message}
          </div>
        )}
        {aba === 'inicio' && (
          <Inicio
            janela={janela ?? []}
            config={config}
            carregando={qJanela.isLoading}
            jaRegistrados={bilhetes ?? []}
            rascunhos={rascunhos ?? new Map()}
            // mutateAsync (e não mutate): o card precisa do erro pra mostrar na tela.
            // Com mutate, a falha morre no estado do hook e a tela finge que nada aconteceu.
            onRegistrar={(e) => registrar.mutateAsync(e)}
            onApostarFaro={(e) => apostarFaro.mutateAsync(e)}
            onMontarBilhete={(e) => montarBilhete.mutateAsync(e)}
            onSalvarRascunho={(r) => salvarRascunho.mutate(r)}
            onAnalisar={() => rodar('analisar')}
          />
        )}
        {aba === 'apostas' && config && (
          <Apostas
            registros={bilhetes ?? []}
            sugIndex={sugIndex}
            banca={config.banca}
            onAlterar={(registro, novo, detalhe) => alterarResultado.mutateAsync({ registro, novo, banca: config.banca, detalhe })}
            onConciliar={(saldoCasa, emJogo) => conciliar.mutateAsync({ bancaAtual: config.banca, emJogo, saldoCasa })}
          />
        )}
        {aba === 'historico' && config && (
          <Historico
            registros={(bilhetes ?? []).map((b) => ({ ...b, stake_rs: b.stake_real })) as never}
            config={config as never}
            sugestoes={sugestoes ?? []}
            onResultado={(id: string, r: 'ganhou' | 'perdeu') => {
              const reg = (bilhetes ?? []).find((x) => x.id === id);
              if (reg) alterarResultado.mutate({ registro: reg, novo: r, banca: config.banca });
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

/**
 * Chip da banca consolidada no header, estilo casa de aposta: valor sempre visível, toque abre
 * as camadas. Banca vem da mesma fonte da aba Apostas (config + bilhetes), então atualiza reativa
 * quando um resultado é confirmado.
 */
function ChipBanca({ banca, registros }: { banca: number; registros: Registro[] }) {
  const [aberto, setAberto] = useState(false);
  const emJogo = emJogoDe(registros);
  const disponivel = +(banca - emJogo).toFixed(2);
  const saldo = saldoDaSemana(registros);
  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className="rounded-lg border border-borda bg-card px-2.5 py-1 font-mono text-sm font-bold text-t1 tabular-nums"
      >
        {brl(banca)}
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-borda bg-card p-3 text-sm shadow-lg">
            <LinhaChip rotulo="Banca" valor={brl(banca)} />
            <LinhaChip rotulo="Em jogo" valor={brl(emJogo)} cor={emJogo > 0 ? 'text-ambar' : 'text-t1'} />
            <LinhaChip rotulo="Disponível" valor={brl(disponivel)} cor="text-verde" />
            <div className="mt-2 border-t border-borda pt-2">
              <LinhaChip
                rotulo="Saldo da semana"
                valor={`${saldo >= 0 ? '+' : '−'}${brl(Math.abs(saldo))}`}
                cor={saldo >= 0 ? 'text-verde' : 'text-vermelho'}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LinhaChip({ rotulo, valor, cor = 'text-t1' }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="text-xs text-t3">{rotulo}</span>
      <span className={`font-mono text-sm font-semibold tabular-nums ${cor}`}>{valor}</span>
    </div>
  );
}

/** Menu de ações (⋯) — o que antes eram botões soltos no header. */
function MenuAcoes({
  ocupado, onAnalisar, onAtualizar, onSair,
}: {
  ocupado: boolean; onAnalisar: () => void; onAtualizar: () => void; onSair: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const acao = (fn: () => void) => () => { fn(); setAberto(false); };
  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)} aria-label="mais ações"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-borda text-t2"
      >
        {/* lucide MoreVertical */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
        </svg>
      </button>
      {aberto && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-borda bg-card py-1 shadow-lg">
            <button onClick={acao(onAnalisar)} disabled={ocupado} className="block w-full px-3 py-2 text-left text-sm text-t2 hover:bg-fundo disabled:opacity-40">
              Analisar agora
            </button>
            <button onClick={acao(onAtualizar)} disabled={ocupado} className="block w-full px-3 py-2 text-left text-sm text-t2 hover:bg-fundo disabled:opacity-40">
              Atualizar dados
            </button>
            <div className="my-1 border-t border-borda" />
            <button onClick={acao(onSair)} className="block w-full px-3 py-2 text-left text-sm text-t3 hover:bg-fundo">
              Sair
            </button>
          </div>
        </>
      )}
    </div>
  );
}
