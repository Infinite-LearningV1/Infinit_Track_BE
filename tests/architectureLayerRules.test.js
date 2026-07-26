import { ESLint } from 'eslint';

const lintAs = async (filePath, code) => {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages;
};

describe('modular MVC layer rules', () => {
  it('rejects ORM imports inside a module controller', async () => {
    const messages = await lintAs(
      'src/modules/users/user.controller.js',
      "import { Op } from 'sequelize';\nexport const listUsers = () => Op;\n"
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('rejects model imports inside a module controller', async () => {
    const messages = await lintAs(
      'src/modules/users/user.controller.js',
      "import { User } from '../../models/index.js';\nexport const listUsers = () => User;\n"
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  /**
   * INF-256. The rule advertises "controllers must not touch the ORM", but
   * src/config/database.js exports the configured Sequelize instance -- which
   * is exactly how the attendance, booking and auth controllers obtain
   * transactions today. Without this pattern a migrated controller could open
   * transactions and run raw queries while `npm run lint` stayed green, which
   * is worse than having no rule because it invites trust.
   */
  it('rejects database-config imports inside a module controller', async () => {
    const messages = await lintAs(
      'src/modules/users/user.controller.js',
      "import sequelize from '../../config/database.js';\nexport const listUsers = () => sequelize;\n"
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('still allows a module service to reach the database config for transactions', async () => {
    const messages = await lintAs(
      'src/modules/users/user.service.js',
      "import sequelize from '../../config/database.js';\nexport const listUsers = () => sequelize;\n"
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
  });

  it('rejects express imports inside a module service', async () => {
    const messages = await lintAs(
      'src/modules/users/user.service.js',
      "import express from 'express';\nexport const listUsers = () => express;\n"
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('rejects req/res/next parameter names inside a module service', async () => {
    const messages = await lintAs(
      'src/modules/users/user.service.js',
      'export const listUsers = (req) => req;\n'
    );
    expect(messages.some((m) => m.ruleId === 'id-denylist')).toBe(true);
  });

  it('rejects express imports inside a module repository', async () => {
    const messages = await lintAs(
      'src/modules/users/user.repository.js',
      "import express from 'express';\nexport const findAllUsers = () => express;\n"
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(true);
  });

  it('allows a module service to import a repository', async () => {
    const messages = await lintAs(
      'src/modules/users/user.service.js',
      "import { findAllUsers } from './user.repository.js';\nexport const listUsers = () => findAllUsers();\n"
    );
    // Only the layer rules matter here. import/no-unresolved fires because the
    // fixture path is synthetic, which is unrelated to the layer contract.
    const layerRules = ['no-restricted-imports', 'id-denylist'];
    expect(messages.filter((m) => layerRules.includes(m.ruleId))).toHaveLength(0);
  });

  it('leaves legacy controllers unaffected', async () => {
    const messages = await lintAs(
      'src/controllers/user.controller.js',
      "import { Op } from 'sequelize';\nexport const getAllUsers = () => Op;\n"
    );
    expect(messages.some((m) => m.ruleId === 'no-restricted-imports')).toBe(false);
  });
});
