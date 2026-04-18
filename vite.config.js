import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": "/src" },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // React + router in one long-cached vendor chunk
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // Supabase is large (~200KB) — isolate so it caches independently
          "vendor-supabase": ["@supabase/supabase-js"],
        },
      },
    },
  },
});
