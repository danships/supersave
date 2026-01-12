import type { Database } from 'better-sqlite3';
import type { Debugger } from 'debug';
import Debug from 'debug';
import type { EntityDefinition, FilterSortField } from '../../types.js';
import type BaseRepository from '../repository.js';
import { isEqual } from '../utils.js';
import Repository from './repository.js';

const debug: Debugger = Debug('supersave:db:sync');

enum SqliteType {
  TEXT = 'TEXT',
  INTEGER = 'INTEGER',
  BOOLEAN = 'INTEGER',
  JSON = 'JSON',
}

type SqlitePragmaColumn = {
  name: string;
  notnull: number;
  type: SqliteType;
  pk: number;
  hidden: number; // 0 = normal column, 1 = hidden (generated column)
};

const filterSortFieldSqliteTypeMap = {
  string: SqliteType.TEXT,
  number: SqliteType.INTEGER,
  boolean: SqliteType.BOOLEAN,
};

function getContentsColumnType(
  connection: Database,
  tableName: string
): string | null {
  const query = `pragma table_info('${tableName}');`;
  const stmt = connection.prepare(query);
  const columns = stmt.all() as SqlitePragmaColumn[];

  if (columns === undefined) {
    throw new Error(`Unable to query table structure for ${tableName}.`);
  }

  const contentsColumn = columns.find((col) => col.name === 'contents');
  return contentsColumn ? contentsColumn.type.toUpperCase() : null;
}

function getTableColumns(
  connection: Database,
  tableName: string,
  entity: EntityDefinition
): Record<string, SqliteType> {
  const query = `pragma table_info('${tableName}');`;
  const stmt = connection.prepare(query);
  const columns = stmt.all() as SqlitePragmaColumn[];

  if (columns === undefined) {
    throw new Error(`Unable to query table structure for ${tableName}.`);
  }

  if (columns.length === 2 && !entity.filterSortFields) {
    debug('Only id column found and no additional filterSortFields defined.');
    return {};
  }

  const sqliteTypeMap: Record<SqliteType, FilterSortField> = {
    [SqliteType.TEXT]: 'string',
    [SqliteType.INTEGER]: 'number',
    [SqliteType.JSON]: 'string', // JSON is stored as TEXT in SQLite
    // [SqliteType.BOOLEAN]: 'number', Its also maps to integer
  };

  const mappedColumns: Record<string, SqliteType> = {};
  columns.forEach((column: SqlitePragmaColumn) => {
    if (column.name === 'contents') {
      return;
    }
    if (!sqliteTypeMap[column.type]) {
      throw new Error(`Unrecognized Sqlite column type ${column.type}`);
    }
    mappedColumns[column.name] = column.type;
  });
  return mappedColumns;
}

function hasTableChanged(
  sqliteColumns: Record<string, SqliteType>,
  mappedFilterSortTypeFields: Record<string, SqliteType>
): boolean {
  const tablesAreEqual: boolean = isEqual(
    sqliteColumns,
    mappedFilterSortTypeFields
  );
  if (!tablesAreEqual) {
    debug('Table changed', sqliteColumns, mappedFilterSortTypeFields);
  }
  return !tablesAreEqual;
}

function mapFilterSortFieldsToColumns(
  filterSortFields: Record<string, FilterSortField>
): Record<string, SqliteType> {
  const result: Record<string, SqliteType> = {};
  Object.entries(filterSortFields).forEach(
    ([fieldName, filter]: [string, FilterSortField]) => {
      const sqliteType = filterSortFieldSqliteTypeMap[filter];
      if (!sqliteType) {
        throw new TypeError(
          `Unsupported filter type "${filter}" for "${fieldName}"`
        );
      }
      result[fieldName] = filterSortFieldSqliteTypeMap[filter];
    }
  );

  return result;
}

/**
 * Check if a column is a generated column by checking the table definition
 */
function isColumnGenerated(
  connection: Database,
  tableName: string,
  columnName: string
): boolean {
  // Query sqlite_master to get the table definition
  const query = `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`;
  const stmt = connection.prepare(query);
  const result = stmt.get(tableName) as { sql: string } | undefined;

  if (!result || !result.sql) {
    return false;
  }

  // Check if the column definition contains "GENERATED ALWAYS AS"
  const sql = result.sql;
  // Find the column definition in the CREATE TABLE statement
  const columnPattern = new RegExp(
    `["\`]?${columnName}["\`]?\\s+[^,)]+GENERATED\\s+ALWAYS\\s+AS`,
    'i'
  );
  return columnPattern.test(sql);
}

/**
 * Get all column names that are not generated columns
 */
function getNonGeneratedColumns(
  connection: Database,
  tableName: string,
  columnNames: string[]
): string[] {
  const nonGenerated: string[] = [];
  for (const columnName of columnNames) {
    const isGenerated = isColumnGenerated(connection, tableName, columnName);
    if (!isGenerated) {
      nonGenerated.push(columnName);
    }
  }
  return nonGenerated;
}

/**
 * Create a generated column expression for a filterSortField
 */
