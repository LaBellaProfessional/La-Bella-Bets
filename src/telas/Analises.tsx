import { useState } from 'react';
import { pct, rotuloMercado, familiaDoMercado, NOME_FAMILIA, type Analise, type Familia, type Perna } from '../dados';
import { Vazio } from './Inicio';
import { SecaoContextoAnalistas } from '../componentes/ContextoAnalistas';

/**
 * ABA ANÁLISES — LINGUAGEM DE APOSTADOR.
 *
 * Quem lê é apostador, não estatístico. A primeira camada é português direto, com CONTAGENS
 * ("9 de 10"), nunca percentual nem jargão. O detalhe técnico não some: fica atrás do toggle
 * "ver números", intacto.
 *
 * Toda frase vem de template determinístico sobre os dados da análise — a mesma análise gera
 * sempre o mesmo texto. Nada aqui é gerado na hora nem "aproximado".
 */

/* ── tradução dos motivos: o porquê em vez do código ─────────────────────── */
function traduzirMotivo(motivo: string): string {
  if (/sem odd/i.test(motivo)) return 'A casa não abriu linha pra esse jogo';
  if (/amostra insuficiente/i.test(motivo)) return 'Poucos jogos no mando nessa temporada pra confiar no padrão';
  if (/modelos divergem/i.test(motivo)) return 'O retrovisor (últimos jogos) e a matemática (força dos elencos) discordam — melhor ficar de fora';
  if (/EV implausível/i.test(motivo)) return 'Bom demais pra ser verdade — provável erro de linha, fora';
  if (/abaixo da margem/i.test(motivo)) return 'A odd paga menos do que a chance real vale — aposta que empobrece devagar';
  if (/handicap sem Dixon/i.test(motivo)) return 'Handicap sem a matemática pronta pra essa liga — sem base, não entramos';
  if (/odd .* abaixo do mínimo/i.test(motivo)) return 'A odd é baixa demais pra compensar o risco';
  if (/escanteios:.*abaixo do mínimo/i.test(motivo)) return 'Chance de escanteio não é convincente o bastante — e aqui não há odd de mercado pra conferir';
  if (/escanteios:.*jogo\(s\) com estatística/i.test(motivo)) return 'Poucos jogos com estatística de escanteio coletada pra esses times';
  return motivo;
}

/**
 * ORDEM DE LEITURA: aprovada, radar, reprovada.
 *
 * O que dá pra fazer hoje vem primeiro. Antes a lista saía na ordem em que o motor avaliou —
 * e como a maioria é reprovada, a única entrada boa do jogo aparecia no fim, depois de dez
 * linhas vermelhas.
 */
const ordemDaPerna = (p: Perna) => (p.aprovada && !p.radar ? 0 : p.radar ? 1 : 2);

type Contagem = { n: number; venceu: number; empatou: number; perdeu: number; nao_perdeu: number; over15: number };
type Contagens = { casa: { time: string; mando: Contagem; geral: Contagem }; fora: { time: string; mando: Contagem; geral: Contagem } };

/* ── veredito do jogo em palavras ────────────────────────────────────────── */

