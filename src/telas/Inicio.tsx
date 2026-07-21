import { useState } from 'react';
import {
  brl, rotuloMercado, familiaDoMercado, NOME_FAMILIA,
  type Analise, type Bilhete, type Config, type Perna, type Registro,
} from '../dados';

/**
 * ABA INÍCIO — a tela de decisão, organizada POR JOGO.
 *
 * A versão anterior agrupava por mercado, e o efeito colateral era esconder a única coisa que
 * importa pro risco: três entradas diferentes podiam ser do MESMO jogo, espalhadas por três
 * blocos distintos da tela. Se aquele jogo desse errado, as três morriam juntas — e nada na
 * tela dizia isso. Agora cada partida é um card, e a concentração fica na cara.
 *
 * Cada entrada dentro do card tem seu próprio campo de odd e seu próprio botão: a odd da casa
 * do Maikon é diferente da odd de referência (europeia), e o veredito só existe depois que ele
 * digita o número real.
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
  data: string; pernas: Perna[]; odd_real: number; odd_referencia: number;
  prob: number; stake: number; casa_odd: string | null;
}

/**
 * Identidade de uma entrada: dia + conjunto de (partida, mercado).
 *
 * Era aqui que estava o bug do "Registrar não faz nada". A comparação antiga era pela ODD
 * (`registro.odd_referencia === perna.odd`), e escanteio não tem odd de referência: virava
 * `0 === null`, nunca casava, o card nunca mudava de estado. O insert acontecia toda vez —
 * o Maikon clicava de novo achando que tinha falhado e gravava duplicata. Dez, no dia 21/07.
 * Odd é valor variável; partida+mercado é o que identifica a aposta.
 */
const chaveEntrada = (data: string, pernas: { partida: string; mercado: string }[]) =>
  `${data}|${pernas.map((p) => `${p.partida}·${p.mercado}`).sort().join('+')}`;