function createGeneratedColumnExpression(
  fieldName: string,
  fieldType: FilterSortField,
  entity: EntityDefinition
): string {
  const jsonPath = `$.${fieldName}`;
  const relation = entity.relations?.find((rel) => rel.field === fieldName);

  if (relation?.multiple) {
    // For multiple relations, the JSON stores an array like ["id1", "id2"]
    // We need to convert it to comma-separated "id1,id2"
    // SQLite doesn't allow subqueries in generated columns, so we use REPLACE functions
    // json_extract returns the array as a JSON string like ["id1","id2"]
    // We remove brackets and quotes, then replace "," with ,
    const arrayExtract = `json_extract(contents, '${jsonPath}')`;
    // Remove [ and ], then replace "," with ,, then remove remaining quotes
    return `REPLACE(REPLACE(REPLACE(REPLACE(${arrayExtract}, '[', ''), ']', ''), '","', ','), '"', '')`;
  } else if (relation && !relation?.multiple) {
    // Single relation - just extract the ID string
    return `json_extract(contents, '${jsonPath}')`;
  } else if (fieldType === 'boolean') {
    return `CAST(json_extract(contents, '${jsonPath}') AS INTEGER)`;
  } else if (fieldType === 'number') {
    return `CAST(json_extract(contents, '${jsonPath}') AS INTEGER)`;
  } else {
    // string
    return `json_extract(contents, '${jsonPath}')`;
  }
}

/**
 * Get existing indexes for a table
 */
function getTableIndexes(connection: Database, tableName: string): string[] {
  const query = `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND name IS NOT NULL`;
  const stmt = connection.prepare(query);
  const result = stmt.all(tableName) as { name: string }[];

  if (!result) {
    return [];
  }

  return result.map((row) => row.name);
}

async function migrateContentsColumn(
  entity: EntityDefinition,
  tableName: string,
  connection: Database,
  repository: Repository<any>,
  getRepository: (name: string, namespace?: string) => BaseRepository<any>
): Promise<boolean> {
  const contentsType = getContentsColumnType(connection, tableName);

  // Check if contents column needs migration from TEXT to JSON
  if (contentsType === 'TEXT') {
    debug(`Contents column is TEXT, migrating to JSON.`);

    const newTableName = `${tableName}_2`;
    const columns = ['id TEXT PRIMARY KEY', 'contents JSON NOT NULL'];
    const indexes = [];

    // Include filterSortFields if they exist
    if (typeof entity.filterSortFields !== 'undefined') {
      const filterSortFieldNames: string[] = Object.keys(
        entity.filterSortFields
      );
      for (const fieldName of filterSortFieldNames) {
        const filterSortFieldType = entity.filterSortFields[fieldName];
        if (
          typeof filterSortFieldSqliteTypeMap[filterSortFieldType] ===
          'undefined'
        ) {
          throw new TypeError(
            `Unrecognized field type ${filterSortFieldType}.`
          );
        }

        if (fieldName !== 'id') {
          const columnType = filterSortFieldSqliteTypeMap[filterSortFieldType];
          const expression = createGeneratedColumnExpression(
            fieldName,
            filterSortFieldType,
            entity
          );
          columns.push(
            `"${fieldName}" ${columnType} GENERATED ALWAYS AS (${expression}) STORED NULL`
          );
          indexes.push(
            `CREATE INDEX IF NOT EXISTS idx_${fieldName} ON ${newTableName}("${fieldName}")`
          );
        }
      }
    }

    connection.prepare(`DROP TABLE IF EXISTS ${newTableName};`).run();
    const createQuery = `CREATE TABLE ${newTableName} (${columns.join(',')})`;

    debug('Creating temporary table for contents migration.', createQuery);
    connection.prepare(createQuery).run();

    if (indexes.length > 0) {
      debug('Setting indexes.');
      for (let iter = indexes.length - 1; iter >= 0; iter -= 1) {
        connection.prepare(indexes[iter]).run();
      }
    }

    // Copy the data, validating JSON during copy
    debug('Copying contents to new table with JSON validation.');
    const newRepository = new Repository(
      entity,
      newTableName,
      getRepository,
      connection
    );

    const oldAll = await repository.getAll();
    for (const element of oldAll) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await newRepository.create(element);
    }

    debug(
      `Completed copy. Dropping table ${tableName} and renaming temporary table ${newTableName}.`
    );
    connection.prepare(`DROP TABLE ${tableName}`).run();
    connection
      .prepare(`ALTER TABLE ${newTableName} RENAME TO ${tableName}`)
      .run();

    return true; // Migration occurred
  }
  return false; // No migration needed
}

