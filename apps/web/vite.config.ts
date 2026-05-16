import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Keep graph libraries out of the startup chunk; relationship views
          // load the graph bundle only when users open graph-heavy workflows.
          if (id.includes('cytoscape')) return 'vendor-graph';
          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true
  }
});
