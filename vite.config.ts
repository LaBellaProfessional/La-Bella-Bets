import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DIR_DADOS = path.resolve(__dirname, 'data');

// VERSÃO DO BUILD — hash curto do commit + data, injetada via `define`. É o que o rodapé do
// Config mostra pra "que versão você está vendo?" nunca mais ser adivinhação. Best-effort: sem
// git (ou build fora do repo), cai pra 'dev'.
const versaoBuild = (() => {
  try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); }
  catch { return 'dev'; }
})();
const dataBuild = new Date().toISOString().slice(0, 16).replace('T', ' ');

const ler = (arq: string, padrao: unknown) => {
  try { return JSON.parse(fs.readFileSync(path.join(DIR_DADOS, arq), 'utf8')); } catch { return padrao; }
};
const gravar = (arq: string, dados: unknown) => {
  fs.mkdirSync(path.dirname(path.join(DIR_DADOS, arq)), { recursive: true });
  fs.writeFileSync(path.join(DIR_DADOS, arq), JSON.stringify(dados, null, 2));
};
const corpo = (req: import('node:http').IncomingMessage) =>
  new Promise<string>((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });

/**
 * Ponte local com /data. O dash roda só em `npm run dev`, então em vez de espelhar tudo em
 * localStorage — que dessincronizaria do que o motor grava — o próprio dev server lê e escreve
 * os JSONs. Uma fonte da verdade só: a pasta /data.
 */
function apiDados(): Plugin {
  return {
    name: 'bella-bets-api-dados',
    configureServer(server) {
      server.middlewares.use('/api/dados', (_req, res) => {
        const dir = path.join(DIR_DADOS, 'analises');
        const datas = fs.existsSync(dir)
          ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort().reverse()
          : [];
        const analises = Object.fromEntries(datas.map((d) => [d, ler(`analises/${d}.json`, null)]));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ config: ler('config.json', {}), bilhetes: ler('bilhetes.json', []), datas, analises }));
      });

      server.middlewares.use('/api/bilhetes', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        gravar('bilhetes.json', JSON.parse(await corpo(req)));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      });

      server.middlewares.use('/api/config', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
        gravar('config.json', JSON.parse(await corpo(req)));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      });
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(versaoBuild),
    __APP_BUILT__: JSON.stringify(dataBuild),
  },
  plugins: [
    react(),
    apiDados(),
    // PWA com atualização CONTROLADA (fim do apagar-e-recriar-atalho). registerType 'prompt':
    // quando há service worker novo esperando, o app mostra um banner "Nova versão · Atualizar";
    // o clique faz skipWaiting + reload. A checagem ativa (foco, background, 60min) vive no
    // hook useRegisterSW em src/pwa.ts. `manifest: false` preserva o public/manifest.webmanifest
    // que já existe (com os ícones da marca); `injectRegister: null` porque registramos à mão.
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // SPA: navegações caem no index.html precacheado; a troca de versão é atômica no update.
        navigateFallback: '/index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
});
