import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: ['node_modules/**', '.next/**', 'db/migrations/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // The root-level .mjs config files sit outside the TS project on purpose.
        projectService: { allowDefaultProject: ['*.mjs'] },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node },
    },
    rules: {
      // CLAUDE.md definition of done: no new `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Hard rule 2: nothing in the period engine may read the clock. `asOf` is injected.
    // /lib/date/now.ts is the single sanctioned clock reader and lives outside /lib/periods.
    files: ['lib/periods/**/*.ts', 'lib/ledger/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Period and ledger math must be pure — inject `asOf` instead.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'No `new Date()` in /lib/periods or /lib/ledger — `asOf` is injected.',
        },
        {
          selector: "CallExpression[callee.object.name='Date']",
          message: 'No `Date.now()` in /lib/periods or /lib/ledger — `asOf` is injected.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
