module.exports = {
  env: {
    node: true,
    commonjs: true,
    es2021: true,
    jest: true
  },
  extends: [
    'eslint:recommended',
    'plugin:node/recommended',
    'prettier'
  ],
  parserOptions: {
    ecmaVersion: 2021
  },
  rules: {
    'node/exports-style': ['error', 'module.exports'],
    'node/file-extension-in-import': ['error', 'never'],
    'node/prefer-global/buffer': ['error', 'always'],
    'node/prefer-global/console': ['error', 'always'],
    'node/prefer-global/process': ['error', 'always'],
    'node/prefer-global/url-search-params': ['error', 'always'],
    'node/prefer-global/url': ['error', 'always'],
    'node/prefer-promises/fs': 'error',
    'node/no-unpublished-require': 'off',
    // Error handling
    'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    'handle-callback-err': 'error',
    // Style and best practices
    'arrow-body-style': ['error', 'as-needed'],
    'no-console': 'off',
    'no-process-exit': 'off',
    'node/no-process-exit': 'off',
    'max-len': ['warn', { 'code': 100, 'ignoreUrls': true, 'ignoreStrings': true, 'ignoreTemplateLiterals': true }],
    'prefer-const': 'error',
    'no-var': 'error',
    'object-shorthand': 'error',
    'eqeqeq': ['error', 'always', { 'null': 'ignore' }],
    // Async
    'no-promise-executor-return': 'error',
    'require-atomic-updates': 'error',
    'max-nested-callbacks': ['warn', 4],
    // Disabled rules that may be worth enabling for larger teams
    'camelcase': 'off',
    'consistent-return': 'off',
    // 'require-await': 'error',
    // 'no-return-await': 'error',
  }
}; 