import { beforeEach, expect, test, vi } from 'vitest';
import SuperSave from '../../src/super-save.js';
import getConnection from '../connection.js';
import { clear } from '../mysql.js';

beforeEach(clear);

test('migration execution and tracking', async () => {
  const migration1Run = vi.fn().mockResolvedValue(undefined);
  const migration2Run = vi.fn().mockResolvedValue(undefined);

  const migrations = [
    { name: 'm1', run: migration1Run },
    { name: 'm2', run: migration2Run },
  ];

  const ss = await SuperSave.create(getConnection(), { migrations });

  await ss.runMigrations();

  expect(migration1Run).toHaveBeenCalledTimes(1);
  expect(migration1Run).toHaveBeenCalledWith(ss);
  expect(migration2Run).toHaveBeenCalledTimes(1);

  // Check if it's recorded using getConnection()
  const connectionString = getConnection();
  if (connectionString.startsWith('sqlite://')) {
    const db = ss.getConnection<any>();
    const recorded = db
      .prepare('SELECT name FROM _supersave_migrations WHERE name = ?')
      .all('m1');
    expect(recorded).toHaveLength(1);
    expect(recorded[0].name).toBe('m1');
  } else {
    const pool = ss.getConnection<any>();
    const [recorded] = await pool.query(
      'SELECT name FROM _supersave_migrations WHERE name = ?',
      ['m1']
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].name).toBe('m1');
  }

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
  const engineType = connectionString.startsWith('sqlite://')
    ? 'sqlite'
    : 'mysql';

  const ss = await SuperSave.create(connectionString, { migrations });
  await ss.runMigrations();

  if (engineType === 'sqlite') {
    expect(sqliteMigration).toHaveBeenCalledTimes(1);
    expect(mysqlMigration).not.toHaveBeenCalled();
  } else {
    expect(mysqlMigration).toHaveBeenCalledTimes(1);
    expect(sqliteMigration).not.toHaveBeenCalled();
  }

  await ss.close();
});

test('skipSync option', async () => {
  const ss = await SuperSave.create(getConnection(), { skipSync: true });

  const testEntity = {
    name: 'test_skip_sync',
    template: { name: 'string' },
    relations: [],
    filterSortFields: { name: 'string' },
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
    const [tables] = await pool.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'test_skip_sync'"
    );
    expect(tables).toHaveLength(0);
  }

  await ss.close();
});

test('skipSync prevents schema changes on reconnect', async () => {
  const connectionString = getConnection();

  // Skip for in-memory SQLite as data is lost when connection closes
  if (connectionString === 'sqlite://:memory:') {
    return;
  }

  const baseEntity = {
    name: 'test_skip_sync_reconnect',
    template: { name: 'string' },
    relations: [],
    filterSortFields: { name: 'string' },
  };

  // Step 1: Create table with sync enabled
  const ss1 = await SuperSave.create(connectionString);
  // @ts-expect-error - testing with partial entity
  await ss1.addEntity(baseEntity);

  // Find the actual table name (slug removes underscores: test_skip_sync_reconnect -> testskipsyncreconnect)
  const pool1 = ss1.getConnection<any>();
  const [tables] = await pool1.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'testskipsyncreconnect'"
  );
  expect(tables).toHaveLength(1);
  const tableName = (tables as any[])[0].TABLE_NAME;

  // Verify table was created with the name column before closing
  const [columnsStep1] = await pool1.query(`SHOW COLUMNS FROM ${tableName}`);
  const nameColumnStep1 = (columnsStep1 as any[]).find(
    (c: any) => c.Field === 'name'
  );
  expect(nameColumnStep1).toBeDefined();

  await ss1.close();

  // Step 2: Reconnect with skipSync and add a new field to the entity
  const extendedEntity = {
    ...baseEntity,
    template: { name: 'string', email: 'string' },
    filterSortFields: { name: 'string', email: 'string' },
  };

  const ss2 = await SuperSave.create(connectionString, { skipSync: true });
  // @ts-expect-error - testing with partial entity
  await ss2.addEntity(extendedEntity);

  const pool2 = ss2.getConnection<any>();
  const [columns] = await pool2.query(`SHOW COLUMNS FROM ${tableName}`);
  const emailColumn = (columns as any[]).find((c: any) => c.Field === 'email');
  expect(emailColumn).toBeUndefined();
  // But the original column should still exist
  const nameColumn = (columns as any[]).find((c: any) => c.Field === 'name');
  expect(nameColumn).toBeDefined();

  await ss2.close();
});
