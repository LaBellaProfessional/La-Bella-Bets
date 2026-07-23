import { useEffect, useState } from 'react';
import {
  brl, rotuloMercado, familiaDoMercado, NOME_FAMILIA, chaveEntrada, faixaNota, explicarNota,
  snapshotDaPerna, metodoDiria,
  type Analise, type Bilhete, type Config, type Perna, type Registro, type Rascunho, type NotaComponentes,
  type SnapshotMetodo, type ContextoAnalistas,
} from '../dados';
import { SecaoContextoAnalistas } from '../componentes/ContextoAnalistas';
// Veredito da odd digitada: fonte única em _shared (mesma regra do motor). NÃO recalcular aqui —
// foi o recálculo local, comparando múltiplo de EV contra margem em %, que invertia o veredito.
import { vereditoOdd } from '../../supabase/functions/_shared/veredito.js';

/**
 * ABA INÍCIO — a tela de DECISÃO, organizada POR JOGO e ORDENADA POR NOTA.
 *
 * Cada partida é um card; cada entrada dentro do card tem seu próprio campo de odd e botão.
 * Cada card mostra a NOTA DO JOGO (a maior nota entre as entradas) num badge circular no canto,
 * e cada entrada mostra sua nota individual. A nota mede a SOLIDEZ da oportunidade, não a chance
 * de ganhar — a legenda no fim da aba deixa isso explícito.
 *
 * Ordenação: dentro de cada dia, jogos pela maior nota; entradas dentro do card também por nota.
 * O horário continua visível em todos os cards (é a ordem em que as decisões vencem).
 *
 * Funil: Início decide · Apostas acompanha · Histórico analisa. Entrada registrada some daqui.
 * Rascunho persistente: odd/stake salvos no Supabase (debounce ~1s), restaurados ao reabrir.
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

/** Payload da aposta do faro (Parte B): uma perna, a odd da casa, o snapshot do que o método diria. */
export interface EntradaFaro {
  data: string; perna: Perna; odd_real: number; stake: number; casa_odd: string | null; snapshot: SnapshotMetodo;
}

/** Payload da múltipla própria (Parte 1): N pernas + odd TOTAL manual (não multiplica) + stake. */
export interface EntradaMultipla {
  data: string; pernas: Perna[]; odd_total: number; stake: number; casa_odd: string | null;
}

export interface SalvarRascunho {
  (r: { chave: string; data: string; partida: string | null; mercado: string | null; odd_casa: number | null; stake: number | null }): void;
}

