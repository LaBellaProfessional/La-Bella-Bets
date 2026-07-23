import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, invocar } from './supabase';

export const ROTULO: Record<string, string> = {
  dupla_chance_casa: 'DC casa (1X)',
  dupla_chance_fora: 'DC fora (X2)',
  resultado_casa: 'Vitória casa (1)',
  resultado_fora: 'Vitória fora (2)',
  ah_casa_m05: 'AH casa -0.5',
  ah_casa_m10: 'AH casa -1.0',
  ah_fora_p05: 'AH fora +0.5',
};

/**
 * Mercados de LINHA são gerados, não tabelados: a casa publica a linha que quiser
 * (over 1.5, 2.5, escanteios 9.5…) e o dash tem que saber escrever qualquer uma.
 * Chave: `<lado>_<ponto sem o ponto>`, com prefixo `esc_` pra escanteios.
 */
export function rotuloMercado(mercado: string): string {
  if (ROTULO[mercado]) return ROTULO[mercado];
  const m = /^(esc_)?(over|under)_(\d+)$/.exec(mercado ?? '');
  if (!m) return mercado;
  const d = m[3];
  const linha = Number(d.slice(0, -1) || '0') + Number(d.slice(-1)) / 10;
  return `${m[2] === 'over' ? 'Over' : 'Under'} ${linha.toFixed(1)}${m[1] ? ' esc.' : ''}`;
}

/**
 * NOME DO MERCADO EM LINGUAGEM HUMANA (A Grande Simplificação) — primeira camada da tela.
 * Nada de "DC casa (1X)" nem "Over 2.5": "Não perder em casa (1X)", "Mais de 2 gols e meio".
 * O `rotuloMercado` técnico continua existindo pro que grava/histórico; isto é só a CASCA.
 */
export function mercadoHumano(mercado: string): string {
  const fixos: Record<string, string> = {
    dupla_chance_casa: 'Não perder em casa (1X)',
    dupla_chance_fora: 'Não perder fora (X2)',
    resultado_casa: 'Vitória da casa (1)',
    resultado_fora: 'Vitória do visitante (2)',
    ah_casa_m05: 'Casa vence (handicap −0,5)',
    ah_casa_m10: 'Casa vence por 2+ (handicap −1)',
    ah_fora_p05: 'Visitante não perde (handicap +0,5)',
  };
  if (fixos[mercado]) return fixos[mercado];
  const m = /^(esc_)?(over|under)_(\d+)$/.exec(mercado ?? '');
  if (!m) return rotuloMercado(mercado);
  const d = m[3];
  const linha = Number(d.slice(0, -1) || '0') + Number(d.slice(-1)) / 10;
  const inteiro = Math.floor(linha);
  const nomeLinha = linha < 1 ? 'meio' : `${inteiro} e meio`;
  const coisa = m[1] ? (linha < 2 ? 'escanteio' : 'escanteios') : (linha < 2 ? 'gol' : 'gols');
  return `${m[2] === 'over' ? 'Mais de' : 'Menos de'} ${nomeLinha} ${coisa}`;
}

/** Nota em PALAVRA + cor: FORTE (verde, 80+) · BOA (azul, 60-79) · EXPLORAR (cinza, <60). */
export function notaPalavra(nota: number | null | undefined): {
  palavra: string; texto: string; borda: string; fundo: string;
} {
  const n = nota ?? 0;
  if (n >= 80) return { palavra: 'FORTE', texto: 'text-verde', borda: 'border-verde', fundo: 'bg-verde/15' };
  if (n >= 60) return { palavra: 'BOA', texto: 'text-azul', borda: 'border-azul', fundo: 'bg-azul/15' };
  return { palavra: 'EXPLORAR', texto: 'text-t3', borda: 'border-borda', fundo: 'bg-fundo' };
}

export type Familia = 'resultado' | 'gols' | 'escanteios';

export function familiaDoMercado(mercado: string): Familia {
  if (String(mercado).startsWith('esc_')) return 'escanteios';
  if (/^(over|under)_\d+$/.test(String(mercado))) return 'gols';
  return 'resultado';
}

export const NOME_FAMILIA: Record<Familia, string> = {
  resultado: 'Resultado', gols: 'Gols', escanteios: 'Escanteios',
};

