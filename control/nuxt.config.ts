// Static single-page app (technical.md, "Mission control"): reads Firestore directly behind
// read-only rules and writes only through HQ's owner API.
export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  ssr: false,
  devtools: { enabled: false },
  css: ["~/assets/main.css", "@vue-flow/core/dist/style.css"],
  app: {
    head: {
      title: "Sideagent · Mission control",
      htmlAttrs: { lang: "en" },
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
