import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Make imports cleaner: import X from "@/components/X"
  resolve: {
    alias: { "@": "/src" },
  },
});
