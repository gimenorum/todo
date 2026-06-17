import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/**
 * 依存方向（ch.01 §1.3 / §1.5）を no-restricted-imports で機械的に強制する。
 * 「core/ は model/ 以外に依存しない」「ui/ は core/adapters/store を直接呼ばない」等を
 * CI の必須チェックで落とす（口約束でなく検査対象にする）。
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      // 型チェックは tsc が担うため no-undef は無効化（TS の既知パターン）。
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Node スクリプト（ビルド補助）: node グローバルを許可。
  {
    files: ['**/*.mjs', 'scripts/**'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-undef': 'off' },
  },

  // core/: 純粋。model/ 以外への依存を禁止（Phase 1 で本格化）。
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/adapters/**',
                '**/store/**',
                '**/state/**',
                '**/services/**',
                '**/ui/**',
                '**/router/**',
                '**/pwa/**',
                'idb',
              ],
              message: 'core/ は model/ 以外に依存しない（依存方向 / ch.01）。',
            },
          ],
        },
      ],
    },
  },

  // ui/: state・router・model のみ。core/adapters/store を直接呼ばない（services 経由）。
  {
    files: ['src/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/core/**', '**/adapters/**', '**/store/**', 'idb'],
              message: 'ui/ は core/adapters/store を直接呼ばない（services 経由 / ch.01）。',
            },
          ],
        },
      ],
    },
  },

  // state/: services・model のみ。ui や永続 I/O（idb）に直接依存しない。
  {
    files: ['src/state/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/ui/**', 'idb'],
              message: 'state/ は ui/ や idb に直接依存しない（services 経由 / ch.01）。',
            },
          ],
        },
      ],
    },
  },

  // sw/: 独立（WebWorker グローバル）。
  {
    files: ['src/sw/**/*.ts'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },

  // tests/core/: core と model のみ import 可（ch.02 不変条件）。
  {
    files: ['tests/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/adapters/**',
                '**/store/**',
                '**/state/**',
                '**/services/**',
                '**/ui/**',
                '**/router/**',
                '**/pwa/**',
              ],
              message: 'tests/core は core と model のみ import 可（ch.02）。',
            },
          ],
        },
      ],
    },
  },

  // tests 全般: node グローバルを許可。
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
