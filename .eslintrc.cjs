module.exports = {
	root: true,
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
	},
	// Modular MVC layer contract (ADR-009). Scoped to src/modules/** so legacy
	// layer-first folders are unaffected during migration.
	overrides: [
		{
			files: ['src/modules/*/*.controller.js'],
			rules: {
				'no-restricted-imports': [
					'error',
					{
						patterns: [
							{
								group: ['sequelize', 'sequelize/*'],
								message:
									'Controllers must not touch the ORM. Move the query into a repository or query object.'
							},
							{
								group: ['**/models', '**/models/*'],
								message: 'Controllers must not import models. Go through a service.'
							}
						]
					}
				]
			}
		},
		{
			files: ['src/modules/*/*.service.js'],
			rules: {
				'no-restricted-imports': [
					'error',
					{
						patterns: [
							{
								group: ['express', 'express/*'],
								message: 'Services must not know about HTTP. Keep Express in the controller.'
							}
						]
					}
				],
				'id-denylist': ['error', 'req', 'res', 'next']
			}
		},
		{
			files: ['src/modules/*/*.repository.js'],
			rules: {
				'no-restricted-imports': [
					'error',
					{
						patterns: [
							{
								group: ['express', 'express/*'],
								message: 'Repositories must not answer HTTP.'
							}
						]
					}
				]
			}
		}
	]
};