export interface Perna {
  horizonte_dias?: number;
  radar?: boolean;
  motivo_radar?: string;
  trajetoria?: { primeira_odd: number; melhor_odd: number; odd_atual: number | null; observacoes: number; idade_horas: number; movimento: number | null };
  jogo_id: string; partida: string; liga: string; hora: string;
  mercado: string; odd: number | null;
  prob_heuristica: number | null; prob_dixon_coles: number | null; prob_final?: number;
  ev?: number; ev_pct?: number; amostra_mando: number;
  aprovada: boolean; motivo?: string; confianca?: string;
  amostra_curta?: boolean; badge_amostra?: string | null; casa_odd?: string | null;
  justificativa?: string; elegivel_bilhete?: boolean; dixon_coles_disponivel?: boolean;
  // Escanteios: a API não publica preço, então a perna nasce sem odd e com a odd JUSTA
  // calculada pelo modelo. É o número contra o qual a odd digitada é comparada.
  sem_odd_referencia?: boolean; odd_justa?: number; lambda_escanteios?: number | null;
  // AGUARDA ODD (Parte C): prêmio improvável (justa < piso) no modo sem-odd. Não reprova mais —
  // entra aprovada, mas o dash a recolhe numa seção discreta abaixo dos aprovados, campo de odd
  // ativo, veredito normal ao digitar. Só organiza a tela, nunca bloqueia o registro.
  aguarda_odd?: boolean;
  // Proveniência da entrada, quando registrada fora do fluxo do método (Parte B / ressurreição).
  origem?: 'metodo' | 'maikon_faro' | 'analistas';
  stake_pct?: number; stake_rs?: number;
  nota?: number; nota_componentes?: NotaComponentes | null;
  // CAMADA DE ANALISTAS (Parte A): nota antes do ajuste + o ajuste decomposto ("Nota 74 = modelo
  // 70, analistas +4"). ressuscitada = voltou dos mortos pelo consenso; trava_analistas = fato
  // consensual contrariou uma aprovada e travou a stake no piso.
  nota_base?: number; analistas_ajuste?: number; analistas_componentes?: AjusteAnalistas | null;
  analistas_teto_solida?: boolean;
  ressuscitada?: boolean; motivo_ressurreicao?: string;
  trava_analistas?: string;
  sem_linha?: boolean;   // jogo sem linha da API (modo odd manual) — agrupa em seção própria
}

export interface NotaComponentes {
  concordancia: number; ev: number; amostra: number; maturidade: number; horizonte: number;
  divergencia_pp: number | null;
}

/* ─────────────────────── CAMADA DE ANALISTAS (Parte A) ─────────────────────── */

export type TipoExtracao = 'fato' | 'opiniao' | 'dado_citado';
export interface ExtracaoResumo {
  analista: string; tipo: TipoExtracao; categoria: string; texto: string;
  mercado: string | null; direcao: 'a_favor' | 'contra' | 'neutro' | null;
  conviccao: 'baixa' | 'media' | 'alta' | null; data: string | null; manual?: boolean;
}
export interface ContextoAnalistas {
  fatos: ExtracaoResumo[]; dados_citados: ExtracaoResumo[]; opinioes: ExtracaoResumo[];
  consenso_laranja: { categoria: string; n_analistas: number; textos: string[] } | null;
}
export interface AjusteAnalistas {
  a_favor: number; contra: number; consenso: boolean;
  soma_favor: number; soma_contra: number; ajuste_pos: number; ajuste_neg: number;
  opinioes: { analista_id: string; direcao: string; conviccao: string; texto: string }[];
}
export interface Analista {
  id: string; nome: string; canal_youtube: string; url: string; ativo: boolean;
  peso_atual: number; observacao: string | null;
}
export interface AnalistaPlacar {
  id: string; nome: string; canal_youtube: string; ativo: boolean; peso_atual: number;
  n_liquidados: number; n_ganhou: number; n_pendentes: number;
  acerto: number | null; lucro_virtual: number; n_com_odd: number;
}

/** Faixa/cor da nota: 80+ verde (sólida) · 60-79 azul (média) · <60 cinza (fraca). */
export function faixaNota(nota: number): { label: string; texto: string; borda: string; fundo: string } {
  if (nota >= 80) return { label: 'sólida', texto: 'text-verde', borda: 'border-verde', fundo: 'bg-verde/15' };
  if (nota >= 60) return { label: 'média', texto: 'text-azul', borda: 'border-azul', fundo: 'bg-azul/15' };
  return { label: 'fraca', texto: 'text-t3', borda: 'border-borda', fundo: 'bg-fundo' };
}

/** Componentes da nota em linguagem de apostador, pro detalhamento ao tocar. */
export function explicarNota(c: NotaComponentes, escanteio: boolean): { rotulo: string; valor: string }[] {
  return [
    {
      rotulo: c.divergencia_pp == null ? 'sem 2º modelo conferindo'
        : c.concordancia >= 24 ? 'modelos concordam'
        : c.concordancia >= 12 ? 'modelos concordam em parte'
        : 'modelos divergem',
      valor: `${Math.round(c.concordancia)}/30${c.divergencia_pp != null ? ` · ${c.divergencia_pp.toFixed(1)} p.p.` : ''}`,
    },
    {
      rotulo: escanteio ? 'convicção do modelo'
        : c.ev >= 22 ? 'valor na faixa saudável'
        : c.ev >= 12 ? 'valor moderado'
        : 'valor fraco ou implausível',
      valor: `${Math.round(c.ev)}/${escanteio ? 15 : 25}`,
    },
    { rotulo: c.amostra >= 20 ? 'amostra cheia no mando' : 'amostra curta no mando', valor: `${Math.round(c.amostra)}/20` },
    { rotulo: escanteio ? 'escanteios (modelo novo)' : 'família madura', valor: `${Math.round(c.maturidade)}/15` },
    { rotulo: c.horizonte >= 10 ? 'jogo é hoje' : 'faltam dias pro jogo', valor: `${Math.round(c.horizonte)}/10` },
  ];
}

