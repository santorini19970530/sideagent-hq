// Palettes are defined in assets/main.css: signal amber for live activity, ink for the panels.
export default defineAppConfig({
  ui: {
    colors: {
      primary: "signal",
      neutral: "ink",
      success: "emerald",
      info: "blue",
      error: "red",
    },
    // Every alert in mission control reports an error.
    alert: { defaultVariants: { color: "error", variant: "subtle" } },
    // Panels sit one step above the page.
    card: { variants: { variant: { outline: { root: "bg-muted" } } } },
    table: {
      slots: {
        th: "font-mono text-[11px] font-semibold tracking-[0.12em] text-muted uppercase",
        td: "text-default",
      },
    },
    // A compact page header for a dashboard, not a marketing page.
    pageHeader: {
      slots: {
        root: "py-0 border-none",
        wrapper: "lg:items-end",
        // Same as the `.eyebrow` class, spelled out so it overrides the default colour and size.
        headline:
          "mb-1 font-mono text-[11px] leading-none font-semibold tracking-[0.14em] text-muted uppercase",
        title: "text-[22px] sm:text-[22px]",
        description: "text-base",
      },
      variants: { title: { true: { description: "mt-1.5" } } },
    },
  },
});
