import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const DIR_DADOS = path.resolve(__dirname, 'data');

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

export default defineConfig({ plugins: [react(), apiDados()] });
