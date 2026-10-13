// @ts-check
import { createConfig } from '@outloud/eslint-config'

export default createConfig({
  features: {
    stylistic: true,
  },
  style: {
    complexity: 12,
  },
})
  .append({
    ignores: ['playground/**'],
  })
  .append({
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
    },
  })
  .append({
    files: ['test/**'],
    rules: {
      'max-lines-per-function': 'off',
    },
  })
