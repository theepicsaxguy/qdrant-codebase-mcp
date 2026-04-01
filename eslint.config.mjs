import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import security from 'eslint-plugin-security';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import unusedImports from 'eslint-plugin-unused-imports';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'vitest.config.ts', 'eslint.config.mjs'],
  },
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': typescriptEslint,
      security,
      sonarjs,
      unicorn,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── TypeScript: strict type-checked ──────────────────────────────────
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',
      '@typescript-eslint/prefer-as-const': 'error',
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true, allowTypedFunctionExpressions: true }],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/return-await': ['error', 'always'],
      '@typescript-eslint/promise-function-async': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-shadow': 'error',

      // ── Dead code ─────────────────────────────────────────────────────────
      'no-unreachable': 'error',
      'unused-imports/no-unused-imports': 'error',

      // ── Small files / SOLID – Single Responsibility ───────────────────────
      // Each file ≤ 200 logical lines; each function ≤ 40 lines.
      // If a file exceeds this, extract a new module — that IS the SOLID fix.
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'complexity': ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],

      // ── No anti-patterns ──────────────────────────────────────────────────
      'no-var': 'error',
      'prefer-const': 'error',
      'eqeqeq': ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'prefer-template': 'error',
      'no-throw-literal': 'error',
      'no-shadow': 'off', // delegated to @typescript-eslint/no-shadow above
      'no-duplicate-imports': 'error',
      'no-else-return': 'error',
      'no-lonely-if': 'error',
      'prefer-arrow-callback': 'error',
      'object-shorthand': 'error',
      'no-useless-concat': 'error',

      // ── SonarJS: code smell / quality ─────────────────────────────────────
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      'sonarjs/no-identical-functions': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-duplicated-branches': 'error',
      'sonarjs/prefer-immediate-return': 'error',

      // ── Unicorn: best practices ────────────────────────────────────────────
      'unicorn/no-for-loop': 'error',              // use for...of
      'unicorn/prefer-array-find': 'error',         // .find() not .filter()[0]
      'unicorn/prefer-includes': 'error',           // .includes() not .indexOf()
      'unicorn/prefer-string-starts-ends-with': 'error',
      'unicorn/throw-new-error': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/no-static-only-class': 'error',      // SOLID: use module exports
      'unicorn/no-this-assignment': 'error',
      'unicorn/consistent-function-scoping': 'error',
      'unicorn/no-array-push-push': 'error',
      'unicorn/prefer-array-flat-map': 'error',
      'unicorn/no-array-for-each': 'error',         // use for...of
      'unicorn/no-nested-ternary': 'error',
      'unicorn/prefer-string-slice': 'error',
      'unicorn/error-message': 'error',             // errors must have messages
      'unicorn/prefer-type-error': 'error',
      'unicorn/no-process-exit': 'error',           // use process.exitCode instead
      'unicorn/prefer-logical-operator-over-ternary': 'error',

      // ── Security ──────────────────────────────────────────────────────────
      ...security.configs.recommended.rules,
      'security/detect-object-injection': 'error',   // bracket access with user input
      'security/detect-non-literal-fs-filename': 'error', // path traversal
      'security/detect-non-literal-regexp': 'error', // ReDoS
      'security/detect-unsafe-regex': 'error',       // catastrophic backtracking
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',      // shell injection
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-possible-timing-attacks': 'error',
      'security/detect-pseudoRandomBytes': 'error',  // use crypto.randomBytes
    },
  },
  // Tests: basic TS parsing (no type-aware project) — tests rules don't need type info
  {
    files: ['tests/**/*.ts'],
    plugins: {
      '@typescript-eslint': typescriptEslint,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      'unused-imports/no-unused-imports': 'error',
      'no-unreachable': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