export function Inicio({
  janela, config, carregando, jaRegistrados, onRegistrar, onAnalisar,
}: {
  janela: Analise[];
  config?: Config;
  carregando?: boolean;
  jaRegistrados: Registro[];
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
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

  const registrados = new Set(
    (jaRegistrados ?? []).map((r) => chaveEntrada(r.data, r.pernas ?? [])),
  );

  return (
    <div className="space-y-6 overflow-x-hidden">
      {janela.map((a) => (
        <DiaBloco key={a.data} analise={a} config={config} registrados={registrados} onRegistrar={onRegistrar} />
      ))}
    </div>
  );
}

/** Uma entrada acionável: bilhete montado ou perna aprovada solta. */
type Entrada =
  | { tipo: 'bilhete'; chave: string; bilhete: Bilhete }
  | { tipo: 'perna'; chave: string; perna: Perna };

const pernasDe = (e: Entrada) => (e.tipo === 'bilhete' ? e.bilhete.pernas : [e.perna]);
const jogosDe = (e: Entrada) => [...new Set(pernasDe(e).map((p) => p.partida))];

function DiaBloco({
  analise, config, registrados, onRegistrar,
}: {
  analise: Analise; config?: Config;
  registrados: Set<string>;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
}) {
  const bilhetes = analise.bilhetes ?? [];
  const pernas = analise.pernas ?? [];

  // Perna aprovada que não entrou em bilhete nenhum é entrada mesmo assim. O radar (D+1..D+3
  // abaixo da margem exigida) fica de fora: ainda não é entrada, é observação.
  const emBilhete = new Set(bilhetes.flatMap((b) => b.pernas.map((p) => `${p.jogo_id}|${p.mercado}`)));
  const soltas = pernas.filter((p) => p.aprovada && !p.radar && !emBilhete.has(`${p.jogo_id}|${p.mercado}`));
  const radar = analise.radar ?? [];

  const entradas: Entrada[] = [
    ...bilhetes.map((b) => ({ tipo: 'bilhete' as const, chave: `b${b.ordem}`, bilhete: b })),
    ...soltas.map((p, i) => ({ tipo: 'perna' as const, chave: `s${i}`, perna: p })),
  ];

  // Bilhete que atravessa dois jogos não pertence a nenhum card de partida: é uma aposta só,
  // com dois riscos. Fica num card próprio, antes dos jogos.
  const combinadas = entradas.filter((e) => jogosDe(e).length > 1);
  const porJogo = new Map<string, Entrada[]>();
  for (const e of entradas) {
    if (jogosDe(e).length > 1) continue;
    const k = jogosDe(e)[0];
    if (!porJogo.has(k)) porJogo.set(k, []);
    porJogo.get(k)!.push(e);
  }

  // Ordem por horário: é a ordem em que as decisões precisam ser tomadas.
  const jogos = [...porJogo.entries()].sort(
    (a, b) => (pernasDe(a[1][0])[0].hora ?? '').localeCompare(pernasDe(b[1][0])[0].hora ?? ''),
  );
  const semEntrada = !combinadas.length && !jogos.length;

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

      {semEntrada ? (
        <div className="rounded-xl border border-borda bg-card px-4 py-5 text-center">
          <div className="text-sm font-medium text-t2">Sem entrada nesse dia</div>
          <div className="mt-1 text-xs text-t3">
            {analise.resumo?.jogos ?? 0} jogos e {analise.resumo?.pernas_avaliadas ?? 0} apostas possíveis analisadas ·{' '}
            {analise.resumo?.aprovadas ?? 0} passaram nos filtros
            {radar.length > 0 && ` · ${radar.length} no radar pra véspera`}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {combinadas.map((e) => (
            <CardJogo
              key={e.chave} data={analise.data} titulo={jogosDe(e).join('  +  ')}
              subtitulo={`bilhete combinado · ${jogosDe(e).length} jogos`}
              entradas={[e]} config={config} registrados={registrados} onRegistrar={onRegistrar}
            />
          ))}
          {jogos.map(([partida, lista]) => {
            const p0 = pernasDe(lista[0])[0];
            return (
              <CardJogo
                key={partida} data={analise.data} titulo={partida}
                subtitulo={[p0.liga, p0.hora].filter(Boolean).join(' · ')}
                entradas={lista} config={config} registrados={registrados} onRegistrar={onRegistrar}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

function CardJogo({
  data, titulo, subtitulo, entradas, config, registrados, onRegistrar,
}: {
  data: string; titulo: string; subtitulo: string; entradas: Entrada[];
  config?: Config; registrados: Set<string>;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
}) {
  const stakePctDe = (p: Perna) =>
    p.confianca === 'CONFIANCA_MAXIMA' && !p.amostra_curta
      ? (config?.stake_confianca_maxima_pct ?? 5)
      : (config?.stake_padrao_pct ?? 3);
  const evMinimo = config?.filtros?.ev_minimo ?? 1.03;

  return (
    <div className="overflow-hidden rounded-xl border border-borda bg-card">
      <div className="border-b border-borda px-4 py-3">
        <div className="text-sm font-semibold leading-snug text-t1 break-words">{titulo}</div>
        <div className="mt-0.5 text-xs text-t3">{subtitulo}</div>
        {entradas.length > 1 && (
          // O aviso é o ponto do redesenho: duas entradas do mesmo jogo não são duas apostas
          // independentes. Se o jogo virar, as duas viram junto.
          <div className="mt-2 rounded bg-ambar/10 px-2 py-1 text-[11px] leading-snug text-ambar">
            {entradas.length} entradas do mesmo jogo — resultado ruim afeta todas
          </div>
        )}
      </div>

      <div className="divide-y divide-borda">
        {entradas.map((e) => {
          const pernas = pernasDe(e);
          const ehBilhete = e.tipo === 'bilhete';
          const p = ehBilhete ? null : e.perna;
          const semOdd = Boolean(p?.sem_odd_referencia);
          return (
            <LinhaEntrada
              key={e.chave}
              data={data}
              pernas={pernas}
              rotulo={
                ehBilhete
                  ? (e.bilhete.n_pernas > 1 ? `Bilhete · ${e.bilhete.n_pernas} pernas` : 'Entrada simples')
                  : rotuloMercado(p!.mercado)
              }
              familia={NOME_FAMILIA[familiaDoMercado(pernas[0].mercado)]}
              oddReferencia={ehBilhete ? e.bilhete.odd_total : semOdd ? (p!.odd_justa ?? 0) : (p!.odd ?? 0)}
              semOdd={semOdd}
              prob={ehBilhete ? e.bilhete.prob_combinada : (p!.prob_final ?? 0)}
              stakePct={ehBilhete ? e.bilhete.stake_pct : stakePctDe(p!)}
              stakeRS={ehBilhete ? e.bilhete.stake_rs : (p!.stake_rs ?? +(((config?.banca ?? 1000) * stakePctDe(p!)) / 100).toFixed(2))}
              confiancaMaxima={ehBilhete ? e.bilhete.todas_confianca_maxima : p!.confianca === 'CONFIANCA_MAXIMA' && !p!.amostra_curta}
              rebaixada={!ehBilhete && p!.confianca === 'REBAIXADA'}
              evMinimo={evMinimo}
              jaRegistrado={registrados.has(chaveEntrada(data, pernas))}
              onRegistrar={onRegistrar}
            />
          );
        })}
      </div>
    </div>
  );
}

function LinhaEntrada({
  data, pernas, rotulo, familia, oddReferencia, prob, stakePct, stakeRS,
  confiancaMaxima, rebaixada, evMinimo, semOdd, jaRegistrado, onRegistrar,
}: {
  data: string; pernas: Perna[]; rotulo: string; familia: string;
  oddReferencia: number; prob: number; stakePct: number; stakeRS: number;
  confiancaMaxima: boolean; rebaixada: boolean; evMinimo: number;
  semOdd?: boolean; jaRegistrado: boolean;
  onRegistrar: (e: EntradaRegistro) => Promise<unknown>;
}) {
  // Escanteios entram com o campo VAZIO de propósito: preencher com a odd justa convidaria a
  // registrar o número do modelo como se fosse preço de casa — o erro que o CLV existe pra medir.
  const [oddCasa, setOddCasa] = useState<string>(semOdd ? '' : oddReferencia.toFixed(2));
  const [stake, setStake] = useState<number>(stakeRS);
  const [estado, setEstado] = useState<'ocioso' | 'enviando' | 'ok' | 'erro'>('ocioso');
  const [erro, setErro] = useState<string | null>(null);

  const odd = Number(oddCasa) || 0;
  const justo = prob > 0 ? 1 / prob : 0;
  const valorNaOdd = prob * odd;           // 1.00 = pagou o justo
  const vale = valorNaOdd >= evMinimo;
  const ganho = (valorNaOdd - 1) * 100;
  const registrado = jaRegistrado || estado === 'ok';

  async function registrar() {
    setEstado('enviando'); setErro(null);
    try {
      await onRegistrar({
        data, pernas, odd_real: odd,
        // Sem odd de mercado não há referência de CLV: gravar a odd justa como se fosse a odd
        // vista seria inventar um preço que ninguém publicou.
        odd_referencia: semOdd ? 0 : oddReferencia,
        prob, stake, casa_odd: pernas[0]?.casa_odd ?? null,
      });
      setEstado('ok');
    } catch (e) {
      // Silenciar a falha foi metade do bug de 21/07: sem mensagem, "não gravou" e "gravou e
      // não avisou" ficam idênticos na tela — e o clique se repete.
      setEstado('erro');
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-medium text-azul">{rotulo}</span>
        <span className="text-[10px] uppercase tracking-wider text-t3">{familia}</span>
        <span className="ml-auto font-mono text-sm text-t2">
          {semOdd ? `justa @${oddReferencia.toFixed(2)}` : `@${oddReferencia.toFixed(2)}`}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-1.5">
        {confiancaMaxima && (
          <span className="rounded bg-verde/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-verde">confiança máxima</span>
        )}
        {rebaixada && (
          <span className="rounded bg-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-t3">confiança rebaixada</span>
        )}
        {pernas.some((p) => p.amostra_curta) && (
          <span className="rounded bg-ambar/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ambar">amostra curta</span>
        )}
      </div>

      {/* Num bilhete, as pernas precisam aparecer: o card é do jogo, mas a aposta tem partes. */}
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
          <input
            type="number" step="0.01" inputMode="decimal" value={oddCasa}
            onChange={(e) => { setOddCasa(e.target.value); if (estado === 'erro') setEstado('ocioso'); }}
            className="w-20 rounded border border-borda bg-card px-2 py-1 font-mono text-sm text-t1 outline-none focus:border-azul"
          />
          <span className="text-t3">
            {semOdd ? 'obrigatório' : `ref. @${oddReferencia.toFixed(2)}`}
          </span>
        </div>
        <div className={`mt-1.5 text-xs leading-snug ${vale ? 'text-verde' : 'text-vermelho'}`}>
          {odd <= 1
            ? `Digite a odd da sua casa — o justo aqui é @${justo.toFixed(2)}`
            : vale
              ? `Ainda vale — @${odd.toFixed(2)} paga acima do justo @${justo.toFixed(2)} (+${ganho.toFixed(1)}%)`
              : `Nessa odd a vantagem sumiu — o justo é @${justo.toFixed(2)}, melhor pular`}
        </div>
        <div className="mt-0.5 text-[11px] text-t3">Chance real de dar certo: {(prob * 100).toFixed(0)}%</div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-t3">R$</span>
        <input
          type="number" step="0.01" inputMode="decimal" value={stake}
          onChange={(e) => setStake(Number(e.target.value))}
          className="w-20 rounded border border-borda bg-fundo px-2 py-1 text-sm text-t1 outline-none focus:border-azul"
        />
        <span className="text-[11px] text-t3">sugerido {brl(stakeRS)} ({stakePct}%)</span>
        <button
          disabled={registrado || !vale || estado === 'enviando'}
          onClick={registrar}
          className={`ml-auto rounded px-3 py-1.5 text-sm font-semibold disabled:cursor-not-allowed ${
            registrado ? 'bg-verde/20 text-verde' : 'bg-rosa text-white disabled:bg-borda disabled:text-t3'
          }`}
        >
          {registrado ? 'registrado ✓'
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