export interface Bilhete {
  ordem: number; pernas: Perna[]; n_pernas: number; odd_total: number;
  prob_combinada: number; valor_justo: number; ev: number; ev_pct: number;
  n_confianca_maxima: number; todas_confianca_maxima: boolean;
  correlacao_intra_jogo: boolean; stake_pct: number; stake_rs: number;
}

export interface Analise {
  data: string; modo: 'demo' | 'real'; gerado_em: string; banca_no_momento: number;
  resumo: { jogos: number; pernas_avaliadas: number; aprovadas: number; descartadas: number; bilhetes: number; sem_bilhete: boolean };
  dixon_coles_por_liga: Record<string, { disponivel: boolean; motivo: string | null; n_jogos: number }>;
  jogos: { id: string; liga: string; hora: string; casa: string; fora: string; sem_linha?: boolean; contagens?: unknown }[];
  pernas: Perna[]; bilhetes: Bilhete[];
  sem_bilhete: { motivo: string } | null;
  exposicao: { total_rs: number; pct_banca: number; teto_pct: number; teto_rs?: number } | null;
  config_efetivo?: { filtros: Record<string, number> };
  radar?: (Perna & { motivo_radar?: string; horizonte_dias?: number })[];
  horizonte_dias?: number;
  cards_handicap: (Perna & { vantagem_pp: number; stake_rs: number; observacao: string })[];
  avisos?: string[];
  // CAMADA DE ANALISTAS: contexto por jogo (chave = partida "Casa x Fora") e ressuscitadas do dia.
  analistas_por_jogo?: Record<string, ContextoAnalistas>;
  analistas_ressuscitadas?: { partida: string; mercado: string; n_fontes: number }[];
}

/** Foto do que o MÉTODO dizia quando o Maikon apostou por faro — pra medir o faro CONTRA o método. */
export interface SnapshotMetodo {
  veredito: 'aprovada' | 'radar' | 'reprovada' | 'aguarda_odd' | 'sem_modelo';
  motivo: string | null;
  horizonte_dias: number;
  odd_justa: number | null;
  prob_modelo: number | null;
  nota: number | null;
}

export interface Registro {
  id: string; data: string; registrado_em: string;
  pernas: { partida: string; mercado: string; rotulo?: string; odd: number | null; hora?: string | null; snapshot?: SnapshotMetodo }[];
  odd_total: number; odd_referencia?: number | null; casa_odd?: string | null; prob_combinada: number; ev_pct: number;
  stake_real: number; resultado: 'pendente' | 'ganhou' | 'perdeu' | 'cancelada';
  retorno_rs: number; banca_depois: number | null; resolvido_em?: string | null;
  // Proveniência (Parte B): 'metodo' (default, fluxo normal) · 'maikon_faro' · 'analistas'.
  origem?: 'metodo' | 'maikon_faro' | 'analistas';
  // Tipo (Parte 1): 'simples' (default) · 'multipla_propria' (bilhete montado, odd total manual).
  tipo?: 'simples' | 'multipla_propria';
  snapshot_metodo?: (SnapshotMetodo & { pernas?: unknown[] }) | null;
  n_pernas?: number;
}

/**
 * Identidade de uma entrada: dia + conjunto de (partida, mercado) ordenado. É o mesmo critério
 * que a Início usa pra saber o que já foi registrado — e a chave do rascunho persistente.
 * Odd é valor variável; partida+mercado é o que identifica a aposta (lição do bug de 21/07).
 */
export const chaveEntrada = (data: string, pernas: { partida: string; mercado: string }[]) =>
  `${data}|${pernas.map((p) => `${p.partida}·${p.mercado}`).sort().join('+')}`;

/** Primeiro horário da aposta (menor hora entre as pernas), pra ordenar pendentes. */
export function horaDaAposta(r: Registro): string {
  return r.pernas.map((p) => p.hora ?? '').filter(Boolean).sort()[0] ?? '';
}

/** "Em jogo": soma dos stakes das apostas ainda não resolvidas (derivado, sem estado novo). */
export function emJogoDe(registros: Registro[]): number {
  return +registros.filter((r) => r.resultado === 'pendente').reduce((s, r) => s + r.stake_real, 0).toFixed(2);
}

/** Saldo resolvido (ganhou/perdeu) na semana corrente (segunda→domingo, horário de SP). */
export function saldoDaSemana(registros: Registro[]): number {
  const agoraSP = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const diaSemana = (agoraSP.getDay() + 6) % 7; // 0 = segunda
  const inicio = new Date(agoraSP); inicio.setHours(0, 0, 0, 0); inicio.setDate(agoraSP.getDate() - diaSemana);
  let saldo = 0;
  for (const r of registros) {
    if (r.resultado !== 'ganhou' && r.resultado !== 'perdeu') continue;
    if (new Date(r.resolvido_em ?? r.registrado_em) < inicio) continue;
    saldo += r.resultado === 'ganhou' ? r.retorno_rs - r.stake_real : -r.stake_real;
  }
  return +saldo.toFixed(2);
}

