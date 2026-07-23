import { useState } from 'react';
import {
  brl, rotuloMercado, horaDaAposta, classificarAposta, emJogoDe, saldoDaSemana, metodoDiria,
  type Registro, type SugLiquidada, type EstadoAposta, type LegDetalhe,
} from '../dados';

/**
 * ABA APOSTAS — a tela de ACOMPANHAR. O funil é: Início decide · Apostas acompanha ·
 * Histórico analisa. Uma entrada registrada some da Início e passa a viver aqui, com um estado:
 *
 *   PENDENTE   — jogo ainda não terminou. Só dá pra desfazer ("não apostei").
 *   AGUARDANDO — todo jogo da aposta encerrou; a liquidação virtual pré-sugere o resultado
 *                ("Terminou 2x1 — indica GANHOU"). A confirmação é manual e move a banca.
 *   GANHOU/PERDEU — resolvida. Verde/vermelha, com retorno/lucro ou −stake. Dá pra corrigir.
 *
 * "Não apostei" grava 'cancelada' (some da lista, não afeta banca; a linha fica pra auditoria).
 */
export function Apostas({
  registros, sugIndex, banca, onAlterar, onConciliar,
}: {
  registros: Registro[];
  sugIndex: Map<string, SugLiquidada>;
  banca: number;
  onAlterar: (registro: Registro, novo: 'ganhou' | 'perdeu' | 'cancelada', detalhe?: string) => Promise<unknown>;
  onConciliar?: (saldoCasa: number, emJogo: number) => Promise<unknown>;
}) {
  // Cancelada não aparece: "não apostei" tira da lista.
  const vivas = registros
    .filter((r) => r.resultado !== 'cancelada')
    .map((r) => ({ r, ...classificarAposta(r, sugIndex) }));

  const ORDEM: Record<EstadoAposta, number> = { aguardando: 0, pendente: 1, ganhou: 2, perdeu: 2, cancelada: 3 };
  const ordenadas = [...vivas].sort((a, b) => {
    if (ORDEM[a.estado] !== ORDEM[b.estado]) return ORDEM[a.estado] - ORDEM[b.estado];
    if (a.estado === 'pendente') return horaDaAposta(a.r).localeCompare(horaDaAposta(b.r)); // por horário
    if (a.estado === 'aguardando') return horaDaAposta(a.r).localeCompare(horaDaAposta(b.r));
    // resolvidas: mais recentes em cima
    return (b.r.resolvido_em ?? b.r.registrado_em).localeCompare(a.r.resolvido_em ?? a.r.registrado_em);
  });

  // Resumo do topo.
  const nPend = vivas.filter((v) => v.estado === 'pendente' || v.estado === 'aguardando').length;
  const nVerde = vivas.filter((v) => v.estado === 'ganhou').length;
  const nVermelha = vivas.filter((v) => v.estado === 'perdeu').length;
  const saldoSemana = saldoDaSemana(registros);

  // Banca em DUAS CAMADAS. "Em jogo" é DERIVADO (soma dos stakes pendentes); disponível é o resto.
  // Confirmar o resultado tira a aposta de pendente e ela sai do "em jogo" sozinha. Mesma fonte
  // que alimenta o chip da banca no header.
  const emJogo = emJogoDe(registros);
  const disponivel = +(banca - emJogo).toFixed(2);

  if (!vivas.length) {
    return (
      <div className="rounded-xl border border-borda bg-card p-10 text-center">
        <div className="text-lg font-medium text-t1">Nenhuma aposta em jogo</div>
        <div className="mt-2 text-sm text-t2">Registre uma entrada na aba Início e ela aparece aqui pra acompanhar.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      {/* RESUMO */}
      <div className="rounded-xl border border-borda bg-card px-4 py-3 text-sm">
        {/* Banca em duas camadas: consolidada · em jogo (derivado) · disponível calculado. */}
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-borda pb-2">
          <span className="text-t2">Banca <b className="text-t1">{brl(banca)}</b></span>
          <span className="text-t3">·</span>
          <span className="text-t2">Em jogo <b className={emJogo > 0 ? 'text-ambar' : 'text-t1'}>{brl(emJogo)}</b></span>
          <span className="text-t3">·</span>
          <span className="text-t2">Disponível calculado <b className="text-verde">{brl(disponivel)}</b></span>
        </div>

        {/* CONCILIAÇÃO COM A CASA (Parte 2): o saldo da bet365 é autoritativo. */}
        {onConciliar && <Conciliacao banca={banca} emJogo={emJogo} disponivel={disponivel} onConciliar={onConciliar} />}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-t2">
          <b className="text-t1">{nPend}</b> {nPend === 1 ? 'pendente' : 'pendentes'}
          <span className="text-t3">·</span>
          <b className="text-verde">{nVerde}</b> {nVerde === 1 ? 'verde' : 'verdes'}
          <span className="text-t3">·</span>
          <b className="text-vermelho">{nVermelha}</b> {nVermelha === 1 ? 'vermelha' : 'vermelhas'}
          <span className="text-t3">·</span>
          <span className="text-t2">
            saldo da semana{' '}
            <b className={saldoSemana >= 0 ? 'text-verde' : 'text-vermelho'}>
              {saldoSemana >= 0 ? '+' : '−'}{brl(Math.abs(saldoSemana))}
            </b>
          </span>
        </div>
      </div>

      {ordenadas.map((v) => (
        <CardAposta key={v.r.id} registro={v.r} estado={v.estado} pre={v.pre} legs={v.legs} bateram={v.bateram} banca={banca} onAlterar={onAlterar} />
      ))}
    </div>
  );
}

/**
 * CONCILIAÇÃO COM A CASA (Parte 2) — casa em 30s, auditada. Digita o saldo real da bet365; se
 * divergir mais de R$1 do disponível calculado, oferece ajustar a banca consolidada (banca nova =
 * saldo da casa + em jogo). O ajuste vira evento em bilhete_eventos (tipo='ajuste_banca').
 */
function Conciliacao({
  banca, emJogo, disponivel, onConciliar,
}: {
  banca: number; emJogo: number; disponivel: number;
  onConciliar: (saldoCasa: number, emJogo: number) => Promise<unknown>;
}) {
  const [aberto, setAberto] = useState(false);
  const [txt, setTxt] = useState('');
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'ok' | 'erro'>('ocioso');
  const [erro, setErro] = useState<string | null>(null);

  const saldo = Number(txt.replace(',', '.'));
  const valido = Number.isFinite(saldo) && saldo >= 0 && txt.trim() !== '';
  const diff = valido ? +(saldo - disponivel).toFixed(2) : 0;   // casa − calculado
  const divergente = valido && Math.abs(diff) > 1;
  const novaBanca = valido ? +(saldo + emJogo).toFixed(2) : banca;

  async function ajustar() {
    setEstado('enviando'); setErro(null);
    try { await onConciliar(saldo, emJogo); setEstado('ok'); }
    catch (e) { setEstado('erro'); setErro(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="mb-1">
      {!aberto ? (
        <button onClick={() => setAberto(true)} className="text-[11px] text-t3 underline hover:text-t2">
          conferir com a casa
        </button>
      ) : (
        <div className="rounded-lg border border-borda bg-fundo px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-t2">Saldo real na bet365</span>
            <span className="text-[11px] text-t3">R$</span>
            <input
              type="text" inputMode="decimal" value={txt} autoFocus
              onChange={(e) => { setTxt(e.target.value); if (estado !== 'ocioso') setEstado('ocioso'); }}
              placeholder="431,09"
              className="w-24 rounded border border-borda bg-card px-2 py-1 font-mono text-sm text-t1 outline-none focus:border-azul"
            />
            <button onClick={() => { setAberto(false); setTxt(''); setEstado('ocioso'); }} className="text-[11px] text-t3 hover:text-t2">fechar</button>
          </div>

          {valido && (
            <div className="mt-2 text-[11px] leading-snug">
              <div className="text-t3">
                calculado <b className="text-t2">{brl(disponivel)}</b> · casa <b className="text-t2">{brl(saldo)}</b> ·{' '}
                diferença <b className={Math.abs(diff) <= 1 ? 'text-verde' : 'text-ambar'}>{diff >= 0 ? '+' : '−'}{brl(Math.abs(diff))}</b>
              </div>
              {estado === 'ok' ? (
                <div className="mt-1 text-verde">banca conciliada ✓</div>
              ) : divergente ? (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <span className="text-ambar">Diverge — ajustar banca pra {brl(novaBanca)}?</span>
                  <button
                    disabled={estado === 'enviando'} onClick={ajustar}
                    className="rounded bg-ambar px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    {estado === 'enviando' ? 'ajustando…' : 'ajustar banca'}
                  </button>
                </div>
              ) : (
                <div className="mt-1 text-verde">bate (diferença ≤ R$1) — nada a fazer</div>
              )}
              {estado === 'erro' && <div className="mt-1 text-vermelho break-words">Não ajustou: {erro}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ESTILO: Record<EstadoAposta, { borda: string; tag: string; rotulo: string }> = {
  pendente:   { borda: 'border-borda',          tag: 'bg-fundo text-t3',           rotulo: 'PENDENTE' },
  aguardando: { borda: 'border-ambar/50',       tag: 'bg-ambar/15 text-ambar',     rotulo: 'AGUARDANDO CONFIRMAÇÃO' },
  ganhou:     { borda: 'border-verde/60',       tag: 'bg-verde/15 text-verde',     rotulo: 'GANHOU' },
  perdeu:     { borda: 'border-vermelho/60',    tag: 'bg-vermelho/15 text-vermelho', rotulo: 'PERDEU' },
  cancelada:  { borda: 'border-borda',          tag: 'bg-fundo text-t3',           rotulo: 'NÃO APOSTEI' },
};

function CardAposta({
  registro, estado, pre, legs, bateram, banca, onAlterar,
}: {
  registro: Registro; estado: EstadoAposta;
  pre?: { resultado: 'ganhou' | 'perdeu'; placar: string };
  legs?: LegDetalhe[]; bateram?: number;
  banca: number;
  onAlterar: (registro: Registro, novo: 'ganhou' | 'perdeu' | 'cancelada', detalhe?: string) => Promise<unknown>;
}) {
  const [aberto, setAberto] = useState(false); // reabre os botões numa resolvida/pendente
  const [enviando, setEnviando] = useState<null | 'ganhou' | 'perdeu' | 'cancelada'>(null);
  const [erro, setErro] = useState<string | null>(null);
  const s = ESTILO[estado];

  const ehFaro = registro.origem === 'maikon_faro';
  const ehAnalistas = registro.origem === 'analistas';
  const jogos = [...new Set(registro.pernas.map((p) => p.partida))];
  const titulo = jogos.join('  +  ');
  const mercados = registro.pernas.map((p) => p.rotulo ?? rotuloMercado(p.mercado)).join('  +  ');
  const hora = horaDaAposta(registro);
  const lucro = registro.retorno_rs - registro.stake_real;

  // Contexto pra auditoria (bilhete_eventos.detalhe). O caso mais valioso: registrar quando a
  // confirmação CONTRARIOU a pré-sugestão da liquidação virtual.
  function detalheDe(novo: 'ganhou' | 'perdeu' | 'cancelada'): string | undefined {
    if (estado === 'ganhou' || estado === 'perdeu') return `correção (era ${estado})`;
    if (estado === 'aguardando' && pre) {
      return novo === pre.resultado ? 'confirmado (pré-sugestão)' : `contrariou pré-sugestão (indicava ${pre.resultado})`;
    }
    if (estado === 'pendente') return novo === 'cancelada' ? 'desfeito (pendente)' : 'marcado manualmente';
    return undefined;
  }

  async function acao(novo: 'ganhou' | 'perdeu' | 'cancelada') {
    setEnviando(novo); setErro(null);
    try { await onAlterar(registro, novo, detalheDe(novo)); setAberto(false); }
    catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setEnviando(null); }
  }

  const Botoes = ({ destaque }: { destaque?: 'ganhou' | 'perdeu' }) => (
    <div className="mt-2 flex flex-wrap gap-2">
      <button disabled={!!enviando} onClick={() => acao('ganhou')}
        className={`rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
          destaque === 'ganhou' ? 'bg-verde text-white' : 'bg-verde/15 text-verde'}`}>
        {enviando === 'ganhou' ? '…' : 'Ganhei'}
      </button>
      <button disabled={!!enviando} onClick={() => acao('perdeu')}
        className={`rounded px-3 py-1.5 text-sm font-semibold disabled:opacity-50 ${
          destaque === 'perdeu' ? 'bg-vermelho text-white' : 'bg-vermelho/15 text-vermelho'}`}>
        {enviando === 'perdeu' ? '…' : 'Perdi'}
      </button>
      <button disabled={!!enviando} onClick={() => acao('cancelada')}
        className="rounded border border-borda px-3 py-1.5 text-sm text-t3 disabled:opacity-50">
        {enviando === 'cancelada' ? '…' : 'Não apostei'}
      </button>
    </div>
  );

  return (
    <div className={`overflow-hidden rounded-xl border bg-card ${s.borda}`}>
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${s.tag}`}>{s.rotulo}</span>
            {/* Selo de proveniência: FARO (cor distinta) e ANALISTAS têm porta própria. */}
            {ehFaro && (
              <span className="rounded bg-roxo/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-roxo">faro</span>
            )}
            {ehAnalistas && (
              <span className="rounded bg-laranja/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-laranja">analistas</span>
            )}
          </div>
          <span className="font-mono text-xs text-t3">
            {registro.data}{hora ? ` · ${hora}` : ''} · @{registro.odd_total.toFixed(2)} · {brl(registro.stake_real)}
          </span>
        </div>

        <div className="mt-2 text-sm font-semibold leading-snug text-t1 break-words">{titulo}</div>
        <div className="mt-0.5 text-xs text-azul break-words">{mercados}</div>

        {/* FARO: o que o método diria no momento da aposta — o "contra o quê" do faro. */}
        {ehFaro && registro.snapshot_metodo && (
          <div className="mt-2 rounded-lg border border-roxo/25 bg-roxo/5 px-2.5 py-1.5 text-[11px] leading-snug text-t2">
            <span className="text-roxo">faro:</span> {metodoDiria(registro.snapshot_metodo)}
          </div>
        )}

        {/* Pernas detalhadas quando é combinada — com o resultado PERNA A PERNA (Parte 1.3). */}
        {registro.pernas.length > 1 && (
          <div className="mt-2 space-y-1">
            {(registro.tipo === 'multipla_propria' || (registro.n_pernas ?? 0) > 1) && (bateram != null) && (
              <div className="mb-1 text-[11px] text-t2">
                <b>{bateram} de {registro.pernas.length}</b> {registro.pernas.length === 1 ? 'perna bateu' : 'pernas bateram'}
                {estado === 'perdeu' && ' — perdeu'}
                {estado === 'ganhou' && ' — bateu tudo'}
              </div>
            )}
            {registro.pernas.map((p, i) => {
              const res = legs?.[i]?.resultado ?? 'pendente';
              const ic = res === 'ganhou' ? { s: '✓', c: 'text-verde' } : res === 'perdeu' ? { s: '✗', c: 'text-vermelho' } : { s: '○', c: 'text-t3' };
              return (
                <div key={i} className="flex items-baseline gap-1.5 border-l-2 border-borda pl-2 text-xs text-t2 break-words">
                  <span className={`shrink-0 ${ic.c}`}>{ic.s}</span>
                  <span className="min-w-0">
                    {p.partida} · {p.rotulo ?? rotuloMercado(p.mercado)}
                    {p.odd != null && <span className="font-mono text-t3"> @{p.odd}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── AGUARDANDO: pré-sugestão + botões (a sugerida em destaque) ── */}
        {estado === 'aguardando' && pre && (
          <div className="mt-3 rounded-lg bg-ambar/10 p-2.5">
            <div className="text-xs leading-snug text-ambar">
              Terminou <b>{pre.placar}</b> — indica <b>{pre.resultado === 'ganhou' ? 'GANHOU' : 'PERDEU'}</b>. Confirmar?
            </div>
            <Botoes destaque={pre.resultado} />
          </div>
        )}

        {/* ── PENDENTE: desfazer + fallback de marcação manual ── */}
        {estado === 'pendente' && (
          <div className="mt-3">
            {!aberto ? (
              <div className="flex flex-wrap items-center gap-3">
                <button disabled={!!enviando} onClick={() => acao('cancelada')}
                  className="rounded border border-borda px-3 py-1.5 text-sm text-t3 disabled:opacity-50">
                  {enviando === 'cancelada' ? 'removendo…' : 'desfazer / não apostei'}
                </button>
                <button onClick={() => setAberto(true)} className="text-xs text-t3 underline hover:text-t2">
                  já terminou? marcar resultado
                </button>
              </div>
            ) : (
              <Botoes />
            )}
          </div>
        )}

        {/* ── RESOLVIDA: valor + corrigir ── */}
        {(estado === 'ganhou' || estado === 'perdeu') && (
          <div className="mt-3">
            <div className={`text-sm font-semibold ${estado === 'ganhou' ? 'text-verde' : 'text-vermelho'}`}>
              {estado === 'ganhou'
                ? `retorno ${brl(registro.retorno_rs)} · lucro +${brl(lucro)}`
                : `−${brl(registro.stake_real)}`}
            </div>
            {!aberto ? (
              <button onClick={() => setAberto(true)} className="mt-1 text-xs text-t3 underline hover:text-t2">
                corrigir resultado
              </button>
            ) : (
              <>
                <div className="mt-1 text-[11px] text-t3">
                  Corrigir reverte o efeito na banca (hoje {brl(banca)}) e aplica o novo.
                </div>
                <Botoes />
              </>
            )}
          </div>
        )}

        {erro && (
          <div className="mt-2 rounded border border-vermelho/40 bg-vermelho/10 px-2 py-1.5 text-[11px] leading-snug text-vermelho break-words">
            {/(check constraint|resultado_check)/i.test(erro)
              ? 'Corrigir / “não apostei” precisa da migração de Apostas — rode supabase/migracao-apostas.sql no SQL editor.'
              : `Não deu: ${erro}`}
          </div>
        )}
      </div>
    </div>
  );
}
