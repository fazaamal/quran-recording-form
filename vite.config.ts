import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Must match netlify.toml [dev] targetPort so Netlify CLI proxies to the right Vite instance.
  server: { port: 5173, strictPort: true },
});

