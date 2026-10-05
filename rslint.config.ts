import { defineConfig, js, rstestPlugin, ts } from '@rslint/core';

export default defineConfig([
  { ignores: ['**/dist/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...ts.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true },
    },
  },
  { files: ['__tests__/**/*.ts'], ...rstestPlugin.configs.recommended },
]);
