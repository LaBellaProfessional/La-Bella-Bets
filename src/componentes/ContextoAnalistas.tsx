import { rotuloMercado, type ContextoAnalistas, type ExtracaoResumo } from '../dados';

/**
 * SEÇÃO "CONTEXTO DOS ANALISTAS" no card do jogo (Parte A). Mostra o que a máquina não vê:
 *   · FATO consensual (2+ analistas) → alerta LARANJA no topo.
 *   · fatos e dados citados → contexto informativo (fonte + data), nunca modulam nota.
 *   · opiniões → analista, direção, convicção (essas sim modulam a nota, decomposta na entrada).
 * Extração processada à mão (manual_bootstrap) leva um selinho "manual" — honestidade de origem.
 */

const ICONE: Record<string, string> = {
  desfalque: '🚑', escalacao: '📋', tecnico: '🎽', clima: '🌧️',
  viagem: '✈️', moral: '🔥', palpite: '🎯', estatistica: '📊',
};

function DirecaoTag({ direcao }: { direcao: string | null }) {
  if (direcao === 'a_favor') return <span className="text-verde">a favor</span>;
  if (direcao === 'contra') return <span className="text-vermelho">contra</span>;
  return <span className="text-t3">neutro</span>;
}

function LinhaExtracao({ e, mostrarMercado }: { e: ExtracaoResumo; mostrarMercado?: boolean }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="mt-0.5 shrink-0 text-sm leading-none" aria-hidden>{ICONE[e.categoria] ?? '•'}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] leading-snug text-t2 break-words">{e.texto}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-t3">
          <span className="text-t2">{e.analista}</span>
          {e.data && <span>· {e.data}</span>}
          {mostrarMercado && e.mercado && <span>· {rotuloMercado(e.mercado)}</span>}
          {e.direcao && e.tipo === 'opiniao' && <span>· <DirecaoTag direcao={e.direcao} /></span>}
          {e.conviccao && e.tipo === 'opiniao' && <span>· convicção {e.conviccao}</span>}
          {e.manual && <span className="rounded bg-borda px-1 text-[9px] uppercase tracking-wider text-t3">manual</span>}
        </div>
      </div>
    </div>
  );
}

export function SecaoContextoAnalistas({ contexto }: { contexto?: ContextoAnalistas | null }) {
  if (!contexto) return null;
  const { fatos, dados_citados, opinioes, consenso_laranja } = contexto;
  if (!fatos.length && !dados_citados.length && !opinioes.length) return null;

  return (
    <div className="rounded-lg border border-borda bg-fundo px-3 py-2">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-t3">contexto dos analistas</span>
      </div>

      {/* ALERTA LARANJA: fato consensual (2+ analistas, mesma categoria, <48h) = força total. */}
      {consenso_laranja && (
        <div className="mb-2 rounded border border-laranja/40 bg-laranja/10 px-2 py-1.5 text-[11px] leading-snug text-laranja">
          <b>Fato consensual</b> — {consenso_laranja.n_analistas} analistas ({consenso_laranja.categoria}):{' '}
          {consenso_laranja.textos.join(' · ')}
        </div>
      )}

      {fatos.length > 0 && (
        <div className="mb-1">
          <div className="text-[10px] uppercase tracking-wider text-t3">fatos</div>
          {fatos.map((e, i) => <LinhaExtracao key={`f${i}`} e={e} />)}
        </div>
      )}
      {opinioes.length > 0 && (
        <div className="mb-1">
          <div className="text-[10px] uppercase tracking-wider text-t3">opiniões</div>
          {opinioes.map((e, i) => <LinhaExtracao key={`o${i}`} e={e} mostrarMercado />)}
        </div>
      )}
      {dados_citados.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-t3">dados citados</div>
          {dados_citados.map((e, i) => <LinhaExtracao key={`d${i}`} e={e} mostrarMercado />)}
          <div className="mt-0.5 text-[10px] leading-snug text-t3">dados citados são contexto — não modulam a nota</div>
        </div>
      )}
    </div>
  );
}