export type EstadoAposta = 'pendente' | 'aguardando' | 'ganhou' | 'perdeu' | 'cancelada';

export interface SugLiquidada { status: string; gols_casa: number | null; gols_fora: number | null }

/**
 * Estado operacional da aposta na aba Apostas. Para as PENDENTES, consulta a liquidação
 * virtual (sugestoes_liquidadas, casada por data+partida+mercado): se todo jogo da aposta já
 * encerrou, vira 'aguardando' com uma PRÉ-SUGESTÃO ("Terminou 2x1 — indica GANHOU"). Enquanto
 * qualquer perna não tiver placar, continua 'pendente'. A confirmação (que move a banca)
 * continua manual — a pré-sugestão só adianta o dedo.
 */
export interface LegDetalhe { partida: string; mercado: string; rotulo: string; resultado: 'ganhou' | 'perdeu' | 'pendente' }

export function classificarAposta(
  b: Registro,
  sug: Map<string, SugLiquidada>,
): { estado: EstadoAposta; pre?: { resultado: 'ganhou' | 'perdeu'; placar: string }; legs?: LegDetalhe[]; bateram?: number } {
  // Detalhe perna a perna (Parte 1.3): pra CADA perna, o que a liquidação virtual sabe. Uma perna
  // de mercado que o método não cobre (faro reprovado) pode não estar no índice → fica 'pendente'.
  const casadas = b.pernas.map((p) => sug.get(`${b.data}|${p.partida}|${p.mercado}`));
  const legs: LegDetalhe[] = b.pernas.map((p, i) => ({
    partida: p.partida, mercado: p.mercado, rotulo: p.rotulo ?? rotuloMercado(p.mercado),
    resultado: casadas[i] && casadas[i]!.status !== 'pendente' ? (casadas[i]!.status as 'ganhou' | 'perdeu') : 'pendente',
  }));
  const bateram = legs.filter((l) => l.resultado === 'ganhou').length;

  if (b.resultado !== 'pendente') return { estado: b.resultado, legs, bateram };
  if (casadas.some((m) => !m || m.status === 'pendente')) return { estado: 'pendente', legs, bateram };
  // Bilhete só GANHA se TODAS as pernas ganharem (Parte 1.3).
  const resultado: 'ganhou' | 'perdeu' = casadas.every((m) => m!.status === 'ganhou') ? 'ganhou' : 'perdeu';
  // Placar por jogo (uma aposta pode cruzar dois jogos): "2x1" simples, "Casa 2x1 · Outro 0x0".
  const porJogo = new Map<string, SugLiquidada>();
  b.pernas.forEach((p, i) => { if (casadas[i] && !porJogo.has(p.partida)) porJogo.set(p.partida, casadas[i]!); });
  const jogos = [...porJogo.entries()];
  const placar = jogos.length === 1
    ? `${jogos[0][1].gols_casa}x${jogos[0][1].gols_fora}`
    : jogos.map(([part, m]) => `${part.split(' x ')[0]} ${m.gols_casa}x${m.gols_fora}`).join(' · ');
  return { estado: 'aguardando', pre: { resultado, placar }, legs, bateram };
}

export interface Config {
  banca: number;
  id: number; stake_padrao_pct: number; stake_confianca_maxima_pct: number;
  teto_exposicao_diaria_pct: number;
  filtros: Record<string, number>;
  ligas: { id: number; nome: string; pais: string; ativa: boolean }[];
}

/* ─────────────────────────── QUERIES ─────────────────────────── */

export function useConfig() {
  return useQuery<Config>({
    queryKey: ['config'],
    queryFn: async () => {
      const { data, error } = await supabase.from('config').select('*').eq('id', 1).single();
      if (error) throw error;
      return data as Config;
    },
  });
}

/** Datas com análise, mais recente primeiro. */
export function useDatas() {
  return useQuery<string[]>({
    queryKey: ['datas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('analises').select('data').order('data', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((d) => d.data as string);
    },
  });
}

export function useAnalise(data: string | null) {
  return useQuery<Analise | null>({
    queryKey: ['analise', data],
    enabled: Boolean(data),
    queryFn: async () => {
      const { data: row, error } = await supabase.from('analises').select('payload,resumo').eq('data', data).maybeSingle();
      if (error) throw error;
      if (!row?.payload) return null;
      // Blindagem: analises gravadas antes do fix nao tinham 'resumo' dentro do payload —
      // so na coluna. Costurar aqui evita depender de todo payload historico estar perfeito.
      const p = row.payload as Analise;
      return { ...p, resumo: p.resumo ?? (row.resumo as Analise['resumo']) } as Analise;
    },
  });
}

export function useBilhetes() {
  return useQuery<Registro[]>({
    queryKey: ['bilhetes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bilhetes').select('*').order('registrado_em', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Registro[];
    },
  });
}

/* ─────────────────────────── MUTATIONS ─────────────────────────── */

