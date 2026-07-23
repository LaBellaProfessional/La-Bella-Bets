import { useEffect, useRef, useState } from 'react';
import type { Config } from '../dados';

/**
 * CONFIG — linguagem humana + controles certos por tipo.
 *
 * Nenhum nome de variável cru na tela: cada campo tem título curto + subtítulo do efeito prático.
 * Percentuais SEMPRE em % (o banco guarda % inteiro no formato unificado; o motor converte na
 * leitura — ver _shared/filtros.js). Controles por natureza do dado: slider pra faixas conhecidas,
 * stepper pra inteiros pequenos, R$ mascarado pra banca, toggle pra ligas. Seções colapsáveis;
 * "Avançado" esconde o que raramente se toca. Salva sozinho (debounce) com "salvo ✓" discreto.
 */

/* ───────────────────────── ÍCONES (lucide, inline — sem dependência) ───────────────────────── */
const ICONES: Record<string, React.ReactNode> = {
  wallet: <><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2" /><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" /></>,
  filter: <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />,
  calendar: <><path d="M8 2v4M16 2v4" /><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M3 10h18" /></>,
  flag: <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" x2="4" y1="22" y2="15" /></>,
  list: <><line x1="8" x2="21" y1="6" y2="6" /><line x1="8" x2="21" y1="12" y2="12" /><line x1="8" x2="21" y1="18" y2="18" /><line x1="3" x2="3.01" y1="6" y2="6" /><line x1="3" x2="3.01" y1="12" y2="12" /><line x1="3" x2="3.01" y1="18" y2="18" /></>,
  sliders: <><line x1="21" x2="14" y1="4" y2="4" /><line x1="10" x2="3" y1="4" y2="4" /><line x1="21" x2="12" y1="12" y2="12" /><line x1="8" x2="3" y1="12" y2="12" /><line x1="21" x2="16" y1="20" y2="20" /><line x1="12" x2="3" y1="20" y2="20" /><line x1="14" x2="14" y1="2" y2="6" /><line x1="8" x2="8" y1="10" y2="14" /><line x1="16" x2="16" y1="18" y2="22" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  restaurar: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></>,
};
function Icone({ nome, className }: { nome: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {ICONES[nome]}
    </svg>
  );
}

/* ───────────────────────── ESQUEMA DOS CAMPOS ───────────────────────── */
type Ctrl = 'slider' | 'stepper' | 'reais';
interface CampoDef {
  key: string; escopo: 'root' | 'filtro'; ctrl: Ctrl;
  label: string; sub: string;
  min?: number; max?: number; step?: number; sufixo?: string; metodo?: boolean; padrao?: number;
}
interface SecaoDef { id: string; titulo: string; icone: string; campos: CampoDef[]; avancado?: boolean }

