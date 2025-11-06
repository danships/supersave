import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import {
  type EntityDefinition,
  type Repository,
  SuperSave,
} from '../../../build';
import { planetEntity } from '../../entities';
import type { Planet } from '../../types';

// Helper function to create an old SQLite database with TEXT column
function createOldSqliteDatabase(filePath: string): void {
  const db = new Database(filePath);

  // Create table with old TEXT column format
  db.exec(`
    CREATE TABLE planet (
      id TEXT PRIMARY KEY,
      contents TEXT NOT NULL
    )
  `);

  // Insert some test data
  const stmt = db.prepare('INSERT INTO planet (id, contents) VALUES (?, ?)');

  const planet1 = {
    name: 'Earth',
  };
  const planet2 = {
    name: 'Mars',
  };

  stmt.run('earth-id', JSON.stringify(planet1));
  stmt.run('mars-id', JSON.stringify(planet2));

  db.close();
}

describe('SQLite migration tests', () => {
  test('SQLite: migrate contents column from TEXT to JSON', async () => {
    // Create a temporary database file with old TEXT column
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supersave-test-'));
    const dbPath = path.join(tmpDir, 'test.db');

    try {
      // Create old database with TEXT column
      createOldSqliteDatabase(dbPath);

      // Verify the old schema exists
      const verifyDb = new Database(dbPath);
      const columns = verifyDb
        .prepare('PRAGMA table_info(planet)')
        .all() as Array<{ name: string; type: string }>;
      const contentsColumn = columns.find((col) => col.name === 'contents');
      expect(contentsColumn?.type.toUpperCase()).toBe('TEXT');
      verifyDb.close();

      // Now initialize SuperSave with the old database
      const connectionString = `sqlite://${dbPath}`;
      const superSave = await SuperSave.create(connectionString);

      // Add entity - this should trigger migration
      const planetRepository: Repository<Planet> =
        await superSave.addEntity<Planet>(planetEntity);

      // Verify migration occurred - check column type
      const migratedDb = new Database(dbPath);
      const migratedColumns = migratedDb
        .prepare('PRAGMA table_info(planet)')
        .all() as Array<{ name: string; type: string }>;
      const migratedContentsColumn = migratedColumns.find(
        (col) => col.name === 'contents'
      );
      expect(migratedContentsColumn?.type.toUpperCase()).toBe('JSON');
      migratedDb.close();

      // Verify data integrity - all planets should still be accessible
      const planets = await planetRepository.getAll();
      expect(planets).toHaveLength(2);

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
      expect(allPlanets).toHaveLength(3);

      await superSave.close();
    } finally {
      // Cleanup
      try {
        fs.unlinkSync(dbPath);
        fs.rmdirSync(tmpDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  test('SQLite: migration with filterSortFields', async () => {
    // Create a temporary database file with old TEXT column
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supersave-test-'));
    const dbPath = path.join(tmpDir, 'test.db');

    try {
      const db = new Database(dbPath);

      // Create table with old TEXT column format and a filterSortField
      db.exec(`
      CREATE TABLE planet (
        id TEXT PRIMARY KEY,
        contents TEXT NOT NULL,
        name TEXT NULL
      )
    `);

      // Insert test data
      const stmt = db.prepare(
        'INSERT INTO planet (id, contents, name) VALUES (?, ?, ?)'
      );
      stmt.run('earth-id', JSON.stringify({ name: 'Earth' }), 'Earth');
      db.close();

      // Initialize SuperSave with filterSortFields
      const connectionString = `sqlite://${dbPath}`;
      const superSave = await SuperSave.create(connectionString);

      const entityWithFilter: EntityDefinition = {
        ...planetEntity,
        filterSortFields: {
          name: 'string',
        },
      };

      const planetRepository: Repository<Planet> =
        await superSave.addEntity<Planet>(entityWithFilter);

      // Verify migration occurred
      const migratedDb = new Database(dbPath);
      const migratedColumns = migratedDb
        .prepare('PRAGMA table_info(planet)')
        .all() as Array<{ name: string; type: string }>;
      const migratedContentsColumn = migratedColumns.find(
        (col) => col.name === 'contents'
      );
      expect(migratedContentsColumn?.type.toUpperCase()).toBe('JSON');

      // Verify data is still accessible
      const planets = await planetRepository.getAll();
      expect(planets).toHaveLength(1);
      expect(planets[0].name).toBe('Earth');

      migratedDb.close();
      await superSave.close();
    } finally {
      try {
        fs.unlinkSync(dbPath);
        fs.rmdirSync(tmpDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});