export function useRegistrarBilhete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bilhete, data, valor }: { bilhete: Bilhete; data: string; valor: number }) => {
      const { error } = await supabase.from('bilhetes').insert({
        data,
        // `rotulo` é gravado JUNTO da chave: o Histórico não pode depender de a função de
        // rótulo nunca mudar pra dizer o que foi apostado. A aposta guarda o próprio nome.
        pernas: bilhete.pernas.map((p) => ({ partida: p.partida, mercado: p.mercado, rotulo: rotuloMercado(p.mercado), odd: p.odd })),
        n_pernas: bilhete.n_pernas,
        odd_total: bilhete.odd_total,
        prob_combinada: bilhete.prob_combinada,
        ev_pct: bilhete.ev_pct,
        stake_sugerido: bilhete.stake_rs,
        stake_real: valor,
        // Segmentação pro breakdown — gravada no registro, não reprocessada depois.
        ligas: [...new Set(bilhete.pernas.map((p) => p.liga))],
        mercados: [...new Set(bilhete.pernas.map((p) => p.mercado))],
        faixa_odd: bilhete.odd_total < 1.5 ? '1.40-1.50' : bilhete.odd_total < 1.6 ? '1.50-1.60' : '1.60+',
        confianca: bilhete.todas_confianca_maxima ? 'maxima' : 'aprovada',
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bilhetes'] }),
  });
}

/**
 * Altera o resultado de uma aposta em QUALQUER estado e ajusta a banca de forma reversível.
 *
 * A banca é um número corrente único (config.banca). Para permitir "corrigir resultado" sem
 * duplicar efeito, o cálculo é sempre DELTA_NOVO − DELTA_ANTERIOR:
 *   · ganhou  → +stake·(odd−1)   (lucro líquido)
 *   · perdeu  → −stake
 *   · pendente/cancelada → 0     (não mexe em dinheiro)
 * Assim ganhou→perdeu, perdeu→cancelada, etc. sempre reconstroem a banca certa.
 * "Não apostei"/"desfazer" gravam 'cancelada' (a linha fica pra auditoria, não é deletada).
 * Toda transição é registrada em bilhete_eventos com timestamp (best-effort).
 */
export function useAlterarResultado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ registro, novo, banca, detalhe }: { registro: Registro; novo: 'ganhou' | 'perdeu' | 'cancelada'; banca: number; detalhe?: string }) => {
      const deltaDe = (res: string, retorno: number, stake: number) =>
        res === 'ganhou' ? retorno - stake : res === 'perdeu' ? -stake : 0;

      const deltaAnterior = deltaDe(registro.resultado, registro.retorno_rs, registro.stake_real);
      const retornoNovo = novo === 'ganhou' ? +(registro.stake_real * registro.odd_total).toFixed(2) : 0;
      const deltaNovo = deltaDe(novo, retornoNovo, registro.stake_real);
      const bancaDepois = +(banca - deltaAnterior + deltaNovo).toFixed(2);

      const { error } = await supabase.from('bilhetes').update({
        resultado: novo,
        retorno_rs: retornoNovo,
        // Cancelada não é um resultado resolvido: zera o carimbo de banca/resolução.
        banca_depois: novo === 'cancelada' ? null : bancaDepois,
        resolvido_em: novo === 'cancelada' ? null : new Date().toISOString(),
      }).eq('id', registro.id);
      if (error) throw error;

      // A banca só muda quando o delta muda de fato.
      if (deltaNovo !== deltaAnterior) {
        const { error: e2 } = await supabase.from('config').update({ banca: bancaDepois }).eq('id', 1);
        if (e2) throw e2;
      }

      // Auditoria — acessório, não pode derrubar a operação principal.
      try {
        await supabase.from('bilhete_eventos').insert({ bilhete_id: registro.id, de: registro.resultado, para: novo, detalhe: detalhe ?? null });
      } catch { /* rastro é best-effort */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bilhetes'] });
      qc.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

/**
 * CONCILIAÇÃO COM A CASA (Parte 2). O saldo da bet365 é autoritativo. Casa a banca consolidada ao
 * saldo real: como o saldo da casa é o DISPONÍVEL (dinheiro fora de aposta aberta), a banca nova =
 * saldo da casa + o que está em jogo. Registra o ajuste em bilhete_eventos (tipo='ajuste_banca',
 * de/para em R$, detalhe com o saldo informado e o em-jogo). Auditado, reversível pela leitura.
 */
export function useConciliarBanca() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: { bancaAtual: number; emJogo: number; saldoCasa: number }) => {
      const novaBanca = +(e.saldoCasa + e.emJogo).toFixed(2);
      const { error } = await supabase.from('config').update({ banca: novaBanca, atualizado_em: new Date().toISOString() }).eq('id', 1);
      if (error) throw error;
      // Rastro do ajuste — best-effort (precisa da migração de conciliação pra ter tipo/bilhete_id null).
      try {
        await supabase.from('bilhete_eventos').insert({
          bilhete_id: null, tipo: 'ajuste_banca',
          de: String(e.bancaAtual.toFixed(2)), para: String(novaBanca.toFixed(2)),
          detalhe: JSON.stringify({ saldo_casa: e.saldoCasa, em_jogo: e.emJogo, antes: e.bancaAtual, depois: novaBanca }),
        });
      } catch { /* rastro é acessório */ }
      return novaBanca;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });
}