const SECOES: SecaoDef[] = [
  { id: 'banca', titulo: 'Banca e stake', icone: 'wallet', campos: [
    { key: 'banca', escopo: 'root', ctrl: 'reais', label: 'Banca consolidada', sub: 'Muda só quando você confirma um resultado (ganho ou perda).' },
    { key: 'stake_padrao_pct', escopo: 'root', ctrl: 'slider', label: 'Aposta padrão', sub: 'Quanto da banca entra numa aposta comum.', min: 1, max: 5, step: 0.5, sufixo: '%', padrao: 3 },
    { key: 'stake_confianca_maxima_pct', escopo: 'root', ctrl: 'slider', label: 'Aposta em confiança máxima', sub: 'Usada quando os dois modelos estão muito confiantes.', min: 1, max: 8, step: 0.5, sufixo: '%', padrao: 5 },
    { key: 'teto_exposicao_diaria_pct', escopo: 'root', ctrl: 'slider', label: 'Teto de risco no dia', sub: 'Máximo da banca comprometida num dia só.', min: 4, max: 12, step: 0.5, sufixo: '%', padrao: 8 },
  ] },
  { id: 'filtros', titulo: 'Filtros do método', icone: 'filter', campos: [
    { key: 'ev_minimo', escopo: 'filtro', ctrl: 'slider', label: 'Vantagem mínima pra entrar', sub: 'Só aprova aposta que paga acima do justo por essa margem.', min: 1, max: 10, step: 0.5, sufixo: '%', metodo: true, padrao: 3 },
    { key: 'odd_minima_perna', escopo: 'filtro', ctrl: 'slider', label: 'Odd mínima por aposta', sub: 'Abaixo disso o risco não compensa.', min: 1.01, max: 1.50, step: 0.01, metodo: true, padrao: 1.10 },
    { key: 'mando_minimo', escopo: 'filtro', ctrl: 'stepper', label: 'Jogos mínimos em casa', sub: 'Com menos jogos que isso no mando, o jogo é descartado.', min: 3, max: 10, metodo: true, padrao: 5 },
    { key: 'mando_pleno', escopo: 'filtro', ctrl: 'stepper', label: 'Jogos pra confiança cheia', sub: 'A partir daqui o desempenho em casa conta 100%.', min: 5, max: 15, metodo: true, padrao: 7 },
    { key: 'max_bilhetes_dia', escopo: 'filtro', ctrl: 'stepper', label: 'Sugestões de bilhete por dia', sub: 'Quantos bilhetes o sistema MONTA por dia — não limita seus registros.', min: 1, max: 8, metodo: true, padrao: 4 },
    { key: 'odd_bilhete_min', escopo: 'filtro', ctrl: 'slider', label: 'Odd mínima do bilhete combinado', sub: 'Piso da odd total de um bilhete montado.', min: 1.20, max: 2.00, step: 0.05, metodo: true, padrao: 1.40 },
    { key: 'odd_bilhete_max', escopo: 'filtro', ctrl: 'slider', label: 'Odd máxima do bilhete combinado', sub: 'Teto da odd total — acima disso vira aposta de risco.', min: 1.30, max: 2.50, step: 0.05, metodo: true, padrao: 1.60 },
  ] },
  { id: 'janela', titulo: 'Janela e antecipadas', icone: 'calendar', campos: [
    { key: 'dias_janela', escopo: 'filtro', ctrl: 'stepper', label: 'Dias analisados à frente', sub: 'Quantos dias de jogos futuros o motor cobre.', min: 1, max: 7, padrao: 4 },
    { key: 'ev_minimo_antecipado', escopo: 'filtro', ctrl: 'slider', label: 'Exigência extra pra jogos futuros', sub: 'Jogo de amanhã em diante só entra com vantagem maior (escalações mudam).', min: 1, max: 15, step: 0.5, sufixo: '%', metodo: true, padrao: 6 },
  ] },
  { id: 'escanteios', titulo: 'Escanteios', icone: 'flag', campos: [
    { key: 'escanteios_prob_minima', escopo: 'filtro', ctrl: 'slider', label: 'Convicção mínima em escanteios', sub: 'Só sugere escanteio quando o modelo está bem confiante.', min: 55, max: 75, step: 1, sufixo: '%', metodo: true, padrao: 62 },
    { key: 'escanteios_amostra_minima', escopo: 'filtro', ctrl: 'stepper', label: 'Jogos mínimos com estatística de escanteios', sub: 'Sem essa amostra, o mercado não é arriscado.', min: 3, max: 15, metodo: true, padrao: 6 },
  ] },
  { id: 'avancado', titulo: 'Avançado', icone: 'sliders', avancado: true, campos: [
    { key: 'convicao_minima_sem_odd', escopo: 'filtro', ctrl: 'slider', label: 'Convicção mínima sem linha da API', sub: 'Jogo sem preço de mercado só vira card com o modelo bem confiante.', min: 50, max: 75, step: 1, sufixo: '%', metodo: true, padrao: 60 },
    { key: 'odd_justa_minima_sem_odd', escopo: 'filtro', ctrl: 'slider', label: 'Odd justa mínima sem linha', sub: 'Abaixo disso o prêmio é improvável — a entrada não some, só recolhe em AGUARDA ODD (campo ativo).', min: 1.10, max: 1.50, step: 0.05, metodo: true, padrao: 1.25 },
    { key: 'divergencia_maxima_pp', escopo: 'filtro', ctrl: 'slider', label: 'Divergência máxima entre os modelos', sub: 'Se heurística e Dixon-Coles discordam mais que isso, descarta.', min: 3, max: 20, step: 1, sufixo: ' p.p.', metodo: true, padrao: 10 },
    { key: 'ev_teto_suspeito', escopo: 'filtro', ctrl: 'slider', label: 'Teto de vantagem plausível', sub: 'Vantagem acima disso é erro de modelo/odd defasada, não oportunidade.', min: 20, max: 60, step: 1, sufixo: '%', metodo: true, padrao: 35 },
    { key: 'ah_vantagem_minima_pp', escopo: 'filtro', ctrl: 'slider', label: 'Handicap: vantagem mínima vs Dixon-Coles', sub: 'Só monta handicap com essa folga sobre a matriz de placares.', min: 1, max: 10, step: 1, sufixo: ' p.p.', metodo: true, padrao: 3 },
    { key: 'confianca_maxima_prob', escopo: 'filtro', ctrl: 'slider', label: 'Confiança máxima: probabilidade mínima', sub: 'Prob dos dois modelos pra marcar a entrada como confiança máxima.', min: 70, max: 90, step: 1, sufixo: '%', metodo: true, padrao: 80 },
    { key: 'confianca_maxima_ev', escopo: 'filtro', ctrl: 'slider', label: 'Confiança máxima: vantagem mínima', sub: 'Vantagem pra confiança máxima (puxa o stake maior).', min: 3, max: 15, step: 0.5, sufixo: '%', metodo: true, padrao: 6 },
  ] },
];

