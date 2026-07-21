import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Erro DEPOIS que o app montou é o caso que a guarda de boot não sabe tratar — e não deve
 * mesmo: quando o React quebra num render, ele DESMONTA a árvore inteira e o #root fica
 * vazio. Pra uma heurística de DOM isso é indistinguível de "nunca montou", e foi assim que
 * a guarda passou a recarregar em loop um app que estava funcionando.
 *
 * Aqui a responsabilidade fica no lugar certo: o boundary segura o erro, mostra o que
 * aconteceu e deixa o app respirar. A guarda cuida só do que acontece ANTES do mount.
 */
interface Estado { erro: Error | null; info: string | null }

export class ErroBoundary extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { erro: null, info: null };

  static getDerivedStateFromError(erro: Error): Partial<Estado> {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    // Fica no console pra investigação, mas o usuário vê a mensagem tratada abaixo.
    console.error('[bella-bets] erro de render:', erro, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  render() {
    if (!this.state.erro) return this.props.children;

    return (
      <div className="flex min-h-screen items-start justify-center bg-fundo px-4 py-16">
        <div className="w-full max-w-lg rounded-xl border border-vermelho/40 bg-card p-6">
          <h1 className="text-lg font-semibold text-t1">Algo quebrou na tela</h1>
          <p className="mt-2 text-sm text-t2">
            O app carregou, mas encontrou um erro ao montar esta parte. Os dados estão salvos —
            isso é falha de exibição, não de análise.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded bg-fundo p-3 text-[11px] leading-relaxed text-vermelho">
            {this.state.erro.message}
          </pre>
          {this.state.info && (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-fundo p-3 text-[10px] text-t3">
              {this.state.info.trim().split('\n').slice(0, 6).join('\n')}
            </pre>
          )}
          <div className="mt-5 flex gap-2">
            <button
              onClick={() => this.setState({ erro: null, info: null })}
              className="rounded border border-borda px-4 py-2 text-sm text-t2"
            >
              Tentar renderizar de novo
            </button>
            <button
              onClick={() => location.reload()}
              className="rounded bg-rosa px-4 py-2 text-sm font-semibold text-white"
            >
              Recarregar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
