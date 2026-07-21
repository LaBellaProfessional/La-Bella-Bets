import { useState } from 'react';
import { supabase } from './supabase';

/** Login email/senha. Usuário único (o Maikon). Sessão fica persistida — o PWA reabre logado. */
export function Login() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true); setErro(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
    setCarregando(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-fundo px-4">
      <form onSubmit={entrar} className="w-full max-w-sm rounded-xl border border-borda bg-card p-6">
        <div className="mb-1 text-center text-2xl font-bold tracking-tight text-t1">
          BELLA<span className="text-rosa">BETS</span>
        </div>
        <p className="mb-6 text-center text-xs text-t3">Análise pré-jogo com método</p>

        <label className="mb-3 block">
          <span className="text-xs text-t2">E-mail</span>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            autoComplete="email" inputMode="email"
            className="mt-1 w-full rounded border border-borda bg-fundo px-3 py-2 text-sm text-t1 outline-none focus:border-azul"
          />
        </label>
        <label className="mb-5 block">
          <span className="text-xs text-t2">Senha</span>
          <input
            type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required
            autoComplete="current-password"
            className="mt-1 w-full rounded border border-borda bg-fundo px-3 py-2 text-sm text-t1 outline-none focus:border-azul"
          />
        </label>

        {erro && <div className="mb-3 rounded border border-vermelho/40 bg-vermelho/10 px-3 py-2 text-xs text-vermelho">{erro}</div>}

        <button
          type="submit" disabled={carregando}
          className="w-full rounded bg-rosa py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {carregando ? 'entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