/* ───────────────────────── FORMATAÇÃO ───────────────────────── */
const ehOdd = (k: string) => k.startsWith('odd_');
function mostrar(campo: CampoDef, v: number): string {
  if (campo.sufixo) return `${v}${campo.sufixo}`;
  if (ehOdd(campo.key)) return `@${v.toFixed(2)}`;
  return `${v}`;
}

/* ───────────────────────── TELA ───────────────────────── */
export function Configuracoes({ config, onSalvar }: { config: Config; onSalvar: (c: Config) => void }) {
  const [c, setC] = useState<Config>(config);
  const [salvo, setSalvo] = useState(false);
  const [tocou, setTocou] = useState(false);
  const [abertas, setAbertas] = useState<Record<string, boolean>>(
    Object.fromEntries(SECOES.map((s) => [s.id, !s.avancado])),
  );
  const tSalvar = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setC(config); }, [config]);

  // Auto-save discreto: 700ms depois da última mudança. Sem botão, sem modal.
  useEffect(() => {
    if (!tocou) return;
    setSalvo(false);
    if (tSalvar.current) clearTimeout(tSalvar.current);
    tSalvar.current = setTimeout(() => { onSalvar(c); setSalvo(true); }, 700);
    return () => { if (tSalvar.current) clearTimeout(tSalvar.current); };
  }, [c, tocou]); // eslint-disable-line react-hooks/exhaustive-deps

  const getVal = (campo: CampoDef): number =>
    campo.escopo === 'root'
      ? (c as unknown as Record<string, number>)[campo.key]
      : (c.filtros[campo.key] ?? campo.padrao ?? 0);

  const setVal = (campo: CampoDef, v: number) => {
    setTocou(true);
    if (campo.escopo === 'root') setC({ ...c, [campo.key]: v } as Config);
    else setC({ ...c, filtros: { ...c.filtros, [campo.key]: v } });
  };

  const restaurar = (secao: SecaoDef) => {
    setTocou(true);
    const next: Config = { ...c, filtros: { ...c.filtros } };
    for (const campo of secao.campos) {
      if (campo.padrao == null) continue;
      if (campo.escopo === 'root') (next as unknown as Record<string, number>)[campo.key] = campo.padrao;
      else next.filtros[campo.key] = campo.padrao;
    }
    setC(next);
  };

  return (
    <div className="space-y-3 overflow-x-hidden">
      {SECOES.map((secao) => (
        <SecaoCard
          key={secao.id} secao={secao} aberta={abertas[secao.id]}
          onToggle={() => setAbertas((a) => ({ ...a, [secao.id]: !a[secao.id] }))}
          getVal={getVal} setVal={setVal} onRestaurar={() => restaurar(secao)}
        >
          {secao.id === 'escanteios' && <LigasBloco c={c} setC={(x) => { setTocou(true); setC(x); }} />}
        </SecaoCard>
      ))}

      {/* "salvo ✓" flutuante e discreto. */}
      <div className={`pointer-events-none fixed inset-x-0 bottom-4 flex justify-center transition-opacity ${salvo ? 'opacity-100' : 'opacity-0'}`}>
        <span className="rounded-full border border-verde/40 bg-card px-3 py-1 text-xs font-medium text-verde shadow">salvo ✓</span>
      </div>

      <p className="pt-1 text-center text-[11px] leading-snug text-t3">
        As chaves de API ficam no <code className="text-azul">.env</code> do servidor, nunca aqui.
      </p>
    </div>
  );
}

