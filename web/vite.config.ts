import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  define: {
    global: "globalThis"
  },

  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [""],
      // The app has grown past the 2 MiB default; raise the precache limit
      // so the production build doesn't fail while trying to build the
      // service worker (Workbox refuses to precache oversized bundles).
      workbox: {
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        /*
          Three chunks are cached when they are first needed rather than
          downloaded up front.

          Precaching means the service worker fetches the whole list in the
          background as soon as it installs -- on every deploy, for every
          user, whether or not they go near the feature. Between them the
          spreadsheet writer, the chart library and the animation engine were
          about 1.1 MB of the 3.1 MB list, and most people never export a
          sheet, open a chart or see the announcement modal in a given
          session. On a slow connection that is bandwidth competing with the
          page the user is actually waiting for.

          They are still cached, just later: the rule below stores each one
          the first time it is genuinely fetched, so the second visit to a
          chart is as fast as it was before and the first is no slower than
          it would have been without a service worker at all.
        */
        /*
          Named by what the chunk contains, not by what Rollup happened to
          call it last time.

          These read "AreaChart-*" and "Lottie-*", which were the chunk names
          when the rule was written. Rollup names a chunk after a module
          inside it, and both had since been renamed -- the chart chunk is now
          "generateCategoricalChart-*" and the animation chunk is plain
          "index-*". So two of the three patterns matched nothing, and 1.1 MB
          the rule existed to keep out of the precache was being downloaded in
          the background by every user on every deploy. The whole point of
          lazy-loading them was undone by the service worker fetching them
          anyway.

          Matching on size rather than name would be sturdier still, but
          Workbox globs cannot express that; naming every heavy chunk
          explicitly at least fails visibly when one is renamed again, because
          the precache total jumps.
        */
        globIgnores: [
          "**/xlsx-*.js",
          "**/xlsxstyle-*.js",
          "**/generateCategoricalChart-*.js",
          "**/recharts-*.js",
          "**/Lottie-*.js",
          "**/lottie-*.js"
        ],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(xlsx|xlsxstyle|recharts|generateCategoricalChart|lottie)-[\w-]+\.js$/,
            handler: "CacheFirst",
            options: {
              cacheName: "heavy-chunks",
              // Content-hashed filenames, so an entry can never be stale --
              // a new build is a new URL. The cap is here to stop old
              // hashes accumulating forever across many deploys.
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          }
        ],
        /**
         * Opening a stored file in its own tab is a navigation, and the offline
         * fallback answered every navigation with index.html — so a task-chat
         * image or a payslip opened in a new tab arrived as the app, which then
         * had no route for it and showed its own 404. The file was on the server
         * the whole time. Anything the server owns is left to the server.
         */
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\b/, /^\/uploads\//]
      },
      manifest: {
        name: "Pixous HR Portal",
        short_name: "HR Portal",
        description: "Employee & HR management for IT and field operations",
        theme_color: "#4F46E5",
        background_color: "#0F172A",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      }
    })
  ],

  build: {
  outDir: path.resolve(
    __dirname,
    "../backend-dotnet/Pixous.HrPortal.Api/wwwroot"
  ),

  emptyOutDir: true,

  rollupOptions: {
    output: {
      manualChunks: {
        "vendor-react": ["react", "react-dom", "react-router-dom"],
        "vendor-query": ["@tanstack/react-query", "@tanstack/react-table"],
        "vendor-realtime": ["@stomp/stompjs", "sockjs-client"],
        "vendor-forms": ["react-hook-form", "@hookform/resolvers", "zod"],
        "vendor-motion": ["framer-motion"],
        "lottie": ["lottie-react"],
        "xlsxstyle": ["xlsx-js-style"]
      }
    }
  }
},

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src")
    }
  },

  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    allowedHosts: true,
    fs: {
      allow: [
        "../",
        "C:/Users/balas/Downloads"
      ]
    },
    proxy: {
      "/api": {
        target: "http://localhost:7060",
        changeOrigin: true,
        secure: false
      },
      "/ws": {
        target: "http://localhost:7060",
        changeOrigin: true,
        secure: false,
        ws: true
      }
    }
  }
});