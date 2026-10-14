import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/.data/",
      "protocol/schemas/",
      "**/.nuxt/",
      "**/.output/",
      // Mission control's build output, copied there by infra/deploy.sh for Firebase Hosting.
      "infra/.hosting/",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs["flat/recommended"],
  {
    // Nuxt auto-imports composables and utils; `nuxt typecheck` catches undefined names instead.
    files: ["control/**"],
    rules: { "no-undef": "off" },
  },
  {
    files: ["**/*.vue"],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: {
      // Pages are routes named by file (index, ledger, agents).
      "vue/multi-word-component-names": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
