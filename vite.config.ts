import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Single service worker, written once in `src/sw.ts` and compiled by Vite.
      // Workbox only injects the precache manifest into it (injectManifest strategy),
      // so there is exactly one service worker and exactly one registration.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // We register it ourselves from `src/pwa/PwaProvider.tsx` (single registration point).
      injectRegister: null,
      // Never reload the app by itself: the user decides when to apply an update.
      registerType: "prompt",
      injectManifest: {
        // JS/CSS (including every React.lazy chunk), the HTML shell, the offline
        // fallback page and every static asset are precached.
        globPatterns: ["**/*.{js,css,html,ico,svg,png,webp,json,txt,webmanifest}"],
        // Only source maps are skipped: `assets/workbox-window.*.js` is a real
        // runtime chunk (used to register the service worker) and must be cached.
        globIgnores: ["**/*.map"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        rollupFormat: "iife",
        minify: true,
      },
      devOptions: {
        enabled: false,
      },
      manifest: {
        name: "QR Studio Pro — Create, design & scan QR codes",
        short_name: "QR Studio Pro",
        description:
          "Create, design, save, export and scan QR codes completely offline. Private, local and fast.",
        lang: "en",
        dir: "ltr",
        start_url: "/",
        scope: "/",
        id: "/",
        display: "standalone",
        display_override: ["standalone", "minimal-ui", "browser"],
        orientation: "any",
        background_color: "#090a10",
        theme_color: "#090a10",
        categories: ["productivity", "utilities", "graphics", "business"],
        prefer_related_applications: false,
        icons: [
          { src: "/icons/pwa-64x64.png", sizes: "64x64", type: "image/png", purpose: "any" },
          { src: "/icons/pwa-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/icons/maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "Create a QR code",
            short_name: "Create",
            url: "/?section=create",
            icons: [{ src: "/icons/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "Scan a QR code",
            short_name: "Scan",
            url: "/?section=scan",
            icons: [{ src: "/icons/pwa-192x192.png", sizes: "192x192" }],
          },
          {
            name: "My codes",
            short_name: "Library",
            url: "/?section=library",
            icons: [{ src: "/icons/pwa-192x192.png", sizes: "192x192" }],
          },
        ],
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
    // Keep chunk names readable so the precache manifest is easy to audit.
    rollupOptions: {
      output: {
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