/* ─────────────────────────── RASCUNHO PERSISTENTE ─────────────────────────── */

export interface Rascunho {
  chave: string; data: string; partida: string | null; mercado: string | null;
  odd_casa: number | null; stake: number | null; atualizado_em: string;
}

/**
 * Rascunhos dos campos da Início. Best-effort: se a tabela ainda não existir (migração não
 * aplicada), devolve mapa vazio em vez de derrubar a tela. Ignora rascunhos com mais de 48h
 * mesmo antes do cron de limpeza rodar.
 */
export function useRascunhos() {
  return useQuery<Map<string, Rascunho>>({
    queryKey: ['rascunhos'],
    queryFn: async () => {
      const corte = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const { data, error } = await supabase.from('rascunhos').select('*').gte('atualizado_em', corte);
      if (error) return new Map();
      return new Map((data ?? []).map((r) => [r.chave as string, r as Rascunho]));
    },
  });
}

export function useSalvarRascunho() {
  // Fire-and-forget: não invalida (evita re-render a cada tecla). O rascunho só é lido no mount.
  // odd_casa chega já normalizado (número ou null) — a coluna é numeric, texto livre não entra.
  return useMutation({
    mutationFn: async (r: { chave: string; data: string; partida: string | null; mercado: string | null; odd_casa: number | null; stake: number | null }) => {
      await supabase.from('rascunhos').upsert({ ...r, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
    },
  });
}

export function useSalvarConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cfg: Config) => {
      const { error } = await supabase.from('config').update({
        banca: cfg.banca, stake_padrao_pct: cfg.stake_padrao_pct,
        stake_confianca_maxima_pct: cfg.stake_confianca_maxima_pct,
        teto_exposicao_diaria_pct: cfg.teto_exposicao_diaria_pct,
        filtros: cfg.filtros, ligas: cfg.ligas, atualizado_em: new Date().toISOString(),
      }).eq('id', 1);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['config'] }),
  });
}

export function useRodarMotor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ funcao, corpo }: { funcao: 'analisar' | 'bootstrap'; corpo?: Record<string, unknown> }) =>
      invocar(funcao, corpo ?? {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['datas'] });
      qc.invalidateQueries({ queryKey: ['analise'] });
    },
  });
}

/**
 * Veredito do MÉTODO pra uma perna, do ponto de vista da aposta do faro (Parte B): é o que o
 * snapshot guarda e o que a linha "o método diria: X" mostra. Aprovada, no radar, recolhida
 * (aguarda odd), reprovada ou sem modelo — com o motivo exato quando houver.
 */
export function snapshotDaPerna(p: Perna): SnapshotMetodo {
  const veredito: SnapshotMetodo['veredito'] =
    p.prob_final == null && p.prob_heuristica == null ? 'sem_modelo'
      : p.aguarda_odd ? 'aguarda_odd'
      : p.radar ? 'radar'
      : p.aprovada ? 'aprovada'
      : 'reprovada';
  const oddJusta = p.odd_justa ?? (p.prob_final ? +(1 / p.prob_final).toFixed(2) : null);
  return {
    veredito,
    motivo: p.motivo ?? p.motivo_radar ?? null,
    horizonte_dias: p.horizonte_dias ?? 0,
    odd_justa: oddJusta,
    prob_modelo: p.prob_final ?? p.prob_heuristica ?? null,
    nota: p.nota ?? null,
  };
}

/** Frase de uma linha "o método diria: X" — sem paternalismo, só o contexto do que o faro contraria. */
export function metodoDiria(s: SnapshotMetodo): string {
  switch (s.veredito) {
    case 'aprovada': return 'o método aprovou esta entrada';
    case 'radar': return `o método segurou no radar${s.motivo ? ` — ${s.motivo}` : ''}`;
    case 'aguarda_odd': return `o método recolheu (prêmio improvável${s.odd_justa ? `, justo @${s.odd_justa.toFixed(2)}` : ''})`;
    case 'sem_modelo': return 'o método não tem modelo pra este mercado';
    default: return `o método reprovou${s.motivo ? ` — ${s.motivo}` : ''}`;
  }
}

/**
 * APOSTA DO MAIKON (FARO) — Parte B. Registra QUALQUER mercado avaliado por convicção própria,
 * mesmo o que o método não aprovou. Grava origem='maikon_faro' + o snapshot do que o método diria,
 * pra saber CONTRA O QUÊ o faro acertou. Sem gate de veredito — a única obrigação é a odd da casa.
 * odd_referencia = a odd que o modelo viu (linha da API ou justa), pra o CLV do faro depois.
 */
