import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173, // Default GUI development port
    // Optional: Proxy API requests to the backend during development
    // proxy: {
    //   '/api': {
    //     target: 'http://localhost:3000',
    //     changeOrigin: true,
    //     rewrite: (path) => path.replace(/^\/api/, ''),
    //   },
    //   '/socket.io': { // Example if using Socket.IO
    //     target: 'ws://localhost:3000',
    //     ws: true,
    //   },
    // },
  },
  build: {
    outDir: 'dist', // Ensure output is in 'dist'
  },
});