function SecaoCard({
  secao, aberta, onToggle, getVal, setVal, onRestaurar, children,
}: {
  secao: SecaoDef; aberta: boolean; onToggle: () => void;
  getVal: (c: CampoDef) => number; setVal: (c: CampoDef, v: number) => void;
  onRestaurar: () => void; children?: React.ReactNode;
}) {
  const temMetodo = secao.campos.some((c) => c.metodo);
  const temPadrao = secao.campos.some((c) => c.padrao != null);
  return (
    <div className="overflow-hidden rounded-xl border border-borda bg-card">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <Icone nome={secao.icone} className="h-4 w-4 shrink-0 text-rosa" />
        <span className="flex-1 text-sm font-semibold text-t1">{secao.titulo}</span>
        <Icone nome="chevron" className={`h-4 w-4 shrink-0 text-t3 transition-transform ${aberta ? '' : '-rotate-90'}`} />
      </button>

      {aberta && (
        <div className="border-t border-borda px-4 py-3">
          {temMetodo && (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-ambar/10 px-2.5 py-1.5 text-[11px] leading-snug text-ambar">
              <span aria-hidden>⚠︎</span>
              <span>Mexer aqui muda quais entradas o sistema aprova.</span>
            </div>
          )}
          <div className="space-y-4">
            {secao.campos.map((campo) => (
              <CampoCtrl key={campo.key} campo={campo} valor={getVal(campo)} onChange={(v) => setVal(campo, v)} />
            ))}
            {children}
          </div>
          {temPadrao && (
            <button
              onClick={onRestaurar}
              className="mt-4 inline-flex items-center gap-1.5 text-[11px] text-t3 hover:text-t2"
            >
              <Icone nome="restaurar" className="h-3.5 w-3.5" />
              restaurar padrão do método
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CampoCtrl({ campo, valor, onChange }: { campo: CampoDef; valor: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-t1">{campo.label}</span>
        {campo.ctrl !== 'reais' && (
          <span className="font-mono text-sm font-semibold text-rosa tabular-nums">{mostrar(campo, valor)}</span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-t3">{campo.sub}</div>
      <div className="mt-2">
        {campo.ctrl === 'slider' && (
          <input
            type="range" min={campo.min} max={campo.max} step={campo.step ?? 1} value={valor}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-fundo accent-rosa"
          />
        )}
        {campo.ctrl === 'stepper' && (
          <Stepper valor={valor} min={campo.min ?? 0} max={campo.max ?? 99} onChange={onChange} />
        )}
        {campo.ctrl === 'reais' && <ReaisInput valor={valor} onChange={onChange} />}
      </div>
    </div>
  );
}

function Stepper({ valor, min, max, onChange }: { valor: number; min: number; max: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className="inline-flex items-center gap-3">
      <button onClick={() => onChange(clamp(valor - 1))} disabled={valor <= min}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-borda text-lg text-t1 disabled:opacity-30">−</button>
      <span className="w-8 text-center font-mono text-lg font-semibold text-t1 tabular-nums">{valor}</span>
      <button onClick={() => onChange(clamp(valor + 1))} disabled={valor >= max}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-borda text-lg text-t1 disabled:opacity-30">+</button>
    </div>
  );
}

function ReaisInput({ valor, onChange }: { valor: number; onChange: (v: number) => void }) {
  // Máscara R$: teclado numérico iOS (inputMode decimal), vírgula tratada → ponto.
  const [txt, setTxt] = useState(String(valor));
  useEffect(() => { setTxt(String(valor)); }, [valor]);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-borda bg-fundo px-3 py-2 focus-within:border-azul">
      <span className="text-sm text-t3">R$</span>
      <input
        type="text" inputMode="decimal" value={txt}
        onChange={(e) => {
          setTxt(e.target.value);
          const n = Number(e.target.value.replace(',', '.'));
          if (Number.isFinite(n)) onChange(+n.toFixed(2));
        }}
        className="w-full bg-transparent font-mono text-lg font-semibold text-t1 outline-none tabular-nums"
      />
    </div>
  );
}

function LigasBloco({ c, setC }: { c: Config; setC: (c: Config) => void }) {
  return (
    <div className="border-t border-borda pt-4">
      <div className="mb-2 flex items-center gap-2">
        <Icone nome="list" className="h-4 w-4 text-rosa" />
        <span className="text-sm font-medium text-t1">Ligas cobertas</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {c.ligas.map((l, i) => (
          <button
            key={l.id}
            onClick={() => { const ligas = [...c.ligas]; ligas[i] = { ...l, ativa: !l.ativa }; setC({ ...c, ligas }); }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              l.ativa ? 'border-rosa/40 bg-rosa/5 text-t1' : 'border-borda bg-fundo text-t3'
            }`}
          >
            <span className={`flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${l.ativa ? 'bg-rosa' : 'bg-borda'}`}>
              <span className={`h-4 w-4 rounded-full bg-white transition-transform ${l.ativa ? 'translate-x-4' : ''}`} />
            </span>
            <span className="min-w-0 flex-1 truncate">{l.nome}</span>
            <span className="shrink-0 text-[10px] text-t3">{l.pais}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