/** Odd digitada (aceita vírgula) → número válido ou null. Evita "1,68" virar NaN no restore. */
function normalizarOdd(bruto: string): number | null {
  const n = Number(String(bruto).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? +n.toFixed(2) : null;
}

export function Inicio({
  janela, config, carregando, jaRegistrados, rascunhos, onRegistrar, onApostarFaro, onMontarBilhete, onSalvarRascunho, onAnalisar,
}: {
  janela: Analise[];
  config?: Config;
  carregando?: boolean;
  jaRegistrados: Registro[];
  rascunhos: Map<string, Rascunho>;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
  onApostarFaro: (e: EntradaFaro) => Promise<unknown>;
  onMontarBilhete: (e: EntradaMultipla) => Promise<unknown>;
  onSalvarRascunho: SalvarRascunho;
  onAnalisar?: () => void;
}) {
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

  // Registrada some da Início. Cancelada (desfeita) NÃO conta como registrada — volta a aparecer.
  const registrados = new Set(
    (jaRegistrados ?? []).filter((r) => r.resultado !== 'cancelada').map((r) => chaveEntrada(r.data, r.pernas ?? [])),
  );
  // "Em jogo" por dia: apostas ainda não resolvidas, pra medir o teto de risco diário consumido.
  const pendentes = (jaRegistrados ?? []).filter((r) => r.resultado === 'pendente');

  return (
    <div className="space-y-6 overflow-x-hidden">
      {janela.map((a) => (
        <DiaBloco
          key={a.data} analise={a} config={config} registrados={registrados} registrosPendentes={pendentes}
          rascunhos={rascunhos} onRegistrar={onRegistrar} onApostarFaro={onApostarFaro}
          onMontarBilhete={onMontarBilhete} onSalvarRascunho={onSalvarRascunho}
        />
      ))}
      {/* Legenda fixa: separa "solidez" de "chance de ganhar" — a nota nunca promete resultado. */}
      <p className="pt-1 text-center text-[11px] leading-snug text-t3">
        nota mede a solidez da oportunidade, não a chance de ganhar
      </p>
    </div>
  );
}

/** Uma entrada acionável: bilhete montado ou perna aprovada solta. */
type Entrada =
  | { tipo: 'bilhete'; chave: string; bilhete: Bilhete }
  | { tipo: 'perna'; chave: string; perna: Perna };

const pernasDe = (e: Entrada) => (e.tipo === 'bilhete' ? e.bilhete.pernas : [e.perna]);
const jogosDe = (e: Entrada) => [...new Set(pernasDe(e).map((p) => p.partida))];

interface InfoNota {
  nota: number | null; comp: NotaComponentes | null; escanteio: boolean;
  base: number | null; ajuste: number; ressuscitada: boolean; trava: string | null;
}

function DiaBloco({
  analise, config, registrados, registrosPendentes, rascunhos, onRegistrar, onApostarFaro, onMontarBilhete, onSalvarRascunho,
}: {
  analise: Analise; config?: Config;
  registrados: Set<string>;
  registrosPendentes: Registro[];
  rascunhos: Map<string, Rascunho>;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
  onApostarFaro: (e: EntradaFaro) => Promise<unknown>;
  onMontarBilhete: (e: EntradaMultipla) => Promise<unknown>;
  onSalvarRascunho: SalvarRascunho;
}) {
  const bilhetes = analise.bilhetes ?? [];
  const pernas = analise.pernas ?? [];

  const emBilhete = new Set(bilhetes.flatMap((b) => b.pernas.map((p) => `${p.jogo_id}|${p.mercado}`)));
  // AGUARDA ODD (Parte C) sai do fluxo normal — vai pra seção recolhida própria, não vira card solto.
  const soltas = pernas.filter((p) => p.aprovada && !p.radar && !p.aguarda_odd && !emBilhete.has(`${p.jogo_id}|${p.mercado}`));

  // Índice da nota por perna: fonte da verdade é analise.pernas (o bilhete pode não carregar
  // a nota se o montador não copiar o campo). A nota de uma entrada = a MENOR entre suas pernas
  // (um bilhete é tão sólido quanto a perna mais fraca).
  const infoPorPerna = new Map(pernas.map((p) => [`${p.jogo_id}|${p.mercado}`, p]));
  const infoEntrada = (e: Entrada): InfoNota => {
    const ps = pernasDe(e).map((x) => infoPorPerna.get(`${x.jogo_id}|${x.mercado}`)).filter(Boolean) as Perna[];
    const comNota = ps.filter((p) => typeof p.nota === 'number');
    if (!comNota.length) return { nota: null, comp: null, escanteio: false, base: null, ajuste: 0, ressuscitada: false, trava: null };
    const min = comNota.reduce((a, b) => ((a.nota ?? 0) <= (b.nota ?? 0) ? a : b));
    // Ressurreição/trava: se QUALQUER perna da entrada carrega a marca, a entrada carrega.
    const ressuscitada = ps.some((p) => p.ressuscitada);
    const trava = ps.map((p) => p.trava_analistas).find(Boolean) ?? null;
    return {
      nota: min.nota ?? null,
      comp: min.nota_componentes ?? null,
      escanteio: familiaDoMercado(min.mercado) === 'escanteios' || Boolean(min.sem_odd_referencia),
      base: min.nota_base ?? min.nota ?? null,
      ajuste: min.analistas_ajuste ?? 0,
      ressuscitada, trava,
    };
  };
  const notaOrd = (e: Entrada) => infoEntrada(e).nota ?? -1;

  const radar = analise.radar ?? [];

  const entradasTodas: Entrada[] = [
    ...bilhetes.map((b) => ({ tipo: 'bilhete' as const, chave: `b${b.ordem}`, bilhete: b })),
    ...soltas.map((p, i) => ({ tipo: 'perna' as const, chave: `s${i}`, perna: p })),
  ];

  // INVARIANTE (bug 22/07): some da Início APENAS a entrada cuja chave — data + partida +
  // mercado, ordenada — está registrada. NUNCA o jogo inteiro. É a MESMA chave do registrar e do
  // rascunho. Consequências garantidas: registrar 1 de N entradas de um jogo deixa as outras N-1
  // visíveis; o aviso de concentração e o badge de nota do card (Math.max abaixo) recalculam a
  // partir das que sobraram; desfazer devolve só aquela entrada (a cancelada sai de `registrados`).
  const entradaRegistrada = (e: Entrada) => registrados.has(chaveEntrada(analise.data, pernasDe(e)));
  const entradas = entradasTodas.filter((e) => !entradaRegistrada(e));

  // Bilhete que atravessa dois jogos é uma aposta só, com dois riscos: card próprio.
  // (Combinada só existe com linha — sem odd da API não há bilhete montado.)
  const combinadas = entradas.filter((e) => jogosDe(e).length > 1).sort((a, b) => notaOrd(b) - notaOrd(a));

  // Jogos SEM linha da API vão pra uma seção própria (modo odd manual).
  const partidasSemLinha = new Set(pernas.filter((p) => p.sem_linha).map((p) => p.partida));

  const porJogo = new Map<string, Entrada[]>();
  for (const e of entradas) {
    if (jogosDe(e).length > 1) continue;
    const k = jogosDe(e)[0];
    if (!porJogo.has(k)) porJogo.set(k, []);
    porJogo.get(k)!.push(e);
  }

  // Ordena por MAIOR nota do jogo (desc), horário como desempate.
  const montarJogos = (manter: (partida: string) => boolean) =>
    [...porJogo.entries()]
      .filter(([partida]) => manter(partida))
      .map(([partida, lista]) => {
        const ordenada = [...lista].sort((a, b) => notaOrd(b) - notaOrd(a));
        return { partida, lista: ordenada, notaJogo: Math.max(...ordenada.map(notaOrd)) };
      })
      .sort((a, b) =>
        b.notaJogo - a.notaJogo ||
        (pernasDe(a.lista[0])[0].hora ?? '').localeCompare(pernasDe(b.lista[0])[0].hora ?? ''));

  const jogos = montarJogos((p) => !partidasSemLinha.has(p));          // com linha
  const jogosSemLinha = montarJogos((p) => partidasSemLinha.has(p));   // sem linha, acionáveis

  // AGUARDA ODD (Parte C): prêmio improvável no modo sem-odd. Aprovadas mas recolhidas numa seção
  // própria e discreta — campo de odd ativo, veredito decide ao digitar. Independem do split
  // soltas/radar (uma aguarda a D+1 é radar; a D+0 não): puxamos direto de pernas.aguarda_odd.
  const aguardaEntradas: Entrada[] = pernas
    .filter((p) => p.aprovada && p.aguarda_odd)
    .map((p, i) => ({ tipo: 'perna' as const, chave: `ag${i}`, perna: p }))
    .filter((e) => !entradaRegistrada(e));
  const jogosAguarda = (() => {
    const m = new Map<string, Entrada[]>();
    for (const e of aguardaEntradas) {
      const k = jogosDe(e)[0];
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()]
      .map(([partida, lista]) => {
        const ordenada = [...lista].sort((a, b) => notaOrd(b) - notaOrd(a));
        return { partida, lista: ordenada, notaJogo: Math.max(...ordenada.map(notaOrd)) };
      })
      .sort((a, b) => b.notaJogo - a.notaJogo);
  })();

  // APOSTA DO FARO (Parte B): TODO mercado avaliado ganha a ação "Apostar assim mesmo" — aprovado,
  // no radar, reprovado ou sem odd. Some da lista quando a entrada já foi registrada (mesma chave).
  // Fica numa seção recolhida e discreta pra não competir com os aprovados.
  const faroPorJogo = (() => {
    const m = new Map<string, Perna[]>();
    for (const p of pernas) {
      if (registrados.has(chaveEntrada(analise.data, [p]))) continue;
      if (!m.has(p.partida)) m.set(p.partida, []);
      m.get(p.partida)!.push(p);
    }
    return [...m.entries()]
      .map(([partida, ps]) => ({
        partida,
        pernas: [...ps].sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1)),
        hora: ps[0].hora ?? '',
      }))
      .sort((a, b) => a.hora.localeCompare(b.hora));
  })();

  // BOLÍVAR: jogo sem linha que NÃO produziu entrada acionável — não vira card de reprovadas,
  // vai pro grupo recolhido com motivo honesto (sem histórico vs. nada passou nos filtros).
  const partidasAcionaveis = new Set(jogosSemLinha.map((j) => j.partida));
  const temPerna = new Set(pernas.map((p) => p.partida));
  const bolivar = (analise.jogos ?? [])
    .filter((j) => j.sem_linha)
    .map((j) => `${j.casa} x ${j.fora}`)
    .filter((partida) => !partidasAcionaveis.has(partida))
    .map((partida) => ({
      partida,
      motivo: temPerna.has(partida)
        ? 'sem linha da API · nada passou nos filtros do método'
        : 'sem linha da API · sem histórico/estatística pros times',
    }));

  const temPrincipal = Boolean(combinadas.length || jogos.length || jogosSemLinha.length || bolivar.length);
  // AGUARDA ODD sozinha não conta como "sem entrada" (existe conteúdo, só recolhido).
  const semEntrada = !temPrincipal && !jogosAguarda.length;
  const tudoRegistrado = semEntrada && entradasTodas.length > 0;

  // Exposição do dia: quanto do teto de risco diário (8% da banca) já está EM JOGO neste dia.
  const emJogoDia = +registrosPendentes.filter((r) => r.data === analise.data).reduce((s, r) => s + r.stake_real, 0).toFixed(2);
  const tetoRs = (config?.banca ?? 0) * (config?.teto_exposicao_diaria_pct ?? 8) / 100;
  const pctTeto = tetoRs > 0 ? Math.min(100, (emJogoDia / tetoRs) * 100) : 0;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-bold tracking-tight text-t1">{rotuloDoDia(analise.data)}</h2>
        <span className="text-xs text-t3">{analise.data}</span>
        {(analise.horizonte_dias ?? 0) > 0 && (
          <span className="rounded bg-azul/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-azul">
            antecipada · exige margem dobrada
          </span>
        )}
      </div>

      {emJogoDia > 0 && (
        <div className="mb-3 rounded-lg border border-borda bg-card px-3 py-2">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-t2">Em jogo neste dia: <b className="text-ambar">{brl(emJogoDia)}</b></span>
            <span className="text-t3">{pctTeto.toFixed(0)}% do teto de {config?.teto_exposicao_diaria_pct ?? 8}% ({brl(tetoRs)})</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-fundo">
            <div className={`h-full rounded-full ${pctTeto >= 100 ? 'bg-vermelho' : 'bg-ambar'}`} style={{ width: `${pctTeto}%` }} />
          </div>
        </div>
      )}

      {semEntrada ? (
        <div className="rounded-xl border border-borda bg-card px-4 py-5 text-center">
          <div className="text-sm font-medium text-t2">
            {tudoRegistrado ? 'Tudo registrado nesse dia' : 'Sem entrada nesse dia'}
          </div>
          <div className="mt-1 text-xs text-t3">
            {tudoRegistrado ? (
              'As entradas desse dia estão na aba Apostas.'
            ) : (
              <>
                {analise.resumo?.jogos ?? 0} jogos e {analise.resumo?.pernas_avaliadas ?? 0} apostas possíveis analisadas ·{' '}
                {analise.resumo?.aprovadas ?? 0} passaram nos filtros
                {radar.length > 0 && ` · ${radar.length} no radar pra véspera`}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {combinadas.map((e) => (
            <CardJogo
              key={e.chave} data={analise.data} titulo={jogosDe(e).join('  +  ')}
              subtitulo={`bilhete combinado · ${jogosDe(e).length} jogos`}
              entradas={[e]} notaJogo={notaOrd(e) >= 0 ? notaOrd(e) : null}
              infoEntrada={infoEntrada} config={config} rascunhos={rascunhos}
              onRegistrar={onRegistrar} onSalvarRascunho={onSalvarRascunho}
            />
          ))}
          {jogos.map(({ partida, lista, notaJogo }) => {
            const p0 = pernasDe(lista[0])[0];
            return (
              <CardJogo
                key={partida} data={analise.data} titulo={partida}
                subtitulo={[p0.liga, p0.hora].filter(Boolean).join(' · ')}
                entradas={lista} notaJogo={notaJogo >= 0 ? notaJogo : null}
                infoEntrada={infoEntrada} config={config} rascunhos={rascunhos}
                contexto={analise.analistas_por_jogo?.[partida]}
                onRegistrar={onRegistrar} onSalvarRascunho={onSalvarRascunho}
              />
            );
          })}

          {/* ── JOGOS SEM LINHA ABERTA (modo odd manual) ── */}
          {(jogosSemLinha.length > 0 || bolivar.length > 0) && (
            <div className="pt-2">
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-sm font-semibold text-t2">Jogos sem linha aberta</h3>
                <span className="text-[11px] text-t3">sua casa pode ter</span>
              </div>
              <div className="space-y-3">
                {jogosSemLinha.map(({ partida, lista, notaJogo }) => {
                  const p0 = pernasDe(lista[0])[0];
                  // Regra de UMA aposta sem-odd-de-mercado por jogo: se já há uma pendente desse
                  // jogo (odd_referencia null = sem linha), trava o registro das outras.
                  const jaTemSemOdd = registrosPendentes.some(
                    (r) => !r.odd_referencia && r.pernas.some((pp) => pp.partida === partida),
                  );
                  return (
                    <CardJogo
                      key={partida} data={analise.data} titulo={partida}
                      subtitulo={[p0.liga, p0.hora, 'sem linha da API'].filter(Boolean).join(' · ')}
                      entradas={lista} notaJogo={notaJogo >= 0 ? notaJogo : null}
                      infoEntrada={infoEntrada} config={config} rascunhos={rascunhos}
                      travarSemOdd={jaTemSemOdd}
                      contexto={analise.analistas_por_jogo?.[partida]}
                      onRegistrar={onRegistrar} onSalvarRascunho={onSalvarRascunho}
                    />
                  );
                })}
                {bolivar.length > 0 && <GrupoBolivar jogos={bolivar} />}
              </div>
            </div>
          )}

          {/* ── AGUARDA ODD (prêmio improvável) — recolhida, discreta, abaixo de tudo ── */}
          {jogosAguarda.length > 0 && (
            <GrupoAguardaOdd
              jogos={jogosAguarda} data={analise.data} infoEntrada={infoEntrada}
              config={config} rascunhos={rascunhos}
              onRegistrar={onRegistrar} onSalvarRascunho={onSalvarRascunho}
            />
          )}
        </div>
      )}

      {/* ── APOSTA DO FARO (Parte B): "Apostar assim mesmo" em qualquer mercado — porta própria ── */}
      {faroPorJogo.length > 0 && (
        <SecaoFaro jogos={faroPorJogo} data={analise.data} config={config} onApostarFaro={onApostarFaro} />
      )}

      {/* ── MONTAR BILHETE (Parte 1): múltipla própria — qualquer combinação, odd total manual ── */}
      {faroPorJogo.length > 0 && (
        <MontarBilhete jogos={faroPorJogo} data={analise.data} config={config} onMontarBilhete={onMontarBilhete} />
      )}
    </section>
  );
}

