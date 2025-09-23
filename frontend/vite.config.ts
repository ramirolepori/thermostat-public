// vite.config.ts
import { defineConfig, splitVendorChunkPlugin } from 'vite';
import react from '@vitejs/plugin-react';
import { compression } from 'vite-plugin-compression2';
import { visualizer } from 'rollup-plugin-visualizer';

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const isProd = command === 'build';
  
  return {
    plugins: [
      react(),
      // Separar las dependencias del código de la aplicación para mejor caché
      splitVendorChunkPlugin(),
      // Comprimir archivos en producción
      isProd && compression({
        include: [/\.(js|css|html|svg)$/],
        threshold: 1024, // solo comprimir archivos mayores a 1KB
      }),
      // Generar un reporte de tamaño de bundle en producción
      isProd && visualizer({
        open: false,
        gzipSize: true,
        brotliSize: true,
        filename: 'dist/stats.html',
      }),
    ].filter(Boolean),
    
    // Configuración del servidor de desarrollo
    server: {
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
          // Solo logear en modo desarrollo cuando sea necesario
          configure: (proxy, _options) => {
            if (process.env.DEBUG) {
              proxy.on('error', (err, _req, _res) => {
                console.log('proxy error', err);
              });
              proxy.on('proxyReq', (proxyReq, req, _res) => {
                console.log('Sending Request:', req.method, req.url);
              });
              proxy.on('proxyRes', (proxyRes, req, _res) => {
                console.log('Received Response from:', req.url, proxyRes.statusCode);
              });
            } else {
              // Error mínimo en modo normal
              proxy.on('error', (err) => {
                console.error(`Proxy error: ${err.message}`);
              });
            }
          }
        },
      },
      // Mejorar el hot module replacement
      hmr: {
        overlay: true,
      },
    },
    
    // Optimizaciones de build
    build: {
      // Genera sourcemaps solo para producción
      sourcemap: isProd,
      // Opciones de minificación más agresivas
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: isProd,
          drop_debugger: isProd,
        },
      },
      // Dividir el código en chunks más pequeños
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor': ['react', 'react-dom'],
            'lucide': ['lucide-react'],
          },
          // Limita el tamaño de los chunks para evitar archivos muy grandes
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash].[ext]',
        },
      },
      // Reporte de tamaño de chunks
      chunkSizeWarningLimit: 600,
    },
    
    // Optimizaciones para modo de desarrollo
    optimizeDeps: {
      // Prebundle dependencias comunes
      include: ['react', 'react-dom', 'lucide-react'],
    },
    
    // Configurar esbuild para rendimiento
    esbuild: {
      logOverride: { 'this-is-undefined-in-esm': 'silent' },
    },
  };
});