export default async (
  entity: EntityDefinition,
  tableName: string,
  connection: Database,

  repository: Repository<any>,

  getRepository: (name: string, namespace?: string) => BaseRepository<any>
): Promise<void> => {
  // First, check if contents column needs migration
  // migrateContentsColumn will also create generated columns for filterSortFields if they exist
  await migrateContentsColumn(
    entity,
    tableName,
    connection,
    repository,
    getRepository
  );

  // If contents was migrated, the table structure is already updated with generated columns
  // But we still need to check if filterSortFields need updating (e.g., new fields added)
  if (typeof entity.filterSortFields === 'undefined') {
    return;
  }

  const sqliteColumns = getTableColumns(connection, tableName, entity);
  const newSqliteColumns: Record<string, SqliteType> =
    mapFilterSortFieldsToColumns(entity.filterSortFields);

  // Check if columns need to be migrated to generated columns
  const filterSortFieldNames = Object.keys(entity.filterSortFields).filter(
    (name) => name !== 'id'
  );
  const nonGeneratedColumns = getNonGeneratedColumns(
    connection,
    tableName,
    filterSortFieldNames
  );

  // Get expected and existing indexes
  const expectedIndexColumns = filterSortFieldNames;
  const existingIndexes = getTableIndexes(connection, tableName);

  // Check which indexes need to be added/removed
  const indexesToAdd: string[] = [];
  const indexesToRemove: string[] = [];

  for (const columnName of expectedIndexColumns) {
    const indexName = `idx_${columnName}`;
    if (!existingIndexes.includes(indexName)) {
      indexesToAdd.push(columnName);
    }
  }

  // Find indexes that should be removed
  for (const indexName of existingIndexes) {
    // Check if this index is for a column that's no longer in filterSortFields
    if (indexName.startsWith('idx_')) {
      const columnName = indexName.substring(4); // Remove 'idx_' prefix
      if (
        columnName !== 'id' &&
        columnName !== 'contents' &&
        !expectedIndexColumns.includes(columnName)
      ) {
        indexesToRemove.push(indexName);
      }
    }
  }

  // If only indexes changed and columns are already generated, use CREATE/DROP INDEX
  // This avoids expensive table recreation when only indexes need updating
  const columnsChanged = hasTableChanged(sqliteColumns, newSqliteColumns);
  const needsColumnMigration = nonGeneratedColumns.length > 0;

  if (!columnsChanged && !needsColumnMigration) {
    // Columns are correct and already generated - only check indexes
    if (indexesToAdd.length > 0 || indexesToRemove.length > 0) {
      debug(
        'Only indexes changed, using CREATE/DROP INDEX statements (no table recreation needed).'
      );

      // Remove indexes
      for (const indexName of indexesToRemove) {
        debug(`Dropping index ${indexName}.`);
        connection.prepare(`DROP INDEX IF EXISTS ${indexName}`).run();
      }

      // Add indexes
      for (const columnName of indexesToAdd) {
        debug(`Adding index for column ${columnName}.`);
        connection
          .prepare(
            `CREATE INDEX IF NOT EXISTS idx_${columnName} ON ${tableName}("${columnName}")`
          )
          .run();
      }
    } else {
      debug('Table has not changed, not making changes.');
    }
    // Return early - no table recreation needed
    return;
  }

  // Columns need to be migrated or changed - need table recreation
  // This only happens when columns actually change, not for index-only changes
  debug('Columns need migration or change, recreating table.');

  const newTableName = `${tableName}_2`;
  const columns = ['id TEXT PRIMARY KEY', 'contents JSON NOT NULL'];
  const indexes = [];

  for (const fieldName of filterSortFieldNames) {
    const filterSortFieldType = entity.filterSortFields[fieldName];
    if (
      typeof filterSortFieldSqliteTypeMap[filterSortFieldType] === 'undefined'
    ) {
      throw new TypeError(`Unrecognized field type ${filterSortFieldType}.`);
    }

    const columnType = filterSortFieldSqliteTypeMap[filterSortFieldType];
    const expression = createGeneratedColumnExpression(
      fieldName,
      filterSortFieldType,
      entity
    );
    columns.push(
      `"${fieldName}" ${columnType} GENERATED ALWAYS AS (${expression}) STORED NULL`
    );
    indexes.push(
      `CREATE INDEX IF NOT EXISTS idx_${fieldName} ON ${newTableName}("${fieldName}")`
    );
  }

  connection.prepare(`DROP TABLE IF EXISTS ${newTableName};`).run();
  const createQuery = `CREATE TABLE ${newTableName} (${columns.join(',')})`;

  // TODO start a transaction
  debug('Creating temporary table.', createQuery);
  connection.prepare(createQuery).run();

  debug('Setting indexes.');
  for (let iter = indexes.length - 1; iter >= 0; iter -= 1) {
    connection.prepare(indexes[iter]).run();
  }

  // copy the fields
  debug('Copying contents to new table.');
  const newRepository = new Repository(
    entity,
    newTableName,
    getRepository,
    connection
  );

  const oldAll = await repository.getAll();
  for (const element of oldAll) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await newRepository.create(element);
  }

  debug(
    `Completed copy. Dropping table ${tableName} and renaming temporary table ${newTableName}.`
  );
  connection.prepare(`DROP TABLE ${tableName}`).run();
  connection
    .prepare(`ALTER TABLE ${newTableName} RENAME TO ${tableName}`)
    .run();
};