/** "resultado e gols", "escanteios", "resultado, gols e escanteios". */
function listarFamilias(pernas: Perna[]): string {
  const ORDEM: Familia[] = ['resultado', 'gols', 'escanteios'];
  const nomes = ORDEM
    .filter((f) => pernas.some((p) => familiaDoMercado(p.mercado) === f))
    .map((f) => NOME_FAMILIA[f].toLowerCase());
  if (nomes.length <= 1) return nomes[0] ?? '';
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/**
 * O veredito TEM QUE NOMEAR ONDE ESTÁ O VALOR.
 *
 * Antes ele dizia "Tem valor na mesa, dá pra entrar" em verde no topo de uma lista onde tudo
 * que aparecia estava reprovado — porque o valor estava em escanteios e escanteio nem era
 * listado. Um verde genérico em cima de lista vermelha é pior do que não ter veredito: parece
 * bug do sistema e destrói a confiança na tela. A família citada aqui sempre bate com as
 * pernas aprovadas listadas abaixo.
 */
function vereditoDoJogo(pernas: Perna[]): { texto: string; cor: string } {
  if (!pernas.length) return { texto: 'Nada avaliado neste jogo', cor: 'text-t3' };

  const aprovadas = pernas.filter((p) => p.aprovada && !p.radar);
  const radar = pernas.filter((p) => p.radar);

  if (aprovadas.length) {
    const forte = aprovadas.find((p) => (p.prob_final ?? 0) >= 0.75);
    const detalhe = forte
      ? ` · cenário claro em ${rotuloMercado(forte.mercado).toLowerCase()}`
      : '';
    return { texto: `Tem valor — ${listarFamilias(aprovadas)}${detalhe}`, cor: 'text-verde' };
  }
  if (radar.length) {
    return { texto: `Promissor em ${listarFamilias(radar)}, mas ainda cedo — esperar a véspera`, cor: 'text-ambar' };
  }
  if (!pernas.some((p) => p.odd != null || p.sem_odd_referencia)) {
    return { texto: 'Sem linha na casa, ignorado', cor: 'text-t3' };
  }
  return { texto: 'Sem valor hoje', cor: 'text-t2' };
}

/* ── o porquê, com contagens ─────────────────────────────────────────────── */
function porqueDoJogo(c: Contagens | undefined, casa: string): string | null {
  if (!c?.casa?.mando || !c?.fora?.mando) return null;
  const partes: string[] = [];

  const m = c.casa.mando;
  if (m.n > 0) {
    if (m.nao_perdeu >= Math.ceil(m.n * 0.7)) partes.push(`${casa} não perde em casa em ${m.nao_perdeu} de ${m.n}`);
    else if (m.perdeu >= Math.ceil(m.n * 0.5)) partes.push(`${casa} perdeu ${m.perdeu} dos últimos ${m.n} em casa`);
    else partes.push(`${casa} oscila em casa: ${m.venceu}V ${m.empatou}E ${m.perdeu}D nos últimos ${m.n}`);
  }

  const f = c.fora.mando;
  if (f.n > 0) {
    if (f.perdeu >= Math.ceil(f.n * 0.5)) partes.push(`o visitante perdeu ${f.perdeu} das últimas ${f.n} fora`);
    else if (f.nao_perdeu >= Math.ceil(f.n * 0.7)) partes.push(`o visitante não perde fora em ${f.nao_perdeu} de ${f.n}`);
    else partes.push(`fora de casa o visitante fez ${f.venceu}V ${f.empatou}E ${f.perdeu}D em ${f.n}`);
  }

  if (!partes.length) return null;
  return partes.join(', e ') + '.';
}

/* ── chip de mercado com semáforo textual ────────────────────────────────── */
function chipDoMercado(p: Perna): { icone: string; cor: string; texto: string } {
  const nome = rotuloMercado(p.mercado);
  const chance = p.prob_final != null ? ` modelo vê ${(p.prob_final * 100).toFixed(0)}%` : '';
  const justo = p.prob_final ? ` (justo seria @${(1 / p.prob_final).toFixed(2)})` : '';
  // Escanteio não tem preço publicado: em vez de "@null", diz que a odd é você que traz.
  const preco = p.odd != null ? ` @${p.odd}` : p.sem_odd_referencia ? ' (sem odd de mercado)' : '';

  if (p.radar) {
    return { icone: '🟡', cor: 'border-ambar/40 bg-ambar/5 text-ambar',
      texto: `NO RADAR — ${nome}${preco}, esperar véspera` };
  }
  if (p.aprovada) {
    return { icone: '✅', cor: 'border-verde/40 bg-verde/5 text-verde',
      texto: `APROVADA — ${nome}${preco},${chance}${justo}` };
  }
  return { icone: '❌', cor: 'border-borda bg-fundo text-t3',
    texto: `REPROVADA — ${nome}${preco}: ${traduzirMotivo(p.motivo ?? '')}` };
}

export function Analises({ analise }: { analise: Analise | null }) {
  const [verNumeros, setVerNumeros] = useState(false);
  const [verIgnorados, setVerIgnorados] = useState(false);

  if (!analise) return <Vazio titulo="Nada analisado nesta data">Use "Analisar agora" para gerar este dia.</Vazio>;

  const resumo = analise.resumo ?? { jogos: 0, aprovadas: 0, descartadas: 0, pernas_avaliadas: 0, bilhetes: 0, sem_bilhete: true };
  const jogos = analise.jogos ?? [];
  const pernas = analise.pernas ?? [];

  // "Tem o que mostrar" = a casa abriu linha OU o modelo tem veredito próprio (escanteios).
  // Usar só `odd != null` jogava jogo com escanteio aprovado pro balde de "ignorados" — e o
  // card do jogo escondia a única entrada boa que ele tinha.
  const temConteudo = (p: Perna) => p.odd != null || Boolean(p.sem_odd_referencia);
  const porJogo = jogos.map((j) => ({
    jogo: j,
    pernas: pernas.filter((p) => p.jogo_id === j.id).sort((a, b) => ordemDaPerna(a) - ordemDaPerna(b)),
  }));
  const comLinha = porJogo.filter(({ pernas: ps }) => ps.some(temConteudo));
  const semLinha = porJogo.filter(({ pernas: ps }) => !ps.some(temConteudo));
  const valeram = comLinha.filter(({ pernas: ps }) => ps.some((p) => p.aprovada));

  // Resumo do dia em uma frase — a leitura de 3 segundos.
  const frase =
    `${jogos.length} jogos olhados · ${comLinha.length} com linha aberta · ` +
    (valeram.length ? `${valeram.length} com valor` : 'nenhum valeu o risco hoje');

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-borda bg-card px-4 py-4">
        <div className="text-base font-medium text-t1">{frase}</div>
        <label className="mt-3 flex w-fit cursor-pointer items-center gap-2 text-xs text-t2">
          <input type="checkbox" checked={verNumeros} onChange={(e) => setVerNumeros(e.target.checked)} />
          ver números
        </label>
      </div>

      {comLinha.map(({ jogo, pernas: ps }) => {
        const veredito = vereditoDoJogo(ps);
        const porque = porqueDoJogo((jogo as { contagens?: Contagens }).contagens, jogo.casa);
        return (
          <div key={jogo.id} className="overflow-hidden rounded-xl border border-borda bg-card">
            <div className="border-b border-borda px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-t1">{jogo.casa} <span className="text-t3">x</span> {jogo.fora}</span>
                <span className="text-xs text-t3">{jogo.liga} · {jogo.hora}</span>
              </div>
              <div className={`mt-1 text-sm font-medium ${veredito.cor}`}>{veredito.texto}</div>
              {porque && <div className="mt-1 text-xs leading-relaxed text-t2">{porque}</div>}
            </div>

            <div className="space-y-2 p-4">
              {/* Contexto dos analistas (fatos/dados/opiniões + alerta laranja) casado por partida. */}
              <SecaoContextoAnalistas contexto={analise.analistas_por_jogo?.[`${jogo.casa} x ${jogo.fora}`]} />
              {ps.filter(temConteudo).map((p, i) => {
                const chip = chipDoMercado(p);
                return (
                  <div key={i} className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${chip.cor}`}>
                    <span className="mr-1">{chip.icone}</span>{chip.texto}
                    {p.badge_amostra && (
                      <span className="ml-2 rounded bg-ambar/15 px-1.5 py-0.5 text-[10px] text-ambar">
                        {p.badge_amostra}
                      </span>
                    )}
                  </div>
                );
              })}

              {verNumeros && <TabelaNumeros pernas={ps} />}
            </div>
          </div>
        );
      })}

      {semLinha.length > 0 && (
        <div className="rounded-xl border border-borda bg-card p-4">
          <button
            onClick={() => setVerIgnorados(!verIgnorados)}
            className="text-xs text-t3 underline-offset-2 hover:underline"
          >
            {semLinha.length} jogo(s) ignorados — a casa não abriu linha {verIgnorados ? '▲' : '▼'}
          </button>
          {verIgnorados && (
            <div className="mt-3 space-y-1">
              {semLinha.map(({ jogo }) => (
                <div key={jogo.id} className="text-xs text-t3">
                  {jogo.casa} x {jogo.fora} · {jogo.liga}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {verNumeros && (
        <div className="rounded-lg border border-borda bg-card p-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-t3">Matemática por liga</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(analise.dixon_coles_por_liga ?? {}).map(([liga, m]) => (
              <span key={liga}
                className={`rounded px-2 py-1 text-xs ${m.disponivel ? 'bg-verde/10 text-verde' : 'bg-ambar/10 text-ambar'}`}
                title={m.motivo ?? ''}>
                {m.disponivel ? '✓' : '✗'} {liga} {m.disponivel ? `(${m.n_jogos} jogos)` : '— só retrovisor'}
              </span>
            ))}
          </div>
          <div className="mt-3 text-[11px] text-t3">
            {resumo.pernas_avaliadas} apostas possíveis avaliadas · {resumo.aprovadas} aprovadas · {resumo.descartadas} descartadas
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * O detalhe técnico de sempre — nada se perde, só sai da primeira camada.
 *
 * DUAS FORMAS, mesmo conteúdo. A tabela de seis colunas não cabe em 390px: ela vivia num
 * container de rolagem horizontal, e arrastar o dedo em cima dela rolava a tela pro lado.
 * A página nunca rolou (medi: scrollWidth 390 = clientWidth 390) — quem rolava era a tabela,
 * e pro dedo é a mesma coisa. No celular o mesmo dado vira lista empilhada; no desktop
 * continua tabela, que é onde comparar linha a linha vale a pena.
 */
function TabelaNumeros({ pernas }: { pernas: Perna[] }) {
  return (
    <>
      <div className="mt-2 space-y-1.5 sm:hidden">
        {pernas.map((p, i) => (
          <div key={i} className={`rounded border border-borda px-2.5 py-2 text-xs ${p.aprovada ? '' : 'opacity-60'}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-t1 break-words">{rotuloMercado(p.mercado)}</span>
              <span className="ml-auto font-mono text-t2">{p.odd ?? '—'}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-t3">
              <span>retrovisor {pct(p.prob_heuristica)}</span>
              <span>matemática {p.prob_dixon_coles == null ? '—' : pct(p.prob_dixon_coles)}</span>
              <span className={(p.ev ?? 0) > 1 ? 'text-verde' : undefined}>
                vantagem {p.ev == null ? '—' : `${((p.ev - 1) * 100).toFixed(1)}%`}
              </span>
              <span>mando {p.amostra_mando} jogos</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 hidden rounded border border-borda sm:block">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-t3">
            <th className="px-3 py-2 font-medium">Mercado</th>
            <th className="px-2 py-2 font-medium">Retrovisor</th>
            <th className="px-2 py-2 font-medium">Matemática</th>
            <th className="px-2 py-2 font-medium">Odd</th>
            <th className="px-2 py-2 font-medium">Vantagem</th>
            <th className="px-2 py-2 font-medium">Mando</th>
          </tr>
        </thead>
        <tbody>
          {pernas.map((p, i) => (
            <tr key={i} className={`border-t border-borda/60 ${p.aprovada ? '' : 'opacity-60'}`}>
              <td className="px-3 py-1.5 text-t1">{rotuloMercado(p.mercado)}</td>
              <td className="px-2 py-1.5 text-t2">{pct(p.prob_heuristica)}</td>
              <td className="px-2 py-1.5 text-t2">{p.prob_dixon_coles == null ? '—' : pct(p.prob_dixon_coles)}</td>
              <td className="px-2 py-1.5 font-mono text-t2">{p.odd ?? '—'}</td>
              <td className={`px-2 py-1.5 ${(p.ev ?? 0) > 1 ? 'text-verde' : 'text-t3'}`}>
                {p.ev == null ? '—' : `${((p.ev - 1) * 100).toFixed(1)}%`}
              </td>
              <td className="px-2 py-1.5 text-t3">{p.amostra_mando} jogos</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