export function useApostarFaro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: {
      data: string; perna: Perna; odd_real: number; stake: number;
      casa_odd: string | null; snapshot: SnapshotMetodo;
    }) => {
      const p = e.perna;
      const oddRef = p.odd ?? p.odd_justa ?? e.snapshot.odd_justa ?? null;
      const prob = p.prob_final ?? e.snapshot.prob_modelo ?? 0;
      const { error } = await supabase.from('bilhetes').insert({
        data: e.data,
        pernas: [{ partida: p.partida, mercado: p.mercado, rotulo: rotuloMercado(p.mercado), odd: e.odd_real, hora: p.hora ?? null }],
        n_pernas: 1,
        odd_total: e.odd_real,
        odd_referencia: oddRef,
        casa_odd: e.casa_odd,
        prob_combinada: prob,
        ev_pct: (prob * e.odd_real - 1) * 100,
        stake_sugerido: e.stake,
        stake_real: e.stake,
        ligas: [p.liga],
        mercados: [p.mercado],
        faixa_odd: e.odd_real < 1.5 ? '1.40-1.50' : e.odd_real < 1.6 ? '1.50-1.60' : '1.60+',
        confianca: 'faro',
        origem: 'maikon_faro',
        snapshot_metodo: e.snapshot,
      });
      if (error) throw error;
      // Se havia rascunho dessa entrada, cumpriu o papel.
      try { await supabase.from('rascunhos').delete().eq('chave', chaveEntrada(e.data, [p])); } catch { /* ignora */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bilhetes'] });
      qc.invalidateQueries({ queryKey: ['rascunhos'] });
    },
  });
}

/**
 * MÚLTIPLA PRÓPRIA DO MAIKON (Parte 1) — bilhete montado à mão com QUALQUER combinação de pernas
 * (qualquer estado, qualquer jogo, inclusive do mesmo jogo). A odd TOTAL é DIGITADA, nunca
 * multiplicada: ganhos aumentados e correlação intra-jogo tornam o produto das pernas errado.
 * Grava origem='maikon_faro', tipo (simples/multipla_propria) e o snapshot do método de CADA perna.
 * `data` pode ser retroativa (bilhete já feito na casa) — o registro aceita.
 */
export function useMontarBilheteFaro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: { data: string; pernas: Perna[]; odd_total: number; stake: number; casa_odd: string | null }) => {
      const tipo = e.pernas.length > 1 ? 'multipla_propria' : 'simples';
      // prob combinada aproximada (produto — referência apenas; a odd real é a manual).
      const prob = e.pernas.reduce((acc, p) => acc * (p.prob_final ?? p.prob_heuristica ?? 1), 1);
      const snaps = e.pernas.map((p) => ({ partida: p.partida, mercado: p.mercado, ...snapshotDaPerna(p) }));
      const { error } = await supabase.from('bilhetes').insert({
        data: e.data,
        pernas: e.pernas.map((p) => ({
          partida: p.partida, mercado: p.mercado, rotulo: rotuloMercado(p.mercado),
          odd: p.odd ?? null, hora: p.hora ?? null, snapshot: snapshotDaPerna(p),
        })),
        n_pernas: e.pernas.length,
        odd_total: e.odd_total,           // MANUAL — não multiplica
        odd_referencia: null,
        casa_odd: e.casa_odd,
        prob_combinada: prob,
        ev_pct: (prob * e.odd_total - 1) * 100,
        stake_sugerido: e.stake,
        stake_real: e.stake,
        ligas: [...new Set(e.pernas.map((p) => p.liga))],
        mercados: [...new Set(e.pernas.map((p) => p.mercado))],
        faixa_odd: e.odd_total < 1.5 ? '1.40-1.50' : e.odd_total < 1.6 ? '1.50-1.60' : '1.60+',
        confianca: 'faro', origem: 'maikon_faro', tipo,
        snapshot_metodo: { tipo, pernas: snaps },
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bilhetes'] }),
  });
}

export const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
export const pct = (v: number | null | undefined, casas = 0) =>
  v == null ? '—' : `${(v * 100).toFixed(casas)}%`;

/* ─────────────────── PAPER TRADING (sugestões virtuais) ─────────────────── */

export interface SugestaoLiquidada {
  id: string; data: string; partida: string; liga: string;
  mercado: string; rotulo: string; familia: Familia; linha: number | null;
  odd_referencia: number; odd_e_mercado: boolean; prob_modelo: number;
  confianca: string; radar: boolean;
  status: 'pendente' | 'ganhou' | 'perdeu';
  gols_casa: number | null; gols_fora: number | null;
  nota: number | null; nota_componentes?: NotaComponentes | null;
}

/** Índice das sugestões liquidadas por data|partida|mercado — base da pré-sugestão da aba Apostas. */
export function indiceSugestoes(sugestoes: SugestaoLiquidada[] | undefined): Map<string, SugLiquidada> {
  const m = new Map<string, SugLiquidada>();
  for (const s of sugestoes ?? []) {
    m.set(`${s.data}|${s.partida}|${s.mercado}`, { status: s.status, gols_casa: s.gols_casa, gols_fora: s.gols_fora });
  }
  return m;
}

/** Sugestões liquidadas + pendentes. A agregação (calibração, ROI virtual) é feita na tela. */
export function useSugestoes() {
  return useQuery<SugestaoLiquidada[]>({
    queryKey: ['sugestoes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sugestoes_liquidadas')
        .select('id,data,partida,liga,mercado,rotulo,familia,linha,odd_referencia,odd_e_mercado,prob_modelo,confianca,radar,status,gols_casa,gols_fora,nota')
        .order('data', { ascending: false });
      if (error) throw error;
      return (data ?? []) as SugestaoLiquidada[];
    },
  });
}

