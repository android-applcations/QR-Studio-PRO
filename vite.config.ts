import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "pwa/icon-192.svg",
        "pwa/icon-512.svg",
        "pwa/icon-maskable.svg",
        "offline.html",
      ],
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,json}"] ,
        cleanupOutdatedCaches: true,
        sourcemap: false,
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/_/, /^\/__\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "qr-studio-documents",
              networkTimeoutSeconds: 5,
            },
          },
          {
            urlPattern: ({ request }) => ["script", "style", "font"].includes(request.destination),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "qr-studio-assets",
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    target: "es2020",
  },
});
