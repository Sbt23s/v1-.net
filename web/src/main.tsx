import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "react-hot-toast";
import { router } from "@/routes/router";
import { queryClient } from "@/lib/queryClient";
import { AuthProvider } from "@/context/AuthContext";
import "./index.css";

// Auto-clear reload flag on load
sessionStorage.removeItem("chunk_reload_attempted");

// In development, unregister any production service worker that may intercept Vite requests
if (import.meta.env.DEV && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const r of registrations) {
      r.unregister();
    }
  }).catch(() => {});
}

// Handle Vite dynamic import preload failures globally without infinite reload loops
window.addEventListener("vite:preloadError", () => {
  const lastReload = Number(sessionStorage.getItem("vite_preload_last") || 0);
  if (Date.now() - lastReload > 10000) {
    sessionStorage.setItem("vite_preload_last", String(Date.now()));
    window.location.reload();
  }
});

// Handle uncaught module import errors
window.addEventListener("error", (e) => {
  if (e.message?.includes("Failed to fetch dynamically imported module")) {
    const lastReload = Number(sessionStorage.getItem("chunk_err_last") || 0);
    if (Date.now() - lastReload > 10000) {
      sessionStorage.setItem("chunk_err_last", String(Date.now()));
      window.location.reload();
    }
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "hsl(222 47% 11%)",
                color: "hsl(210 40% 98%)",
                fontSize: "0.875rem"
              }
            }}
          />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </React.StrictMode>
);
