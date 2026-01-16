import { beforeEach, expect, test, vi } from 'vitest';
import SuperSave from '../../src/super-save';
import getConnection from '../connection';
import { clear } from '../mysql';

beforeEach(clear);

test('migration execution and tracking', async () => {
  const migration1Run = vi.fn().mockResolvedValue(undefined);
  const migration2Run = vi.fn().mockResolvedValue(undefined);

  const migrations = [
    { name: 'm1', run: migration1Run },
    { name: 'm2', run: migration2Run },
  ];

  const ss = await SuperSave.create(getConnection(), { migrations });

  expect(migration1Run).toHaveBeenCalledTimes(1);
  expect(migration1Run).toHaveBeenCalledWith(ss);
  expect(migration2Run).toHaveBeenCalledTimes(1);

  // Check if it's recorded
  const recorded = await (ss as any).em.executeRaw('SELECT name FROM _supersave_migrations WHERE name = ?', ['m1']);
  expect(recorded).toHaveLength(1);
  expect(recorded[0].name).toBe('m1');

  await ss.close();
});

test('engine specific migrations', async () => {
  const sqliteMigration = vi.fn().mockResolvedValue(undefined);
  const mysqlMigration = vi.fn().mockResolvedValue(undefined);

  const migrations = [
    { name: 'sqlite-only', run: sqliteMigration, engine: 'sqlite' as const },
    { name: 'mysql-only', run: mysqlMigration, engine: 'mysql' as const },
  ];

  const connectionString = getConnection();
  const engineType = connectionString.startsWith('sqlite://') ? 'sqlite' : 'mysql';

  const ss = await SuperSave.create(connectionString, { migrations });

  if (engineType === 'sqlite') {
    expect(sqliteMigration).toHaveBeenCalledTimes(1);
    expect(mysqlMigration).not.toHaveBeenCalled();
  } else {
    expect(mysqlMigration).toHaveBeenCalledTimes(1);
    expect(sqliteMigration).not.toHaveBeenCalled();
  }

  await ss.close();
});

test('skipMigrations option', async () => {
  const migrationRun = vi.fn().mockResolvedValue(undefined);
  const ss = await SuperSave.create(getConnection(), {
    migrations: [{ name: 'skip-me', run: migrationRun }],
    skipMigrations: true,
  });

  expect(migrationRun).not.toHaveBeenCalled();
  await ss.close();
});

test('skipSync option', async () => {
  const ss = await SuperSave.create(getConnection(), { skipSync: true });

  const testEntity = {
    name: 'test_skip_sync',
    template: { name: 'string' },
    relations: [],
    filterSortFields: { name: 'string' }
  };

  // @ts-expect-error - testing with partial entity
  await ss.addEntity(testEntity);

  const connectionString = getConnection();
  if (connectionString.startsWith('sqlite://')) {
    const db = ss.getConnection<any>();
    const columns = db.prepare("pragma table_info('test_skip_sync')").all();
    const nameColumn = columns.find((c: any) => c.name === 'name');
    expect(nameColumn).toBeUndefined();
  } else if (connectionString.startsWith('mysql://')) {
    const pool = ss.getConnection<any>();
    const [columns] = await pool.query("SHOW COLUMNS FROM test_skip_sync");
    const nameColumn = (columns as any[]).find((c: any) => c.Field === 'name');
    expect(nameColumn).toBeUndefined();
  }

  await ss.close();
});
