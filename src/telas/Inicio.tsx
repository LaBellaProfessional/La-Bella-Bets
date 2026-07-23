import { useEffect, useState } from 'react';
import {
  mercadoHumano, notaPalavra, chaveEntrada, snapshotDaPerna,
  type Analise, type Config, type Perna, type Registro, type Rascunho, type SnapshotMetodo, type ContextoAnalistas,
} from '../dados';
import { vereditoOdd } from '../../supabase/functions/_shared/veredito.js';
import { DrilldownJogo } from '../componentes/DrilldownJogo';

/**
 * ABA INÍCIO — A GRANDE SIMPLIFICAÇÃO. Uma lista única, ranqueada por nota, em linguagem humana.
 * O app é o ritual de 5 minutos de um apostador, não um painel de trader. Jargão (heurística,
 * Dixon-Coles, EV, radar, origem) mora no porão (drill-down "ver análise completa"). Aqui em cima:
 * "os dois modelos", "chance real", "paga acima do que vale", "esperar a véspera".
 *
 *   Bloco 1 — MELHORES DE HOJE: até 5 cards por nota (o card é a unidade sagrada).
 *   Bloco 2 — MONTAR MÚLTIPLA: "+" nos cards → barra flutuante → odd total → registrar bilhete.
 *   Bloco 3 — OUTRAS OPORTUNIDADES (colapsado): esperar-véspera, aguarda-preço, nota baixa.
 *   Bloco 4 — RODAPÉ: "N jogos sem valor · ver todos" + "Próximos dias (N) ▸".
 *
 * Registro: sempre habilitado. Contra o veredito o botão vira "Registrar assim mesmo" (âmbar) e
 * grava com origem/snapshot do faro — invisível pro usuário, ouro pra calibração.
 */

const DIA_MS = 86400000;
const hojeSP = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());

function rotuloDoDia(data: string): string {
  const hoje = hojeSP();
  const diff = Math.round((new Date(data + 'T12:00:00Z').getTime() - new Date(hoje + 'T12:00:00Z').getTime()) / DIA_MS);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Amanhã';
  const [a, m, d] = data.split('-');
  return `${d}/${m}/${a.slice(2)}`;
}

export function Vazio({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-borda bg-card p-10 text-center">
      <div className="text-lg font-medium text-t1">{titulo}</div>
      <div className="mt-2 text-sm text-t2">{children}</div>
    </div>
  );
}

export interface EntradaRegistro {
  data: string; pernas: Perna[]; odd_real: number; odd_referencia: number | null;
  prob: number; stake: number; casa_odd: string | null;
}
export interface EntradaFaro {
  data: string; perna: Perna; odd_real: number; stake: number; casa_odd: string | null; snapshot: SnapshotMetodo;
}
export interface EntradaMultipla {
  data: string; pernas: Perna[]; odd_total: number; stake: number; casa_odd: string | null;
}
export interface SalvarRascunho {
  (r: { chave: string; data: string; partida: string | null; mercado: string | null; odd_casa: number | null; stake: number | null }): void;
}

