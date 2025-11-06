import mysql, { type Connection } from 'mysql2/promise';
import slug from 'slug';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  type EntityDefinition,
  type Repository,
  SuperSave,
} from '../../../build';
import getConnection from '../../connection';
import { planetEntity } from '../../entities';
import { clear } from '../../mysql';
import type { Planet } from '../../types';

// Helper to get table name like SuperSave does
function getTableName(entityName: string): string {
  return slug(entityName).replace(/-/g, '_');
}

beforeEach(async () => {
  await clear();
});

// Helper function to create an old MySQL database with LONGTEXT column
async function createOldMysqlDatabase(
  connection: Connection,
  tableName: string
): Promise<void> {
  // Create table with old LONGTEXT column format
  await connection.query(`
    CREATE TABLE IF NOT EXISTS ${connection.escapeId(tableName)} (
      id VARCHAR(32) PRIMARY KEY,
      contents LONGTEXT NOT NULL
    )
  `);

  // Insert some test data
  const planet1 = {
    name: 'Earth',
  };
  const planet2 = {
    name: 'Mars',
  };

  await connection.query(
    `INSERT INTO ${connection.escapeId(
      tableName
    )} (id, contents) VALUES (?, ?)`,
    ['earth-id', JSON.stringify(planet1)]
  );
  await connection.query(
    `INSERT INTO ${connection.escapeId(
      tableName
    )} (id, contents) VALUES (?, ?)`,
    ['mars-id', JSON.stringify(planet2)]
  );
}

async function getTableColumnType(
  connection: Connection,
  tableName: string,
  columnName: string
): Promise<string | null> {
  // Use INFORMATION_SCHEMA.COLUMNS to get accurate column type
  // For MariaDB, JSON is an alias for LONGTEXT with a JSON_VALID() CHECK constraint
  const [rows] = (await connection.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  )) as [
    Array<{ COLUMN_NAME: string; COLUMN_TYPE: string; DATA_TYPE: string }>,
    unknown,
  ];
  const column = rows[0];
  if (!column) {
    return null;
  }

  const columnType = column.COLUMN_TYPE.toLowerCase();
  const dataType = column.DATA_TYPE.toLowerCase();

  // Check if COLUMN_TYPE contains "json" (case-insensitive)
  // This works for MySQL which shows "json" in COLUMN_TYPE
  if (columnType.includes('json')) {
    return 'json';
  }

  // For MariaDB, JSON columns show as "longtext" but have a CHECK constraint with JSON_VALID()
  if (dataType === 'longtext' && columnName === 'contents') {
    try {
      // Join with TABLE_CONSTRAINTS because CHECK_CONSTRAINTS doesn't have TABLE_NAME in MySQL
      const [checkRows] = (await connection.query(
        `SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
         FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
         INNER JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
           ON cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
           AND cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
         WHERE tc.TABLE_SCHEMA = DATABASE()
           AND tc.TABLE_NAME = ?
           AND cc.CHECK_CLAUSE LIKE '%JSON_VALID%'
           AND cc.CHECK_CLAUSE LIKE ?`,
        [tableName, `%${columnName}%`]
      )) as [Array<{ CONSTRAINT_NAME: string; CHECK_CLAUSE: string }>, unknown];

      // If there's a JSON_VALID constraint on this column, it's a JSON column
      if (
        checkRows.length > 0 &&
        checkRows.some((constraint) =>
          constraint.CHECK_CLAUSE.toLowerCase().includes(
            columnName.toLowerCase()
          )
        )
      ) {
        return 'json';
      }
    } catch {
      // CHECK_CONSTRAINTS might not exist in older MySQL versions
      // In that case, if it's longtext, assume it's not JSON
      // (since MySQL would show it as "json" in COLUMN_TYPE if it were JSON)
    }
  }

  // Return the normalized type (longtext, text, etc.)
  return dataType;
}

