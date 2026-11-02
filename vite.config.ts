import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function modelCachePlugin(): Plugin {
  // In-memory process cache: persists across browser refreshes, wiped when dev server terminates
  let inMemoryCache: Record<string, any> | null = null;

  return {
    name: 'bim-model-cache',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ? req.url.split('?')[0] : '';
        if (url !== '/api/model-cache') {
          return next();
        }

        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          if (!inMemoryCache) {
            res.statusCode = 200;
            res.end(JSON.stringify({ cached: false }));
            return;
          }
          res.statusCode = 200;
          res.end(JSON.stringify({ cached: true, data: inMemoryCache }));
          return;
        }

        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          req.on('end', () => {
            try {
              const bodyStr = Buffer.concat(chunks).toString('utf-8');
              const incoming = JSON.parse(bodyStr);
              if (incoming && incoming.clear) {
                inMemoryCache = null;
              } else if (incoming) {
                inMemoryCache = inMemoryCache ? { ...inMemoryCache, ...incoming } : incoming;
              }
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
            } catch (err: any) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: false, error: err?.message || 'Invalid JSON' }));
            }
          });
          return;
        }

        if (req.method === 'DELETE') {
          inMemoryCache = null;
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, cleared: true }));
          return;
        }

        res.statusCode = 405;
        res.end('Method Not Allowed');
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), modelCachePlugin()],
});
