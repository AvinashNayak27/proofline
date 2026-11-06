import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig(({ mode }) => {
  // Server-side only (no VITE_ prefix): where /cre/trigger is forwarded.
  //  - default http://127.0.0.1:2000 is `cre workflow simulate --listen` (local simulation)
  //  - http://127.0.0.1:2001 is the signing relay in cre-claim/relay (deployed workflow)
  const env = loadEnv(mode, process.cwd(), '')
  const creTrigger = env.CRE_TRIGGER_URL || 'http://127.0.0.1:2000'

  return {
    plugins: [react(), nodePolyfills()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        '@tanstack/react-query',
        'wagmi',
        'wagmi/chains',
        'wagmi/connectors',
        'viem',
        'viem/chains',
        'connectkit',
        'framer-motion',
        'lucide-react',
        'sonner',
        'clsx',
        'tailwind-merge',
        'vite-plugin-node-polyfills/shims/buffer',
        'vite-plugin-node-polyfills/shims/global',
        'vite-plugin-node-polyfills/shims/process',
      ],
    },
    server: {
      allowedHosts: true,
      cors: true,
      proxy: {
        '/cre/trigger': {
          target: creTrigger,
          changeOrigin: true,
          rewrite: () => '/trigger',
        },
      },
    },
  }
})
