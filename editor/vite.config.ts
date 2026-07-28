import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// Vite plugin to provide simple read/write API for films
function filmApiPlugin() {
  return {
    name: 'film-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/films' && req.method === 'GET') {
          const filmsDir = path.resolve(__dirname, '../src/dl/films');
          const files = fs.readdirSync(filmsDir).filter(f => f.endsWith('.ts') && !f.includes('index.ts') && !f.includes('kvcache.ts')); // We will manually load kvcache.ts
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files.map(f => f.replace('.ts', ''))));
          return;
        }
        next();
      })
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), filmApiPlugin()],
  server: {
    port: 3000,
    fs: {
      allow: ['..']
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'react': path.resolve(__dirname, '../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
      'remotion': path.resolve(__dirname, '../node_modules/remotion'),
      '@remotion/player': path.resolve(__dirname, '../node_modules/@remotion/player')
    }
  }
})