/* ─────────────────────── CAMADA DE ANALISTAS — queries/mutations ─────────────────────── */

/** Placar por analista (view analista_placar). Vazio/erro devolve [] — a tela nunca cai por isso. */
export function useAnalistaPlacar() {
  return useQuery<AnalistaPlacar[]>({
    queryKey: ['analista-placar'],
    queryFn: async () => {
      const { data, error } = await supabase.from('analista_placar').select('*').order('peso_atual', { ascending: false });
      if (error) return [];
      return (data ?? []) as AnalistaPlacar[];
    },
  });
}

/** Lista de analistas cadastrados (Config). Best-effort: sem a tabela ainda, devolve []. */
export function useAnalistas() {
  return useQuery<Analista[]>({
    queryKey: ['analistas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('analistas').select('*').order('nome');
      if (error) return [];
      return (data ?? []) as Analista[];
    },
  });
}

/** Adiciona / ativa-desativa / remove canal. Uma mutation só, por ação — a tela decide qual. */
export function useAnalistaAcao() {
  const qc = useQueryClient();
  const inval = () => { qc.invalidateQueries({ queryKey: ['analistas'] }); qc.invalidateQueries({ queryKey: ['analista-placar'] }); };
  return {
    criar: useMutation({
      mutationFn: async (a: { nome: string; canal_youtube: string; url: string }) => {
        const canal = a.canal_youtube.trim().startsWith('@') ? a.canal_youtube.trim() : `@${a.canal_youtube.trim()}`;
        const { error } = await supabase.from('analistas').insert({
          nome: a.nome.trim(), canal_youtube: canal,
          url: a.url.trim() || `https://youtube.com/${canal}`,
        });
        if (error) throw error;
      },
      onSuccess: inval,
    }),
    alternar: useMutation({
      mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
        const { error } = await supabase.from('analistas').update({ ativo }).eq('id', id);
        if (error) throw error;
      },
      onSuccess: inval,
    }),
    remover: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await supabase.from('analistas').delete().eq('id', id);
        if (error) throw error;
      },
      onSuccess: inval,
    }),
  };
}

/** Analises dos proximos dias (D+1..D+3) — alimenta 'oportunidades antecipadas'. */
export function useJanela(dataBase: string | null) {
  return useQuery<Analise[]>({
    queryKey: ['janela', dataBase],
    enabled: Boolean(dataBase),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analises').select('payload')
        .gt('data', dataBase).order('data', { ascending: true }).limit(3);
      if (error) throw error;
      return (data ?? []).map((r) => r.payload as Analise);
    },
  });
}

/** Janela inteira a partir de hoje (SP): alimenta a aba Inicio, agrupada por dia. */
export function useJanelaCompleta(hoje: string) {
  return useQuery<Analise[]>({
    queryKey: ['janela-completa', hoje],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('analises').select('payload,resumo')
        .gte('data', hoje).order('data', { ascending: true }).limit(5);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const p = r.payload as Analise;
        return { ...p, resumo: p.resumo ?? (r.resumo as Analise['resumo']) };
      });
    },
  });
}

/** Registra a entrada com a odd REAL digitada; a odd do modelo fica como referencia (CLV). */
export function useRegistrarEntrada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (e: {
      data: string; pernas: Perna[]; odd_real: number; odd_referencia: number | null;
      prob: number; stake: number; casa_odd: string | null;
    }) => {
      const { error } = await supabase.from('bilhetes').insert({
        data: e.data,
        // `hora` vai junto no jsonb da perna: a aba Apostas ordena as pendentes por horário do
        // jogo, e o bilhete não tinha onde guardar isso sem uma coluna nova.
        pernas: e.pernas.map((p) => ({ partida: p.partida, mercado: p.mercado, rotulo: rotuloMercado(p.mercado), odd: p.odd, hora: p.hora ?? null })),
        n_pernas: e.pernas.length,
        odd_total: e.odd_real,             // a odd REAL da aposta
        odd_referencia: e.odd_referencia,  // a que o modelo viu — a diferenca e o CLV
        casa_odd: e.casa_odd,
        prob_combinada: e.prob,
        ev_pct: (e.prob * e.odd_real - 1) * 100,
        stake_sugerido: e.stake,
        stake_real: e.stake,
        ligas: [...new Set(e.pernas.map((p) => p.liga))],
        mercados: [...new Set(e.pernas.map((p) => p.mercado))],
        faixa_odd: e.odd_real < 1.5 ? '1.40-1.50' : e.odd_real < 1.6 ? '1.50-1.60' : '1.60+',
        confianca: e.pernas.every((p) => p.confianca === 'CONFIANCA_MAXIMA') ? 'maxima' : 'aprovada',
      });
      if (error) throw error;
      // Registrou → o rascunho cumpriu o papel e morre (best-effort).
      try { await supabase.from('rascunhos').delete().eq('chave', chaveEntrada(e.data, e.pernas)); } catch { /* ignora */ }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bilhetes'] });
      qc.invalidateQueries({ queryKey: ['rascunhos'] });
    },
  });
}
