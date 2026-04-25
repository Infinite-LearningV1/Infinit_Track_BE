module.exports = {
	env: {
		node: true,
		jest: true,
		es2022: true
	},
	extends: ['eslint:recommended', 'plugin:import/recommended', 'prettier'],
	ignorePatterns: ['node_modules/**', '.worktrees/**', '.claude/worktrees/**'],
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module'
	},
	rules: {
		'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
	}
};
