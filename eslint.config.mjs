// ESLint (flat config) for the whole monorepo. Formatting is Prettier's job:
// eslint-config-prettier turns off every stylistic rule that could conflict.
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const WEB = 'apps/web/**/*.{ts,tsx,js,jsx,mjs}';
const TS = '**/*.{ts,tsx}';

/** Scope Next.js presets to the web app only. */
const forWeb = (configs) => configs.map((c) => (c.rules || c.plugins || c.settings ? { ...c, files: [WEB] } : c));

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/next-env.d.ts', 'supabase/**', '**/coverage/**'],
  },

  js.configs.recommended,

  // TypeScript with type information: catches floating promises, unsafe `any`, etc.
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: [TS] })),
  {
    files: [TS],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['apps/backend/vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Fire-and-forget is explicit with `void`; the rest must be awaited or handled.
      '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: true }],
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
    },
  },

  // Backend & scripts run on Node.
  {
    files: ['apps/backend/**/*.ts', '*.mjs', 'apps/web/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/backend/**/*.ts'],
    rules: {
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
  {
    // CLI scripts talk to the terminal by design.
    files: ['apps/backend/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // Next.js + React (rules of hooks, a11y, core web vitals).
  ...forWeb(nextVitals),
  {
    files: [WEB],
    settings: { next: { rootDir: 'apps/web' } },
  },

  // Must be last: disables rules that conflict with Prettier.
  prettier,
);
