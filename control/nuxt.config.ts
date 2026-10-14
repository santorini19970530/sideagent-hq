// Static single-page app (technical.md, "Mission control"): reads Firestore directly behind
// read-only rules and writes only through HQ's owner API.
export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  ssr: false,
  devtools: { enabled: false },
  modules: ["@nuxt/ui", "@vueuse/nuxt"],
  // Dark only, and no runtime calls to Google Fonts or the Iconify API: icons come from the
  // bundled @iconify-json sets.
  ui: { colorMode: false, fonts: false },
  icon: {
    provider: "none",
    serverBundle: false,
    // Icons Nuxt UI renders itself (header menu, modal close, loading button) aren't in our
    // sources, so the scan can't find them.
    clientBundle: {
      // The default scan skips .ts files, where the lane icons live (app/utils/jobs.ts).
      scan: { globInclude: ["**/*.{vue,ts}"] },
      icons: ["lucide:menu", "lucide:x", "lucide:loader-circle", "lucide:check"],
    },
  },
  css: ["~/assets/main.css", "@vue-flow/core/dist/style.css"],
  app: {
    head: {
      title: "Mission control",
      titleTemplate: "%s · Sideagent",
      htmlAttrs: { lang: "en", class: "dark" },
      meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
    },
  },
  runtimeConfig: {
    public: {
      // Overridden by NUXT_PUBLIC_* at build time; the defaults match `pnpm emulators`.
      hqUrl: "http://localhost:8080",
      firebaseProjectId: "demo-sideagent",
      firebaseApiKey: "demo-api-key",
      firebaseAuthDomain: "demo-sideagent.firebaseapp.com",
      useEmulators: true,
      firestoreEmulator: "127.0.0.1:8180",
      authEmulator: "http://127.0.0.1:9099",
    },
  },
  typescript: { strict: true },
});