/**
 * MONTAR BILHETE (Parte 1) — a múltipla própria do Maikon. Seleciona 2+ pernas de QUALQUER estado e
 * QUALQUER jogo (inclusive do mesmo jogo), digita a odd TOTAL da casa (nunca multiplica — ganhos
 * aumentados e correlação intra-jogo tornam o produto errado), stake e registra. Cada perna leva o
 * snapshot do que o método diria. Discreto e recolhido por padrão. Respeita o teto diário.
 */
function MontarBilhete({
  jogos, data, config, onMontarBilhete,
}: {
  jogos: { partida: string; pernas: Perna[]; hora: string }[];
  data: string; config?: Config;
  onMontarBilhete: (e: EntradaMultipla) => Promise<unknown>;
}) {
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState<Record<string, Perna>>({});
  const [oddTotal, setOddTotal] = useState('');
  const [stake, setStake] = useState<number>(+(((config?.banca ?? 1000) * 1) / 100).toFixed(2));
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'ok' | 'erro'>('ocioso');
  const [erro, setErro] = useState<string | null>(null);

  const chave = (p: Perna) => `${p.partida}|${p.mercado}`;
  const selecionadas = Object.values(sel);
  const tetoPct = config?.teto_exposicao_diaria_pct ?? 8;
  const tetoRs = +(((config?.banca ?? 1000) * tetoPct) / 100).toFixed(2);
  const odd = normalizarOdd(oddTotal) ?? 0;
  const acimaTeto = stake > tetoRs;
  // Pernas que contrariam o método (não aprovadas) — aviso de 1 linha, mesmo padrão do faro.
  const contrarias = selecionadas.filter((p) => !(p.aprovada && !p.radar && !p.aguarda_odd));

  function alternar(p: Perna) {
    setSel((s) => { const n = { ...s }; if (n[chave(p)]) delete n[chave(p)]; else n[chave(p)] = p; return n; });
    if (estado === 'ok') setEstado('ocioso');
  }

  async function registrar() {
    setEstado('enviando'); setErro(null);
    try {
      await onMontarBilhete({ data, pernas: selecionadas, odd_total: odd, stake, casa_odd: selecionadas[0]?.casa_odd ?? null });
      setEstado('ok'); setSel({}); setOddTotal('');
    } catch (e) { setEstado('erro'); setErro(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="mt-3 border-t border-borda pt-3">
      <button onClick={() => setAberto((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="rounded bg-roxo/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-roxo">bilhete</span>
        <span className="flex-1 text-xs text-t3">Montar bilhete — múltipla própria (odd total da casa)</span>
        <span className="text-xs text-t3">{aberto ? 'ocultar' : 'ver'}</span>
      </button>
      {aberto && (
        <div className="mt-3">
          <p className="mb-2 text-[11px] leading-snug text-t3">
            Marque as pernas (de qualquer jogo, inclusive do mesmo), digite a <b>odd total</b> que a
            casa mostrou (com ganhos aumentados, se houver) e o stake. Registra como <b className="text-roxo">FARO</b>.
          </p>
          <div className="space-y-2">
            {jogos.map((j) => (
              <div key={j.partida} className="overflow-hidden rounded-lg border border-borda bg-card">
                <div className="border-b border-borda px-3 py-1.5 text-[11px] font-medium text-t2 break-words">{j.partida}</div>
                <div className="divide-y divide-borda">
                  {j.pernas.map((p) => {
                    const on = Boolean(sel[chave(p)]);
                    const snap = snapshotDaPerna(p);
                    return (
                      <button
                        key={p.mercado} onClick={() => alternar(p)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${on ? 'bg-roxo/10' : ''}`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? 'border-roxo bg-roxo text-white' : 'border-borda text-transparent'}`}>✓</span>
                        <span className="min-w-0 flex-1">
                          <span className="text-xs text-t1 break-words">{rotuloMercado(p.mercado)}</span>
                          <span className="ml-1 text-[10px] text-t3">{metodoDiria(snap)}</span>
                        </span>
                        {p.odd != null && <span className="font-mono text-[11px] text-t3">@{p.odd}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Rodapé fixo do bilhete em montagem. */}
          {selecionadas.length > 0 && (
            <div className="mt-3 rounded-xl border border-roxo/30 bg-roxo/5 p-3">
              <div className="text-[11px] text-t2">
                {selecionadas.length} {selecionadas.length === 1 ? 'perna' : 'pernas'}:{' '}
                {selecionadas.map((p) => rotuloMercado(p.mercado)).join('  +  ')}
              </div>
              {contrarias.length > 0 && (
                <div className="mt-1 text-[11px] leading-snug text-ambar">
                  {contrarias.length} {contrarias.length === 1 ? 'perna contraria' : 'pernas contrariam'} o método — registrando por convicção própria
                </div>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-t3">Odd total</span>
                <input
                  type="text" inputMode="decimal" value={oddTotal}
                  onChange={(e) => { setOddTotal(e.target.value); if (estado === 'erro') setEstado('ocioso'); }}
                  placeholder="da casa"
                  className="w-24 rounded border border-borda bg-fundo px-2 py-1 font-mono text-sm text-t1 outline-none focus:border-roxo"
                />
                <span className="text-[11px] text-t3">R$</span>
                <input
                  type="number" step="0.01" inputMode="decimal" value={stake}
                  onChange={(e) => setStake(Number(e.target.value))}
                  className="w-20 rounded border border-borda bg-fundo px-2 py-1 text-sm text-t1 outline-none focus:border-roxo"
                />
                <button
                  disabled={estado === 'ok' || estado === 'enviando' || odd <= 1 || acimaTeto || stake <= 0}
                  onClick={registrar}
                  className={`ml-auto rounded px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed ${
                    estado === 'ok' ? 'bg-roxo/20 text-roxo' : 'bg-roxo text-white disabled:bg-borda disabled:text-t3'}`}
                >
                  {estado === 'ok' ? 'registrado ✓' : estado === 'enviando' ? 'registrando…' : odd <= 1 ? 'Digite a odd total' : acimaTeto ? 'acima do teto' : 'Registrar bilhete'}
                </button>
              </div>
              {acimaTeto && <div className="mt-1 text-[11px] text-vermelho">stake acima do teto de {tetoPct}% ({brl(tetoRs)})</div>}
              {estado === 'erro' && (
                <div className="mt-1.5 rounded border border-vermelho/40 bg-vermelho/10 px-2 py-1 text-[11px] leading-snug text-vermelho break-words">
                  Não registrou: {erro}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * APOSTA DO FARO (Parte B) — porta própria do capitão. TODO mercado avaliado (aprovado, radar,
 * reprovado, sem odd) ganha a ação "Apostar assim mesmo". Fica recolhida por padrão pra não
 * competir com os aprovados. Sem paternalismo: uma linha "o método diria: X" e stake livre até o
 * teto de 8%. Grava origem='maikon_faro' + o snapshot do que o método diria — pra saber CONTRA
 * O QUÊ o faro acertou.
 */
function SecaoFaro({
  jogos, data, config, onApostarFaro,
}: {
  jogos: { partida: string; pernas: Perna[]; hora: string }[];
  data: string; config?: Config;
  onApostarFaro: (e: EntradaFaro) => Promise<unknown>;
}) {
  const [aberto, setAberto] = useState(false);
  const total = jogos.reduce((s, j) => s + j.pernas.length, 0);
  return (
    <div className="mt-4 border-t border-borda pt-3">
      <button onClick={() => setAberto((v) => !v)} className="flex w-full items-center gap-2 text-left">
        <span className="rounded bg-roxo/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-roxo">faro</span>
        <span className="flex-1 text-xs text-t3">
          Apostar assim mesmo — {total} {total === 1 ? 'mercado avaliado' : 'mercados avaliados'} do dia
        </span>
        <span className="text-xs text-t3">{aberto ? 'ocultar' : 'ver'}</span>
      </button>
      {aberto && (
        <div className="mt-3 space-y-3">
          <p className="text-[11px] leading-snug text-t3">
            Sua porta própria: registra qualquer mercado por convicção, mesmo o que o método não
            aprovou. Fica marcado como <b className="text-roxo">FARO</b> na aba Apostas, com o registro
            do que o método diria — pra medir o faro contra o método. Stake livre até o teto de {config?.teto_exposicao_diaria_pct ?? 8}%.
          </p>
          {jogos.map((j) => (
            <div key={j.partida} className="overflow-hidden rounded-xl border border-borda bg-card">
              <div className="border-b border-borda px-4 py-2.5">
                <div className="text-sm font-semibold leading-snug text-t1 break-words">{j.partida}</div>
                <div className="mt-0.5 text-[11px] text-t3">{[j.pernas[0].liga, j.hora].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="divide-y divide-borda">
                {j.pernas.map((p) => (
                  <LinhaFaro key={p.mercado} data={data} perna={p} config={config} onApostarFaro={onApostarFaro} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Uma linha de faro: mercado, veredito do método, campo de odd + stake e o botão "Apostar assim mesmo". */
function LinhaFaro({
  data, perna, config, onApostarFaro,
}: {
  data: string; perna: Perna; config?: Config;
  onApostarFaro: (e: EntradaFaro) => Promise<unknown>;
}) {
  const snapshot = snapshotDaPerna(perna);
  const tetoPct = config?.teto_exposicao_diaria_pct ?? 8;
  // Faro default de 1% da banca (a porta é discreta e o risco é do capitão), teto de 8%.
  const stakeDefault = +(((config?.banca ?? 1000) * 1) / 100).toFixed(2);
  const tetoRs = +(((config?.banca ?? 1000) * tetoPct) / 100).toFixed(2);

  const [oddCasa, setOddCasa] = useState<string>(perna.odd != null ? perna.odd.toFixed(2) : '');
  const [stake, setStake] = useState<number>(stakeDefault);
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'ok' | 'erro'>('ocioso');
  const [erro, setErro] = useState<string | null>(null);

  const odd = normalizarOdd(oddCasa) ?? 0;
  const prob = perna.prob_final ?? perna.prob_heuristica ?? 0;
  const justo = prob > 0 ? +(1 / prob).toFixed(2) : 0;
  const ganho = prob > 0 && odd > 1 ? (prob * odd - 1) * 100 : 0;
  const acimaTeto = stake > tetoRs;
  const cor = snapshot.veredito === 'aprovada' ? 'text-verde'
    : snapshot.veredito === 'radar' || snapshot.veredito === 'aguarda_odd' ? 'text-ambar'
    : 'text-t3';

  async function registrar() {
    setEstado('enviando'); setErro(null);
    try {
      await onApostarFaro({ data, perna, odd_real: odd, stake, casa_odd: perna.casa_odd ?? null, snapshot });
      setEstado('ok');
    } catch (e) {
      setEstado('erro'); setErro(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium text-t2 break-words">{rotuloMercado(perna.mercado)}</span>
        <span className="ml-auto font-mono text-xs text-t3">
          {prob > 0 ? `${(prob * 100).toFixed(0)}% · justo @${justo.toFixed(2)}` : 'sem modelo'}
        </span>
      </div>
      {/* Aviso de 1 linha, sem paternalismo: o que o método diria. */}
      <div className={`mt-0.5 text-[11px] leading-snug ${cor}`}>{metodoDiria(snapshot)}</div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-t3">Odd</span>
        <input
          type="text" inputMode="decimal" value={oddCasa}
          onChange={(e) => { setOddCasa(e.target.value); if (estado === 'erro') setEstado('ocioso'); }}
          placeholder="da sua casa"
          className="w-24 rounded border border-borda bg-fundo px-2 py-1 font-mono text-sm text-t1 outline-none focus:border-roxo"
        />
        <span className="text-[11px] text-t3">R$</span>
        <input
          type="number" step="0.01" inputMode="decimal" value={stake}
          onChange={(e) => setStake(Number(e.target.value))}
          className="w-20 rounded border border-borda bg-fundo px-2 py-1 text-sm text-t1 outline-none focus:border-roxo"
        />
        <button
          disabled={estado === 'ok' || estado === 'enviando' || odd <= 1 || acimaTeto || stake <= 0}
          onClick={registrar}
          className={`ml-auto rounded px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed ${
            estado === 'ok' ? 'bg-roxo/20 text-roxo' : 'bg-roxo text-white disabled:bg-borda disabled:text-t3'
          }`}
        >
          {estado === 'ok' ? 'registrado ✓'
            : estado === 'enviando' ? 'registrando…'
            : odd <= 1 ? 'Digite a odd'
            : acimaTeto ? `acima do teto` : 'Apostar assim mesmo'}
        </button>
      </div>
      {odd > 1 && (
        <div className={`mt-1 text-[11px] ${ganho >= 0 ? 'text-t3' : 'text-vermelho'}`}>
          {ganho >= 0
            ? `@${odd.toFixed(2)} paga ${ganho.toFixed(1)}% acima do justo`
            : `@${odd.toFixed(2)} está ${Math.abs(ganho).toFixed(1)}% abaixo do justo — faro contra o preço`}
        </div>
      )}
      {acimaTeto && <div className="mt-1 text-[11px] text-vermelho">stake acima do teto de {tetoPct}% ({brl(tetoRs)})</div>}
      {estado === 'erro' && (
        <div className="mt-1.5 rounded border border-vermelho/40 bg-vermelho/10 px-2 py-1 text-[11px] leading-snug text-vermelho break-words">
          Não registrou: {erro}
        </div>
      )}
    </div>
  );
}

/**
 * Seção recolhida das entradas AGUARDA ODD (Parte C): prêmio improvável, a casa raramente paga
 * acima do justo — mas se a do Maikon pagar, o campo está ativo e o veredito confere. Fica fechada
 * por padrão pra não competir com os aprovados; abre num toque.
 */
function GrupoAguardaOdd({
  jogos, data, infoEntrada, config, rascunhos, onRegistrar, onSalvarRascunho,
}: {
  jogos: { partida: string; lista: Entrada[]; notaJogo: number }[];
  data: string; infoEntrada: (e: Entrada) => InfoNota;
  config?: Config; rascunhos: Map<string, Rascunho>;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
  onSalvarRascunho: SalvarRascunho;
}) {
  const [aberto, setAberto] = useState(false);
  const total = jogos.reduce((s, j) => s + j.lista.length, 0);
  return (
    <div className="pt-2">
      <button
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border border-borda bg-card px-4 py-3 text-left"
      >
        <span className="rounded bg-fundo px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-t3">aguarda odd</span>
        <span className="flex-1 text-sm text-t2">
          {total} {total === 1 ? 'entrada de prêmio improvável' : 'entradas de prêmio improvável'}
        </span>
        <span className="text-xs text-t3">{aberto ? 'ocultar' : 'ver'}</span>
      </button>
      {aberto && (
        <div className="mt-3 space-y-3">
          <p className="px-1 text-[11px] leading-snug text-t3">
            O modelo dá chance altíssima aqui, então o justo é muito baixo — a casa raramente paga
            acima. Não bloqueia: se a sua ofertar um preço bom, digite e o veredito confere.
          </p>
          {jogos.map(({ partida, lista, notaJogo }) => {
            const p0 = pernasDe(lista[0])[0];
            return (
              <CardJogo
                key={partida} data={data} titulo={partida}
                subtitulo={[p0.liga, p0.hora, 'prêmio improvável'].filter(Boolean).join(' · ')}
                entradas={lista} notaJogo={notaJogo >= 0 ? notaJogo : null}
                infoEntrada={infoEntrada} config={config} rascunhos={rascunhos}
                onRegistrar={onRegistrar} onSalvarRascunho={onSalvarRascunho}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Grupo recolhido dos jogos sem linha E sem nada acionável — motivo honesto, sem poluir a tela. */
function GrupoBolivar({ jogos }: { jogos: { partida: string; motivo: string }[] }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-borda bg-card">
      <button onClick={() => setAberto((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <span className="flex-1 text-sm text-t2">
          {jogos.length} {jogos.length === 1 ? 'jogo sem linha e sem nada acionável' : 'jogos sem linha e sem nada acionável'}
        </span>
        <span className="text-xs text-t3">{aberto ? 'ocultar' : 'ver'}</span>
      </button>
      {aberto && (
        <div className="divide-y divide-borda border-t border-borda">
          {jogos.map((j) => (
            <div key={j.partida} className="px-4 py-2">
              <div className="text-sm text-t1 break-words">{j.partida}</div>
              <div className="mt-0.5 text-[11px] text-t3">{j.motivo}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Badge circular com a nota — verde 80+, azul 60-79, cinza <60. */
function BadgeNota({ nota }: { nota: number }) {
  const f = faixaNota(nota);
  return (
    <span
      title={`nota ${nota} (${f.label})`}
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold ${f.borda} ${f.fundo} ${f.texto}`}
    >
      {nota}
    </span>
  );
}

function CardJogo({
  data, titulo, subtitulo, entradas, notaJogo, infoEntrada, config, rascunhos, travarSemOdd, contexto, onRegistrar, onSalvarRascunho,
}: {
  data: string; titulo: string; subtitulo: string; entradas: Entrada[]; notaJogo: number | null;
  infoEntrada: (e: Entrada) => InfoNota;
  config?: Config; rascunhos: Map<string, Rascunho>; travarSemOdd?: boolean;
  contexto?: ContextoAnalistas | null;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
  onSalvarRascunho: SalvarRascunho;
}) {
  const stakePctDe = (p: Perna) =>
    p.confianca === 'CONFIANCA_MAXIMA' && !p.amostra_curta
      ? (config?.stake_confianca_maxima_pct ?? 5)
      : (config?.stake_padrao_pct ?? 3);
  const evMinimo = config?.filtros?.ev_minimo ?? 3; // % inteiro (formato unificado 22/07), não razão

  return (
    <div className="overflow-hidden rounded-xl border border-borda bg-card">
      <div className="flex items-start gap-3 border-b border-borda px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug text-t1 break-words">{titulo}</div>
          <div className="mt-0.5 text-xs text-t3">{subtitulo}</div>
          {entradas.length > 1 && (
            <div className="mt-2 rounded bg-ambar/10 px-2 py-1 text-[11px] leading-snug text-ambar">
              {entradas.length} entradas do mesmo jogo — resultado ruim afeta todas
            </div>
          )}
        </div>
        {/* NOTA DO JOGO: a maior entre as entradas, no canto superior direito. */}
        {notaJogo != null && <BadgeNota nota={notaJogo} />}
      </div>

      {/* CONTEXTO DOS ANALISTAS: fatos/dados/opiniões + alerta laranja de fato consensual. */}
      {contexto && (
        <div className="border-b border-borda px-4 py-3">
          <SecaoContextoAnalistas contexto={contexto} />
        </div>
      )}

      <div className="divide-y divide-borda">
        {entradas.map((e) => {
          const pernas = pernasDe(e);
          const ehBilhete = e.tipo === 'bilhete';
          const p = ehBilhete ? null : e.perna;
          const semOdd = Boolean(p?.sem_odd_referencia);
          const info = infoEntrada(e);
          return (
            <LinhaEntrada
              key={e.chave}
              data={data}
              pernas={pernas}
              rotulo={pernas.map((x) => rotuloMercado(x.mercado)).join('  +  ')}
              tipo={ehBilhete && e.bilhete.n_pernas > 1 ? `bilhete · ${e.bilhete.n_pernas} pernas` : 'entrada simples'}
              familia={NOME_FAMILIA[familiaDoMercado(pernas[0].mercado)]}
              oddReferencia={ehBilhete ? e.bilhete.odd_total : semOdd ? (p!.odd_justa ?? 0) : (p!.odd ?? 0)}
              semOdd={semOdd}
              prob={ehBilhete ? e.bilhete.prob_combinada : (p!.prob_final ?? 0)}
              stakePct={ehBilhete ? e.bilhete.stake_pct : stakePctDe(p!)}
              stakeRS={ehBilhete ? e.bilhete.stake_rs : (p!.stake_rs ?? +(((config?.banca ?? 1000) * stakePctDe(p!)) / 100).toFixed(2))}
              confiancaMaxima={ehBilhete ? e.bilhete.todas_confianca_maxima : p!.confianca === 'CONFIANCA_MAXIMA' && !p!.amostra_curta}
              rebaixada={!ehBilhete && p!.confianca === 'REBAIXADA'}
              evMinimo={evMinimo}
              nota={info.nota}
              notaComp={info.comp}
              notaEscanteio={info.escanteio}
              notaBase={info.base}
              notaAjuste={info.ajuste}
              ressuscitada={info.ressuscitada}
              travaAnalistas={info.trava}
              bilheteMultiplo={ehBilhete && e.bilhete.n_pernas > 1}
              travado={Boolean(travarSemOdd && semOdd)}
              rascunho={rascunhos.get(chaveEntrada(data, pernas))}
              onRegistrar={onRegistrar}
              onSalvarRascunho={onSalvarRascunho}
            />
          );
        })}
      </div>
    </div>
  );
}

function LinhaEntrada({
  data, pernas, rotulo, tipo, familia, oddReferencia, prob, stakePct, stakeRS,
  confiancaMaxima, rebaixada, evMinimo, semOdd, nota, notaComp, notaEscanteio, bilheteMultiplo, travado,
  notaBase, notaAjuste, ressuscitada, travaAnalistas,
  rascunho, onRegistrar, onSalvarRascunho,
}: {
  data: string; pernas: Perna[]; rotulo: string; tipo: string; familia: string;
  oddReferencia: number; prob: number; stakePct: number; stakeRS: number;
  confiancaMaxima: boolean; rebaixada: boolean; evMinimo: number;
  semOdd?: boolean; nota: number | null; notaComp: NotaComponentes | null;
  notaEscanteio: boolean; bilheteMultiplo: boolean; travado?: boolean; rascunho?: Rascunho;
  notaBase?: number | null; notaAjuste?: number; ressuscitada?: boolean; travaAnalistas?: string | null;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
  onSalvarRascunho: SalvarRascunho;
}) {
  const chave = chaveEntrada(data, pernas);
  const [oddCasa, setOddCasa] = useState<string>(semOdd ? '' : oddReferencia.toFixed(2));
  const [stake, setStake] = useState<number>(stakeRS);
  const [tocou, setTocou] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [notaAberta, setNotaAberta] = useState(false);
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'ok' | 'erro'>('ocioso');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (tocou || !rascunho) return;
    if (rascunho.odd_casa != null) setOddCasa(String(rascunho.odd_casa));
    if (rascunho.stake != null) setStake(rascunho.stake);
    if (rascunho.odd_casa != null || rascunho.stake != null) setSalvo(true);
  }, [rascunho, tocou]);

  useEffect(() => {
    if (!tocou) return;
    setSalvo(false);
    const t = setTimeout(() => {
      onSalvarRascunho({
        chave, data,
        partida: pernas[0]?.partida ?? null,
        mercado: pernas.map((p) => p.mercado).join('+'),
        odd_casa: normalizarOdd(oddCasa),
        stake: Number.isFinite(stake) ? stake : null,
      });
      setSalvo(true);
    }, 1000);
    return () => clearTimeout(t);
  }, [oddCasa, stake, tocou]); // eslint-disable-line react-hooks/exhaustive-deps

  // Vírgula→ponto no MESMO ponto do veredito (não só no insert): "1,68" nunca vira NaN.
  const odd = normalizarOdd(oddCasa) ?? 0;
  // evMinimo em % → o veredito compara ganho% >= ev_minimo%, igual ao motor. Antes comparava
  // prob*odd (múltiplo ~1.17) contra 3 e invertia: odd acima do justo virava "sem valor".
  const { justo, ganhoPct: ganho, vale } = vereditoOdd({ prob, odd, evMinimoPct: evMinimo });
  const registrado = estado === 'ok';
  // Teto de implausibilidade MAIS rígido no modo manual: sem preço de mercado pra ancorar,
  // vantagem digitada acima de 25% quase sempre é odd errada (pegou o mercado errado).
  const alertaImplausivel = Boolean(semOdd) && odd > 1 && ganho > 25;

  async function registrar() {
    setEstado('enviando'); setErro(null);
    try {
      await onRegistrar({
        data, pernas, odd_real: odd,
        // Sem preço de mercado → sem CLV: grava null (o virtual/Histórico trata como escanteio).
        odd_referencia: semOdd ? null : oddReferencia,
        prob, stake, casa_odd: pernas[0]?.casa_odd ?? null,
      });
      setEstado('ok');
    } catch (e) {
      setEstado('erro');
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold text-azul break-words">{rotulo}</span>
        <div className="ml-auto flex items-center gap-2">
          {/* Nota individual da entrada: toca pra abrir o detalhamento dos componentes. */}
          {nota != null && (
            <button
              onClick={() => setNotaAberta((v) => !v)}
              className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-bold ${faixaNota(nota).borda} ${faixaNota(nota).fundo} ${faixaNota(nota).texto}`}
            >
              {nota}<span className="text-[9px] font-normal opacity-70">{notaAberta ? '▲' : '▼'}</span>
            </button>
          )}
          <span className="font-mono text-sm text-t2">
            {semOdd ? `justa @${oddReferencia.toFixed(2)}` : `@${oddReferencia.toFixed(2)}`}
          </span>
        </div>
      </div>

      {/* Detalhamento da nota em linguagem de apostador. */}
      {nota != null && notaAberta && notaComp && (
        <div className="mt-2 rounded-lg border border-borda bg-fundo px-3 py-2">
          <div className="space-y-1">
            {explicarNota(notaComp, notaEscanteio).map((linha, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="text-t2">{linha.rotulo}</span>
                <span className="font-mono text-t3">{linha.valor}</span>
              </div>
            ))}
          </div>
          {/* Ajuste dos analistas, decomposto e SEMPRE visível: "Nota 74 = modelo 70, analistas +4". */}
          {notaAjuste != null && notaAjuste !== 0 && notaBase != null && (
            <div className="mt-1.5 border-t border-borda pt-1.5 text-[11px] leading-snug">
              <span className="text-t2">
                Nota {nota} = modelo {notaBase}, analistas{' '}
                <b className={notaAjuste > 0 ? 'text-verde' : 'text-vermelho'}>
                  {notaAjuste > 0 ? '+' : '−'}{Math.abs(notaAjuste)}
                </b>
              </span>
            </div>
          )}
          {bilheteMultiplo && (
            <div className="mt-1.5 border-t border-borda pt-1.5 text-[10px] leading-snug text-t3">
              nota do bilhete = a da perna mais fraca (o conjunto é tão sólido quanto ela)
            </div>
          )}
        </div>
      )}

      <div className="mt-1 flex flex-wrap gap-1.5">
        <span className="rounded bg-fundo px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-t3">{familia}</span>
        <span className="rounded bg-fundo px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-t3">{tipo}</span>
        {confiancaMaxima && (
          <span className="rounded bg-verde/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-verde">confiança máxima</span>
        )}
        {rebaixada && (
          <span className="rounded bg-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-t3">confiança rebaixada</span>
        )}
        {pernas.some((p) => p.amostra_curta) && (
          <span className="rounded bg-ambar/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ambar">amostra curta</span>
        )}
        {/* Selo da ENTRADA DOS ANALISTAS (ressuscitada pelo consenso). */}
        {ressuscitada && (
          <span className="rounded bg-laranja/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-laranja">entrada dos analistas</span>
        )}
      </div>

      {/* Trava por fato consensual: contrariou a aprovada → stake no piso. */}
      {travaAnalistas && (
        <div className="mt-2 rounded border border-laranja/40 bg-laranja/10 px-2 py-1 text-[11px] leading-snug text-laranja">
          {travaAnalistas}
        </div>
      )}

      {pernas.length > 1 && (
        <div className="mt-2 space-y-1">
          {pernas.map((p, i) => (
            <div key={i} className="border-l-2 border-borda pl-2 text-xs text-t2 break-words">
              {p.partida} · {rotuloMercado(p.mercado)} <span className="font-mono text-t3">@{p.odd}</span>
            </div>
          ))}
        </div>
      )}

      {pernas[0]?.lambda_escanteios != null && (
        <div className="mt-1 text-[11px] text-t3">
          média projetada de {pernas[0].lambda_escanteios!.toFixed(1)} escanteios no jogo
        </div>
      )}

      <div className="mt-2 rounded-lg bg-fundo p-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="text-t2">Odd na sua casa</span>
          {/* text + inputMode decimal (não type=number): no iOS o teclado digita vírgula e o
              type=number descartaria o valor cru antes de chegar aqui. normalizarOdd cuida do resto. */}
          <input
            type="text" inputMode="decimal" value={oddCasa}
            onChange={(e) => { setOddCasa(e.target.value); setTocou(true); if (estado === 'erro') setEstado('ocioso'); }}
            className="w-20 rounded border border-borda bg-card px-2 py-1 font-mono text-sm text-t1 outline-none focus:border-azul"
          />
          <span className="text-t3">
            {semOdd ? 'obrigatório' : `ref. @${oddReferencia.toFixed(2)}`}
          </span>
          {salvo && <span className="text-[10px] text-t3">salvo ✓</span>}
        </div>
        <div className={`mt-1.5 text-xs leading-snug ${vale ? 'text-verde' : 'text-vermelho'}`}>
          {odd <= 1
            ? `Digite a odd da sua casa — o justo aqui é @${justo.toFixed(2)}`
            : vale
              ? `Ainda vale — @${odd.toFixed(2)} paga acima do justo @${justo.toFixed(2)} (+${ganho.toFixed(1)}%)`
              : `Nessa odd a vantagem sumiu — o justo é @${justo.toFixed(2)}, melhor pular`}
        </div>
        {alertaImplausivel && (
          <div className="mt-1 rounded bg-vermelho/10 px-2 py-1 text-[11px] leading-snug text-vermelho">
            Vantagem de {ganho.toFixed(0)}% sem preço de mercado pra ancorar — confira se pegou o mercado certo (vantagem improvável).
          </div>
        )}
        <div className="mt-0.5 text-[11px] text-t3">Chance real de dar certo: {(prob * 100).toFixed(0)}%</div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-t3">R$</span>
        <input
          type="number" step="0.01" inputMode="decimal" value={stake}
          onChange={(e) => { setStake(Number(e.target.value)); setTocou(true); }}
          className="w-20 rounded border border-borda bg-fundo px-2 py-1 text-sm text-t1 outline-none focus:border-azul"
        />
        <span className="text-[11px] text-t3">sugerido {brl(stakeRS)} ({stakePct}%)</span>
        <button
          disabled={registrado || travado || !vale || estado === 'enviando'}
          onClick={registrar}
          className={`ml-auto rounded px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed ${
            registrado ? 'bg-verde/20 text-verde' : 'bg-rosa text-white disabled:bg-borda disabled:text-t3'
          }`}
        >
          {registrado ? 'registrado ✓'
            : travado ? 'só 1 sem linha/jogo'
            : estado === 'enviando' ? 'registrando…'
            : odd <= 1 ? 'Digite a odd'
            : vale ? 'Registrar' : 'Sem valor'}
        </button>
      </div>

      {estado === 'erro' && (
        <div className="mt-2 rounded border border-vermelho/40 bg-vermelho/10 px-2 py-1.5 text-[11px] leading-snug text-vermelho break-words">
          Não registrou: {erro}
        </div>
      )}
    </div>
  );
}
