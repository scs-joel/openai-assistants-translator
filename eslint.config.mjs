import { FlatCompat } from '@eslint/eslintrc';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.config({
    extends: [
      'next/core-web-vitals',
      'next/typescript',
      //'plugin:tailwindcss/recommended',
      'prettier',
    ],
    plugins: ['simple-import-sort'],
    rules: {
      'import/prefer-default-export': 'off',
      'import/no-cycle': ['error', { maxDepth: '∞' }],
      // 'tailwindcss/classnames-order': [
      //   'warn',
      //   {
      //     officialSorting: true,
      //   },
      // ], // Follow the same ordering as the official plugin `prettier-plugin-tailwindcss`
      // 'tailwindcss/no-custom-classname': 'off',
      'simple-import-sort/imports': 'error', // Import configuration for `eslint-plugin-simple-import-sort`
      'simple-import-sort/exports': 'error', // Export configuration for `eslint-plugin-simple-import-sort`
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  }),
];

export default eslintConfig;