/** Odd digitada (aceita vírgula) → número válido ou null. */
function normalizarOdd(bruto: string): number | null {
  const n = Number(String(bruto).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? +n.toFixed(2) : null;
}

/** Categoria da entrada na lista única. */
type Categoria = 'agora' | 'esperar' | 'aguarda';
function categoria(p: Perna): Categoria | null {
  if (!p.aprovada) return null;               // reprovada só vive no drill-down
  if (p.radar) return 'esperar';              // esperar a véspera
  if (p.aguarda_odd) return 'aguarda';        // a casa ainda não abriu preço
  return 'agora';                             // dá pra registrar já
}

/** O porquê em UMA frase, sem jargão. Vem do estado do modelo, não da odd digitada. */
function frasePorque(p: Perna): string {
  let modelo: string;
  if (p.prob_heuristica != null && p.prob_dixon_coles != null) {
    const div = Math.abs(p.prob_heuristica - p.prob_dixon_coles) * 100;
    modelo = div <= 6 ? 'Os dois modelos concordam'
      : div <= 12 ? 'Os dois modelos concordam em boa parte'
      : 'Os modelos ainda divergem um pouco';
  } else {
    modelo = 'O modelo vê chance boa';
  }
  const valor = p.sem_odd_referencia
    ? 'e a casa ainda não abriu preço — digite o da sua'
    : (p.ev_pct ?? 0) >= 4
      ? 'e a odd paga acima do que a chance real justifica'
      : 'e o preço está no limite do que vale';
  return `${modelo} ${valor}.`;
}

/** Quantos analistas concordam com ESTA entrada (opinião a favor do mesmo mercado). */
function analistasConcordam(p: Perna, ctx?: ContextoAnalistas | null): number {
  if (!ctx) return 0;
  const nomes = new Set(ctx.opinioes.filter((o) => o.mercado === p.mercado && o.direcao === 'a_favor').map((o) => o.analista));
  return nomes.size;
}

export function Inicio({
  janela, config, carregando, jaRegistrados, rascunhos, onRegistrar, onApostarFaro, onMontarBilhete, onSalvarRascunho, onAnalisar,
}: {
  janela: Analise[]; config?: Config; carregando?: boolean;
  jaRegistrados: Registro[]; rascunhos: Map<string, Rascunho>;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
  onApostarFaro: (e: EntradaFaro) => Promise<unknown>;
  onMontarBilhete: (e: EntradaMultipla) => Promise<unknown>;
  onSalvarRascunho: SalvarRascunho;
  onAnalisar?: () => void;
}) {
  // Seleção da múltipla e drill-down são estado da tela toda (barra flutuante + overlay).
  const [sel, setSel] = useState<Record<string, Perna>>({});
  const [drill, setDrill] = useState<{ data: string; jogoId: string } | null>(null);

  if (carregando) return <Vazio titulo="Carregando…">Buscando as análises no servidor.</Vazio>;
  if (!janela.length) {
    return (
      <Vazio titulo="Nenhuma análise ainda">
        O motor roda sozinho todo dia às 09:00.
        {onAnalisar && (
          <button onClick={onAnalisar} className="mt-4 block w-full rounded bg-rosa py-2 text-sm font-semibold text-white">
            Analisar agora
          </button>
        )}
      </Vazio>
    );
  }

  const hoje = janela[0];
  const futuros = janela.slice(1);
  const registrados = new Set(
    (jaRegistrados ?? []).filter((r) => r.resultado !== 'cancelada').map((r) => chaveEntrada(r.data, r.pernas ?? [])),
  );

  const chaveP = (p: Perna) => `${p.jogo_id}|${p.mercado}`;
  const toggleSel = (p: Perna) => setSel((s) => { const n = { ...s }; const k = chaveP(p); if (n[k]) delete n[k]; else n[k] = p; return n; });
  const selecionadas = Object.values(sel);

  // Entradas do dia, deduplicadas e sem as já registradas.
  const vistas = new Set<string>();
  const entradas = (hoje.pernas ?? [])
    .filter((p) => { const k = chaveP(p); if (vistas.has(k)) return false; vistas.add(k); return true; })
    .filter((p) => categoria(p) !== null)
    .filter((p) => !registrados.has(chaveEntrada(hoje.data, [p])));

  const nota = (p: Perna) => p.nota ?? -1;
  const agora = entradas.filter((p) => categoria(p) === 'agora').sort((a, b) => nota(b) - nota(a));
  const melhores = agora.slice(0, 5);
  const outras = [
    ...agora.slice(5),
    ...entradas.filter((p) => categoria(p) === 'esperar').sort((a, b) => nota(b) - nota(a)),
    ...entradas.filter((p) => categoria(p) === 'aguarda').sort((a, b) => nota(b) - nota(a)),
  ];

  // Jogos analisados sem valor: sem nenhuma entrada acionável (aprovada/esperar/aguarda).
  const comEntrada = new Set(entradas.map((p) => p.jogo_id));
  const semValor = (hoje.jogos ?? []).filter((j) => !comEntrada.has(j.id));
  const futurosOportunidades = futuros.reduce(
    (s, a) => s + (a.pernas ?? []).filter((p) => categoria(p) !== null).length, 0);

  const ctxDe = (p: Perna) => hoje.analistas_por_jogo?.[p.partida];
  const cardProps = {
    data: hoje.data, config, rascunhos, onRegistrar, onApostarFaro, onSalvarRascunho,
    selecionadas: sel, onToggleSel: toggleSel, onDrill: (jogoId: string) => setDrill({ data: hoje.data, jogoId }),
  };

  return (
    <div className="space-y-4 overflow-x-hidden pb-24">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-bold tracking-tight text-t1">Melhores de {rotuloDoDia(hoje.data).toLowerCase()}</h2>
        <span className="text-xs text-t3">{hoje.data}</span>
      </div>

      {/* ── BLOCO 1 — MELHORES DE HOJE (a primeira dobra) ── */}
      {melhores.length ? (
        <div className="space-y-3">
          {melhores.map((p) => (
            <CardEntrada key={chaveP(p)} perna={p} contexto={ctxDe(p)} {...cardProps} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-borda bg-card px-4 py-5 text-center">
          <div className="text-sm font-medium text-t2">Nada com valor claro hoje</div>
          <div className="mt-1 text-xs text-t3">
            {(hoje.jogos ?? []).length} jogos analisados. Sem forçar entrada — dia magro é dia magro.
          </div>
        </div>
      )}

      {/* ── BLOCO 3 — OUTRAS OPORTUNIDADES (colapsado) ── */}
      {outras.length > 0 && (
        <OutrasOportunidades entradas={outras} contextoDe={ctxDe} chaveP={chaveP} {...cardProps} />
      )}

      {/* ── BLOCO 4 — RODAPÉ ── */}
      <div className="space-y-2 pt-1">
        {semValor.length > 0 && (
          <VerTodos
            jogos={semValor.map((j) => ({ id: j.id, titulo: `${j.casa} x ${j.fora}`, sub: [j.liga, j.hora].filter(Boolean).join(' · ') }))}
            onDrill={(jogoId) => setDrill({ data: hoje.data, jogoId })}
          />
        )}
        {futurosOportunidades > 0 && (
          <ProximosDias dias={futuros} onDrill={(data, jogoId) => setDrill({ data, jogoId })} />
        )}
      </div>

      {/* ── BLOCO 2 — barra flutuante da múltipla ── */}
      {selecionadas.length > 0 && (
        <BarraMultipla
          selecionadas={selecionadas} data={hoje.data} config={config}
          onLimpar={() => setSel({})} onMontarBilhete={onMontarBilhete}
        />
      )}

      <p className="pt-1 text-center text-[11px] leading-snug text-t3">
        a nota mede a solidez da oportunidade, não a chance de ganhar
      </p>

      {/* Drill-down (overlay). O jogo pode ser de hoje ou de um dia futuro. */}
      {drill && (() => {
        const a = janela.find((x) => x.data === drill.data);
        return a ? <DrilldownJogo analise={a} jogoId={drill.jogoId} onFechar={() => setDrill(null)} /> : null;
      })()}
    </div>
  );
}

/* ─────────────────────────── O CARD SAGRADO ─────────────────────────── */

interface CardBaseProps {
  data: string; config?: Config; rascunhos: Map<string, Rascunho>;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
  onApostarFaro: (e: EntradaFaro) => Promise<unknown>;
  onSalvarRascunho: SalvarRascunho;
  selecionadas: Record<string, Perna>;
  onToggleSel: (p: Perna) => void;
  onDrill: (jogoId: string) => void;
}

function CardEntrada({
  perna: p, contexto, menor, data, config, rascunhos, onRegistrar, onApostarFaro, onSalvarRascunho, selecionadas, onToggleSel, onDrill,
}: CardBaseProps & { perna: Perna; contexto?: ContextoAnalistas | null; menor?: boolean }) {
  const cat = categoria(p);
  const semOdd = Boolean(p.sem_odd_referencia);
  const oddRef = semOdd ? (p.odd_justa ?? 0) : (p.odd ?? 0);
  const prob = p.prob_final ?? p.prob_heuristica ?? 0;
  const evMinimo = config?.filtros?.ev_minimo ?? 3;
  const stakeDefault = +(((config?.banca ?? 1000) * (config?.stake_padrao_pct ?? 3)) / 100).toFixed(2);

  const chave = chaveEntrada(data, [p]);
  const rascunho = rascunhos.get(chave);
  const [oddCasa, setOddCasa] = useState<string>(semOdd ? '' : oddRef ? oddRef.toFixed(2) : '');
  const [stake, setStake] = useState<number>(stakeDefault);
  const [tocou, setTocou] = useState(false);
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'ok' | 'erro'>('ocioso');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (tocou || !rascunho) return;
    if (rascunho.odd_casa != null) setOddCasa(String(rascunho.odd_casa));
    if (rascunho.stake != null) setStake(rascunho.stake);
  }, [rascunho, tocou]);

  useEffect(() => {
    if (!tocou) return;
    const t = setTimeout(() => onSalvarRascunho({
      chave, data, partida: p.partida, mercado: p.mercado,
      odd_casa: normalizarOdd(oddCasa), stake: Number.isFinite(stake) ? stake : null,
    }), 1000);
    return () => clearTimeout(t);
  }, [oddCasa, stake, tocou]); // eslint-disable-line react-hooks/exhaustive-deps

  const odd = normalizarOdd(oddCasa) ?? 0;
  const { justo, ganhoPct: ganho, vale } = vereditoOdd({ prob, odd, evMinimoPct: evMinimo });
  const teto = notaPalavra(p.nota);
  const nAnalistas = analistasConcordam(p, contexto);
  const laranja = contexto?.consenso_laranja;
  const selecionado = Boolean(selecionadas[`${p.jogo_id}|${p.mercado}`]);
  // Contra o veredito, ou entrada que não é "aprovada agora" → grava como faro (com snapshot).
  const usarFaro = !vale || cat !== 'agora';
  const registrado = estado === 'ok';

  async function registrar() {
    setEstado('enviando'); setErro(null);
    try {
      if (usarFaro) {
        await onApostarFaro({ data, perna: p, odd_real: odd, stake, casa_odd: p.casa_odd ?? null, snapshot: snapshotDaPerna(p) });
      } else {
        await onRegistrar({ data, pernas: [p], odd_real: odd, odd_referencia: semOdd ? null : oddRef, prob, stake, casa_odd: p.casa_odd ?? null });
      }
      setEstado('ok');
    } catch (e) { setEstado('erro'); setErro(e instanceof Error ? e.message : String(e)); }
  }

  const pad = menor ? 'px-3 py-2.5' : 'px-4 py-3.5';
  return (
    <div className="overflow-hidden rounded-xl border border-borda bg-card">
      <div className={pad}>
        {/* Cabeçalho: jogo + liga/hora */}
        <div className="flex items-baseline justify-between gap-2">
          <span className={`font-semibold leading-snug text-t1 break-words ${menor ? 'text-sm' : 'text-[15px]'}`}>{p.partida}</span>
          <span className="shrink-0 text-[11px] text-t3">{[p.liga, p.hora].filter(Boolean).join(' ')}</span>
        </div>

        {/* Mercado humano + nota em palavra */}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className={`font-semibold text-azul break-words ${menor ? 'text-sm' : 'text-base'}`}>{mercadoHumano(p.mercado)}</span>
          {typeof p.nota === 'number' && (
            <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${teto.borda} ${teto.fundo} ${teto.texto}`}>
              {teto.palavra} <span className="font-normal opacity-70">{p.nota}</span>
            </span>
          )}
        </div>

        {/* Porquê em 1 frase */}
        <p className="mt-1 text-[13px] leading-snug text-t2">{frasePorque(p)}</p>

        {/* 1 badge (a mais importante) — esperar/aguarda/consenso; resto no drill-down */}
        <div className="mt-1.5 min-h-[0]">
          {cat === 'esperar' ? (
            <span className="rounded bg-ambar/10 px-2 py-0.5 text-[11px] text-ambar">Esperar a véspera — escalações mudam muito</span>
          ) : cat === 'aguarda' ? (
            <span className="rounded bg-ambar/10 px-2 py-0.5 text-[11px] text-ambar">A casa ainda não abriu preço — digite o da sua se quiser</span>
          ) : laranja ? (
            <span className="rounded bg-laranja/10 px-2 py-0.5 text-[11px] text-laranja">🚑 {laranja.n_analistas} analistas apontam {laranja.categoria}</span>
          ) : nAnalistas > 0 ? (
            <span className="text-[12px] text-t3">💬 {nAnalistas} {nAnalistas === 1 ? 'analista concorda' : 'analistas concordam'}</span>
          ) : null}
        </div>

        {/* Odd + veredito */}
        <div className="mt-2 rounded-lg bg-fundo p-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-t2">Odd na sua casa</span>
            <input
              type="text" inputMode="decimal" value={oddCasa}
              onChange={(e) => { setOddCasa(e.target.value); setTocou(true); if (estado === 'erro') setEstado('ocioso'); }}
              placeholder={semOdd ? 'digite' : undefined}
              className="w-20 rounded border border-borda bg-card px-2 py-1 font-mono text-sm text-t1 outline-none focus:border-azul"
            />
          </div>
          <div className={`mt-1.5 text-xs leading-snug ${odd <= 1 ? 'text-t3' : vale ? 'text-verde' : 'text-vermelho'}`}>
            {odd <= 1
              ? `O justo aqui é @${justo.toFixed(2)} — chance real de ${(prob * 100).toFixed(0)}%`
              : vale
                ? `Vale — @${odd.toFixed(2)} paga acima do que a chance real justifica (+${ganho.toFixed(1)}%)`
                : `Nessa odd não compensa — o justo é @${justo.toFixed(2)}`}
          </div>
        </div>

        {/* R$ + Registrar + "+" */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-t3">R$</span>
          <input
            type="number" step="0.01" inputMode="decimal" value={stake}
            onChange={(e) => { setStake(Number(e.target.value)); setTocou(true); }}
            className="w-20 rounded border border-borda bg-fundo px-2 py-1 text-sm text-t1 outline-none focus:border-azul"
          />
          <button
            onClick={() => onToggleSel(p)} aria-label="somar ao bilhete"
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-lg ${selecionado ? 'border-roxo bg-roxo text-white' : 'border-borda text-t2'}`}
          >
            {selecionado ? '✓' : '+'}
          </button>
          <button
            disabled={registrado || odd <= 1 || estado === 'enviando' || stake <= 0}
            onClick={registrar}
            className={`ml-auto rounded px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed ${
              registrado ? 'bg-verde/20 text-verde'
                : usarFaro && odd > 1 ? 'bg-ambar text-white'
                : 'bg-rosa text-white disabled:bg-borda disabled:text-t3'}`}
          >
            {registrado ? 'registrado ✓'
              : estado === 'enviando' ? 'registrando…'
              : odd <= 1 ? 'Digite a odd'
              : usarFaro ? 'Registrar assim mesmo' : 'Registrar'}
          </button>
        </div>
        {usarFaro && odd > 1 && !registrado && (
          <div className="mt-1 text-[11px] leading-snug text-ambar">
            O método não recomenda nessa odd — registrando por convicção própria.
          </div>
        )}
        {estado === 'erro' && (
          <div className="mt-2 rounded border border-vermelho/40 bg-vermelho/10 px-2 py-1.5 text-[11px] leading-snug text-vermelho break-words">
            Não registrou: {erro}
          </div>
        )}

        <button onClick={() => onDrill(p.jogo_id)} className="mt-2 text-[12px] text-t3 hover:text-t2">
          ver análise completa ▸
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────── BLOCO 3 — OUTRAS ─────────────────────────── */

function OutrasOportunidades({
  entradas, contextoDe, chaveP, ...cardProps
}: CardBaseProps & {
  entradas: Perna[]; contextoDe: (p: Perna) => ContextoAnalistas | undefined; chaveP: (p: Perna) => string;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <div>
      <button onClick={() => setAberto((v) => !v)} className="flex w-full items-center gap-2 rounded-xl border border-borda bg-card px-4 py-3 text-left">
        <span className="flex-1 text-sm text-t2">Outras oportunidades ({entradas.length})</span>
        <span className="text-xs text-t3">{aberto ? 'ocultar' : 'ver ▸'}</span>
      </button>
      {aberto && (
        <div className="mt-3 space-y-3">
          {entradas.map((p) => (
            <CardEntrada key={chaveP(p)} perna={p} contexto={contextoDe(p)} menor {...cardProps} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── BLOCO 4 — RODAPÉ ─────────────────────────── */

function VerTodos({ jogos, onDrill }: { jogos: { id: string; titulo: string; sub: string }[]; onDrill: (id: string) => void }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-borda bg-card">
      <button onClick={() => setAberto((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <span className="flex-1 text-sm text-t3">{jogos.length} {jogos.length === 1 ? 'jogo analisado' : 'jogos analisados'} sem valor encontrado</span>
        <span className="text-xs text-t3">{aberto ? 'ocultar' : 'ver todos ▸'}</span>
      </button>
      {aberto && (
        <div className="divide-y divide-borda border-t border-borda">
          {jogos.map((j) => (
            <button key={j.id} onClick={() => onDrill(j.id)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-t2 break-words">{j.titulo}</div>
                <div className="text-[11px] text-t3">{j.sub}</div>
              </div>
              <span className="text-[11px] text-t3">análise ▸</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProximosDias({ dias, onDrill }: { dias: Analise[]; onDrill: (data: string, jogoId: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const total = dias.reduce((s, a) => s + (a.pernas ?? []).filter((p) => categoria(p) !== null).length, 0);
  return (
    <div className="overflow-hidden rounded-xl border border-borda bg-card">
      <button onClick={() => setAberto((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <span className="flex-1 text-sm text-t3">Próximos dias ({total} {total === 1 ? 'oportunidade' : 'oportunidades'})</span>
        <span className="text-xs text-t3">{aberto ? 'ocultar' : 'ver ▸'}</span>
      </button>
      {aberto && (
        <div className="divide-y divide-borda border-t border-borda">
          {dias.map((a) => {
            const jogosComEntrada = [...new Set((a.pernas ?? []).filter((p) => categoria(p) !== null).map((p) => p.jogo_id))];
            if (!jogosComEntrada.length) return null;
            return (
              <div key={a.data} className="px-4 py-2.5">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-t3">{rotuloDoDia(a.data)} · {a.data}</div>
                {jogosComEntrada.map((jid) => {
                  const j = (a.jogos ?? []).find((x) => x.id === jid);
                  if (!j) return null;
                  const melhor = Math.max(...(a.pernas ?? []).filter((p) => p.jogo_id === jid && categoria(p) !== null).map((p) => p.nota ?? 0));
                  return (
                    <button key={jid} onClick={() => onDrill(a.data, jid)} className="flex w-full items-center gap-2 py-1 text-left">
                      <span className="min-w-0 flex-1 text-sm text-t2 break-words">{j.casa} x {j.fora}</span>
                      <span className={`shrink-0 rounded-full border px-1.5 text-[10px] font-bold ${notaPalavra(melhor).borda} ${notaPalavra(melhor).texto}`}>{notaPalavra(melhor).palavra}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── BLOCO 2 — MÚLTIPLA (barra flutuante) ─────────────────────────── */

function BarraMultipla({
  selecionadas, data, config, onLimpar, onMontarBilhete,
}: {
  selecionadas: Perna[]; data: string; config?: Config;
  onLimpar: () => void; onMontarBilhete: (e: EntradaMultipla) => Promise<unknown>;
}) {
  const [aberto, setAberto] = useState(false);
  const [oddTotal, setOddTotal] = useState('');
  const [stake, setStake] = useState<number>(+(((config?.banca ?? 1000) * 1) / 100).toFixed(2));
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'ok' | 'erro'>('ocioso');
  const [erro, setErro] = useState<string | null>(null);

  // Chance real da combinação: multiplica as chances das pernas (mesmo jogo é aproximação — a
  // correlação de verdade pela matriz vive no motor). Só referência; a odd que vale é a manual.
  const chance = selecionadas.reduce((acc, p) => acc * (p.prob_final ?? p.prob_heuristica ?? 1), 1);
  const valeria = chance > 0 ? 1 / chance : 0;
  const odd = normalizarOdd(oddTotal) ?? 0;
  const { vale } = vereditoOdd({ prob: chance, odd, evMinimoPct: config?.filtros?.ev_minimo ?? 3 });
  const teto = notaPalavra(vale ? 72 : 40); // palavra do bilhete a partir do veredito
  const tetoPct = config?.teto_exposicao_diaria_pct ?? 8;
  const tetoRs = +(((config?.banca ?? 1000) * tetoPct) / 100).toFixed(2);

  async function registrar() {
    setEstado('enviando'); setErro(null);
    try {
      await onMontarBilhete({ data, pernas: selecionadas, odd_total: odd, stake, casa_odd: selecionadas[0]?.casa_odd ?? null });
      setEstado('ok'); setTimeout(onLimpar, 900);
    } catch (e) { setEstado('erro'); setErro(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-roxo/40 bg-card/97 backdrop-blur">
      <div className="mx-auto max-w-4xl px-4 py-2.5">
        {!aberto ? (
          <button onClick={() => setAberto(true)} className="flex w-full items-center gap-2 text-left">
            <span className="rounded bg-roxo/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-roxo">bilhete</span>
            <span className="flex-1 text-xs text-t2">
              {selecionadas.length} {selecionadas.length === 1 ? 'seleção' : 'seleções'} · chance real {(chance * 100).toFixed(0)}% · valeria @{valeria.toFixed(2)}
            </span>
            <span className="text-xs text-roxo">montar ▸</span>
          </button>
        ) : (
          <div>
            <div className="flex items-center gap-2">
              <span className="flex-1 text-xs text-t2">{selecionadas.map((p) => mercadoHumano(p.mercado)).join('  +  ')}</span>
              <button onClick={() => setAberto(false)} className="text-[11px] text-t3">fechar</button>
              <button onClick={onLimpar} className="text-[11px] text-t3">limpar</button>
            </div>
            {estado === 'ok' ? (
              <div className="mt-2 text-center text-sm font-semibold text-roxo">bilhete registrado ✓</div>
            ) : (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-t3">Odd total</span>
                  <input type="text" inputMode="decimal" value={oddTotal} placeholder="da casa"
                    onChange={(e) => { setOddTotal(e.target.value); if (estado === 'erro') setEstado('ocioso'); }}
                    className="w-24 rounded border border-borda bg-fundo px-2 py-1 font-mono text-sm text-t1 outline-none focus:border-roxo" />
                  <span className="text-[11px] text-t3">R$</span>
                  <input type="number" step="0.01" inputMode="decimal" value={stake}
                    onChange={(e) => setStake(Number(e.target.value))}
                    className="w-20 rounded border border-borda bg-fundo px-2 py-1 text-sm text-t1 outline-none focus:border-roxo" />
                  <button
                    disabled={estado === 'enviando' || odd <= 1 || stake <= 0 || stake > tetoRs}
                    onClick={registrar}
                    className="ml-auto rounded bg-roxo px-3 py-1.5 text-xs font-semibold text-white disabled:bg-borda disabled:text-t3">
                    {estado === 'enviando' ? 'registrando…' : odd <= 1 ? 'Digite a odd' : stake > tetoRs ? 'acima do teto' : 'Registrar bilhete'}
                  </button>
                </div>
                <div className="mt-1 text-[11px] text-t2">
                  {odd > 1
                    ? `Essa combinação: ${teto.palavra} — chance real ${(chance * 100).toFixed(0)}%, ${vale ? 'paga acima do justo' : 'não paga o suficiente'}`
                    : `chance real ${(chance * 100).toFixed(0)}% · valeria @${valeria.toFixed(2)}`}
                </div>
                {estado === 'erro' && <div className="mt-1 text-[11px] text-vermelho break-words">Não registrou: {erro}</div>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