describe('MySQL/MariaDB migration tests', () => {
  test('MySQL: migrate contents column from LONGTEXT to JSON', async () => {
    const connectionString = getConnection();

    // Skip if not MySQL
    if (connectionString.substring(0, 9) === 'sqlite://') {
      return;
    }

    const connection: Connection =
      await mysql.createConnection(connectionString);

    const tableName = getTableName(planetEntity.name);

    try {
      // Create old database with LONGTEXT column
      await createOldMysqlDatabase(connection, tableName);

      // Verify the old schema exists
      const contentsType = await getTableColumnType(
        connection,
        tableName,
        'contents'
      );
      expect(contentsType).toMatch(/^(longtext|text)$/);

      await connection.end();

      // Now initialize SuperSave with the old database
      const superSave = await SuperSave.create(connectionString);

      // Add entity - this should trigger migration
      const planetRepository: Repository<Planet> =
        await superSave.addEntity<Planet>(planetEntity);

      // Verify migration occurred - check column type
      const verifyConnection: Connection =
        await mysql.createConnection(connectionString);
      const migratedContentsType = await getTableColumnType(
        verifyConnection,
        tableName,
        'contents'
      );
      expect(migratedContentsType).toBe('json');
      await verifyConnection.end();

      // Verify data integrity - all planets should still be accessible
      const planets = await planetRepository.getAll();
      expect(planets.length).toBeGreaterThanOrEqual(2);

      const earth = planets.find((p) => p.name === 'Earth');
      const mars = planets.find((p) => p.name === 'Mars');

      expect(earth).toBeDefined();
      expect(earth?.name).toBe('Earth');
      expect(mars).toBeDefined();
      expect(mars?.name).toBe('Mars');

      // Verify CRUD operations still work
      const jupiter = await planetRepository.create({ name: 'Jupiter' });
      expect(jupiter.name).toBe('Jupiter');

      const allPlanets = await planetRepository.getAll();
      expect(allPlanets.length).toBeGreaterThanOrEqual(3);

      await superSave.close();
    } finally {
      // Cleanup
      try {
        await clear();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('MySQL: migrate contents column from TEXT to JSON', async () => {
    const connectionString = getConnection();

    // Skip if not MySQL
    if (connectionString.substring(0, 9) === 'sqlite://') {
      return;
    }

    const connection: Connection =
      await mysql.createConnection(connectionString);
    const tableName = getTableName(planetEntity.name);

    try {
      // Create table with old TEXT column format (instead of LONGTEXT)
      await connection.query(`
      CREATE TABLE ${connection.escapeId(tableName)} (
        id VARCHAR(32) PRIMARY KEY,
        contents TEXT NOT NULL
      )
    `);

      // Insert test data
      await connection.query(
        `INSERT INTO ${connection.escapeId(
          tableName
        )} (id, contents) VALUES (?, ?)`,
        ['earth-id', JSON.stringify({ name: 'Earth' })]
      );

      await connection.end();

      // Now initialize SuperSave
      const superSave = await SuperSave.create(connectionString);

      const planetRepository: Repository<Planet> =
        await superSave.addEntity<Planet>(planetEntity);

      // Verify migration occurred
      const verifyConnection: Connection =
        await mysql.createConnection(connectionString);
      const migratedContentsType = await getTableColumnType(
        verifyConnection,
        tableName,
        'contents'
      );
      expect(migratedContentsType).toBe('json');
      await verifyConnection.end();

      // Verify data is still accessible
      const planets = await planetRepository.getAll();
      const earth = planets.find((p) => p.name === 'Earth');
      expect(earth).toBeDefined();
      expect(earth?.name).toBe('Earth');

      await superSave.close();
    } finally {
      // Cleanup
      try {
        const cleanupConnection: Connection =
          await mysql.createConnection(connectionString);
        await cleanupConnection.query(
          `DROP TABLE IF EXISTS ${cleanupConnection.escapeId(tableName)}`
        );
        await cleanupConnection.end();
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('MySQL: migration with filterSortFields and VARCHAR migration', async () => {
    const connectionString = getConnection();

    // Skip if not MySQL
    if (connectionString.substring(0, 9) === 'sqlite://') {
      return;
    }

    const connection: Connection =
      await mysql.createConnection(connectionString);
    const tableName = getTableName(planetEntity.name);

    // Create table with old TEXT column for contents and TEXT for filterSortField
    await connection.query(`
      CREATE TABLE ${connection.escapeId(tableName)} (
        id VARCHAR(32) PRIMARY KEY,
        contents LONGTEXT NOT NULL,
        name TEXT NULL
      )
    `);

    // Insert test data
    await connection.query(
      `INSERT INTO ${connection.escapeId(
        tableName
      )} (id, contents, name) VALUES (?, ?, ?)`,
      ['earth-id', JSON.stringify({ name: 'Earth' }), 'Earth']
    );

    await connection.end();

    // Initialize SuperSave with filterSortFields
    const superSave = await SuperSave.create(connectionString);

    const entityWithFilter: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
      },
    };

    const planetRepository: Repository<Planet> =
      await superSave.addEntity<Planet>(entityWithFilter);

    // Verify migration occurred - contents should be JSON, name should be VARCHAR(255)
    const verifyConnection: Connection =
      await mysql.createConnection(connectionString);
    const [columns] = (await verifyConnection.query(
      `SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?`,
      [tableName]
    )) as [
      Array<{ COLUMN_NAME: string; COLUMN_TYPE: string; DATA_TYPE: string }>,
      unknown,
    ];

    const nameColumn = columns.find((col) => col.COLUMN_NAME === 'name');

    // Check if contents column is JSON (use the helper function for consistency)
    const contentsType = await getTableColumnType(
      verifyConnection,
      tableName,
      'contents'
    );
    expect(contentsType).toBe('json');
    expect(nameColumn?.COLUMN_TYPE.toLowerCase()).toMatch(/^varchar\(255\)$/);

    await verifyConnection.end();

    // Verify data is still accessible
    const planets = await planetRepository.getAll();
    expect(planets.length).toBeGreaterThanOrEqual(1);
    const earth = planets.find((p) => p.name === 'Earth');
    expect(earth).toBeDefined();
    expect(earth?.name).toBe('Earth');

    await superSave.close();
  });

  test('MySQL: migration does not run again after initial migration', async () => {
    const connectionString = getConnection();

    // Skip if not MySQL
    if (connectionString.substring(0, 9) === 'sqlite://') {
      return;
    }

    const connection: Connection =
      await mysql.createConnection(connectionString);
    const tableName = getTableName(planetEntity.name);

    // Create old database with LONGTEXT column
    await createOldMysqlDatabase(connection, tableName);

    // Verify the old schema exists
    const contentsType = await getTableColumnType(
      connection,
      tableName,
      'contents'
    );
    expect(contentsType).toMatch(/^(longtext|text)$/);

    await connection.end();

    // First initialization - should trigger migration
    const superSave1 = await SuperSave.create(connectionString);
    const planetRepository1: Repository<Planet> =
      await superSave1.addEntity<Planet>(planetEntity);

    // Verify migration occurred
    const verifyConnection1: Connection =
      await mysql.createConnection(connectionString);
    const migratedContentsType1 = await getTableColumnType(
      verifyConnection1,
      tableName,
      'contents'
    );
    expect(migratedContentsType1).toBe('json');

    // Get initial data
    const planets1 = await planetRepository1.getAll();
    expect(planets1.length).toBeGreaterThanOrEqual(2);
    await verifyConnection1.end();
    await superSave1.close();

    // Second initialization - should NOT trigger migration
    const superSave2 = await SuperSave.create(connectionString);
    const planetRepository2: Repository<Planet> =
      await superSave2.addEntity<Planet>(planetEntity);

    // Verify column type is still JSON (migration didn't run again)
    const verifyConnection2: Connection =
      await mysql.createConnection(connectionString);
    const migratedContentsType2 = await getTableColumnType(
      verifyConnection2,
      tableName,
      'contents'
    );
    expect(migratedContentsType2).toBe('json');

    // Verify data is still intact
    const planets2 = await planetRepository2.getAll();
    expect(planets2.length).toBeGreaterThanOrEqual(2);

    // Verify we can still create new entities
    const venus = await planetRepository2.create({ name: 'Venus' });
    expect(venus.name).toBe('Venus');

    const allPlanets = await planetRepository2.getAll();
    expect(allPlanets.length).toBeGreaterThanOrEqual(3);

    await verifyConnection2.end();
    await superSave2.close();

    // Third initialization - should still NOT trigger migration
    const superSave3 = await SuperSave.create(connectionString);
    const planetRepository3: Repository<Planet> =
      await superSave3.addEntity<Planet>(planetEntity);

    // Verify column type is still JSON
    const verifyConnection3: Connection =
      await mysql.createConnection(connectionString);
    const migratedContentsType3 = await getTableColumnType(
      verifyConnection3,
      tableName,
      'contents'
    );
    expect(migratedContentsType3).toBe('json');

    // Verify data is still intact
    const planets3 = await planetRepository3.getAll();
    expect(planets3.length).toBeGreaterThanOrEqual(3);

    await verifyConnection3.end();
    await superSave3.close();
  });
});
