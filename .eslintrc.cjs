module.exports = {
	root: true,
	env: {
		node: true,
		jest: true,
		es2022: true
	},
	extends: ['eslint:recommended', 'plugin:import/recommended', 'prettier'],
	parserOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module'
	},
	rules: {
		'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
	}
};
