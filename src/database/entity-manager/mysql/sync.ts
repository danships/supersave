import type { Debugger } from 'debug';
import Debug from 'debug';
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { EntityDefinition, FilterSortField } from '../../types';
import type BaseRepository from '../repository';
import { isEqual } from '../utils';
import Repository from './repository';
import { executeQuery, getConnectionFromPool, getQuery } from './utils';

const debug: Debugger = Debug('supersave:db:sync');

enum MysqlType {
  TEXT = 'text',
  LONGTEXT = 'longtext',
  VARCHAR = 'varchar(255)',
  INTEGER = 'int(11)',
  BOOLEAN = 'tinyint(4)',
  JSON = 'json',
}

type InformationSchemaColumn = {
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  DATA_TYPE: string;
};

const filterSortFieldTypeMap = {
  string: MysqlType.VARCHAR,
  number: MysqlType.INTEGER,
  boolean: MysqlType.BOOLEAN,
};

async function getContentsColumnType(
  connection: PoolConnection,
  tableName: string
): Promise<string | null> {
  // Use INFORMATION_SCHEMA.COLUMNS to get accurate column type
  // For MariaDB, JSON is an alias for LONGTEXT with a JSON_VALID() CHECK constraint
  const query = `
    SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = 'contents'
  `;
  const columns = await getQuery<InformationSchemaColumn>(connection, query, [
    tableName,
  ]);

  if (columns === undefined || columns.length === 0) {
    return null;
  }

  const contentsColumn = columns[0];
  const columnType = contentsColumn.COLUMN_TYPE.toLowerCase();
  const dataType = contentsColumn.DATA_TYPE.toLowerCase();

  // Check if COLUMN_TYPE contains "json" (case-insensitive)
  // This works for MySQL which shows "json" in COLUMN_TYPE
  if (columnType.includes('json')) {
    return 'json';
  }

  // For MariaDB, JSON columns show as "longtext" in both COLUMN_TYPE and DATA_TYPE
  // but have a CHECK constraint with JSON_VALID(). Check for this constraint.
  // Note: MySQL may not have CHECK_CONSTRAINTS table in older versions, so we catch errors
  if (dataType === 'longtext') {
    try {
      // Try to query CHECK_CONSTRAINTS - this works in MariaDB and MySQL 8.0+
      // In MariaDB, we need to join with TABLE_CONSTRAINTS to get TABLE_NAME
      const checkConstraintQuery = `
        SELECT cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
        FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS cc
        INNER JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          ON cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
          AND cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
        WHERE tc.TABLE_SCHEMA = DATABASE()
          AND tc.TABLE_NAME = ?
          AND cc.CHECK_CLAUSE LIKE '%JSON_VALID%'
          AND cc.CHECK_CLAUSE LIKE '%contents%'
      `;
      const checkConstraints = await getQuery<{
        CONSTRAINT_NAME: string;
        CHECK_CLAUSE: string;
      }>(connection, checkConstraintQuery, [tableName]);

      // If there's a JSON_VALID constraint on the contents column, it's a JSON column
      if (
        checkConstraints !== undefined &&
        checkConstraints.length > 0 &&
        checkConstraints.some((constraint) =>
          constraint.CHECK_CLAUSE.toLowerCase().includes('contents')
        )
      ) {
        return 'json';
      }
    } catch (error) {
      // CHECK_CONSTRAINTS table might not exist in older MySQL versions
      // In that case, if it's longtext and we're checking contents, assume it's not JSON
      // (since MySQL would show it as "json" in COLUMN_TYPE if it were JSON)
      debug(
        'Could not query CHECK_CONSTRAINTS, assuming longtext is not JSON',
        error
      );
    }
  }

  // Return the normalized type (longtext, text, etc.)
  return dataType;
}

async function getTableColumns(
  connection: PoolConnection,
  tableName: string,
  entity: EntityDefinition
): Promise<Record<string, MysqlType>> {
  // Use INFORMATION_SCHEMA.COLUMNS to get accurate column types
  const query = `
    SELECT COLUMN_NAME, COLUMN_TYPE, DATA_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
  `;
  const columns = await getQuery<InformationSchemaColumn>(connection, query, [
    tableName,
  ]);

  if (columns === undefined) {
    throw new Error(`Unable to query table structure for ${tableName}.`);
  }

  if (columns.length === 2 && !entity.filterSortFields) {
    debug('Only id column found and no additional filterSortFields defined.');
    return {};
  }

  // Helper to check if a type matches a pattern (for types with optional display widths)
  function matchesTypePattern(columnType: string, baseType: string): boolean {
    const normalized = columnType.toLowerCase();
    // Match exact type or type with display width (e.g., "tinyint", "tinyint(1)", "tinyint(4)")
    return (
      normalized === baseType ||
      normalized.startsWith(`${baseType}(`) ||
      normalized.startsWith(`${baseType} `)
    );
  }

  // Helper to normalize MySQL type string to MysqlType enum
  // Handles types with optional display widths (e.g., tinyint, tinyint(1), tinyint(4))
  function normalizeMysqlType(columnType: string, dataType: string): MysqlType {
    const normalizedColumnType = columnType.toLowerCase();
    const normalizedDataType = dataType.toLowerCase();

    // Check for VARCHAR(255)
    if (normalizedColumnType.startsWith('varchar(255)')) {
      return MysqlType.VARCHAR;
    }
    // Check for VARCHAR(32) - the id column
    if (normalizedColumnType.startsWith('varchar(32)')) {
      // This is the id column, skip it
      throw new Error('Should not normalize id column type');
    }

    // Check for TEXT types
    if (normalizedDataType === 'text') {
      return MysqlType.TEXT;
    }
    if (normalizedDataType === 'longtext') {
      return MysqlType.LONGTEXT;
    }

    // Check for INT types (with optional display width)
    if (matchesTypePattern(normalizedColumnType, 'int')) {
      return MysqlType.INTEGER;
    }

    // Check for TINYINT types (with optional display width)
    if (matchesTypePattern(normalizedColumnType, 'tinyint')) {
      return MysqlType.BOOLEAN;
    }

    throw new Error(`Unrecognized Mysql column type ${columnType}`);
  }

  const mappedColumns: Record<string, MysqlType> = {};
  columns.forEach((column: InformationSchemaColumn) => {
    if (column.COLUMN_NAME === 'contents' || column.COLUMN_NAME === 'id') {
      return;
    }

    // Check if this is a recognized type before normalizing
    const columnTypeLower = column.COLUMN_TYPE.toLowerCase();
    const dataTypeLower = column.DATA_TYPE.toLowerCase();

    // Check if it's a recognized type pattern
    const isRecognizedType =
      columnTypeLower.startsWith('varchar(255)') ||
      dataTypeLower === 'text' ||
      dataTypeLower === 'longtext' ||
      matchesTypePattern(columnTypeLower, 'int') ||
      matchesTypePattern(columnTypeLower, 'tinyint');

    if (!isRecognizedType) {
      throw new Error(`Unrecognized Mysql column type ${column.COLUMN_TYPE}`);
    }

    mappedColumns[column.COLUMN_NAME] = normalizeMysqlType(
      column.COLUMN_TYPE,
      column.DATA_TYPE
    );
  });
  return mappedColumns;
}

function hasTableChanged(
  mysqlColumns: Record<string, MysqlType>,
  mappedFilterSortTypeFields: Record<string, MysqlType>
): boolean {
  const tablesAreEqual: boolean = isEqual(
    mysqlColumns,
    mappedFilterSortTypeFields
  );
  if (!tablesAreEqual) {
    debug('Table changed', mysqlColumns, mappedFilterSortTypeFields);
  }
  return !tablesAreEqual;
}

function mapFilterSortFieldsToColumns(
  filterSortFields: Record<string, FilterSortField>
): Record<string, MysqlType> {
  const result: Record<string, MysqlType> = {};
  Object.entries(filterSortFields).forEach(
    ([fieldName, filter]: [string, FilterSortField]) => {
      result[fieldName] = filterSortFieldTypeMap[filter];
    }
  );
  delete result.id; // We do not check the ID, since that is not a TEXT column.
  return result;
}

async function migrateContentsColumn(
  entity: EntityDefinition,
  tableName: string,
  pool: Pool,
  repository: Repository<any>,
  getRepository: (name: string, namespace?: string) => BaseRepository<any>
): Promise<boolean> {
  const connection: PoolConnection = await getConnectionFromPool(pool);
  try {
    const contentsType = await getContentsColumnType(connection, tableName);

    // Check if contents column needs migration from TEXT/LONGTEXT to JSON
    if (contentsType === 'text' || contentsType === 'longtext') {
      debug(`Contents column is ${contentsType}, migrating to JSON.`);

      const newTableName = `${tableName}_2`;
      const columns = ['id VARCHAR(32) PRIMARY KEY', 'contents JSON NOT NULL'];
      const indexes = [];

      // Include filterSortFields if they exist
      if (typeof entity.filterSortFields !== 'undefined') {
        const filterSortFieldNames: string[] = Object.keys(
          entity.filterSortFields
        );
        for (const fieldName of filterSortFieldNames) {
          const filterSortFieldType = entity.filterSortFields[fieldName];
          if (
            typeof filterSortFieldTypeMap[filterSortFieldType] === 'undefined'
          ) {
            throw new TypeError(
              `Unrecognized field type ${filterSortFieldType}.`
            );
          }

          if (fieldName !== 'id') {
            columns.push(
              `${pool.escapeId(fieldName)} ${
                filterSortFieldTypeMap[filterSortFieldType]
              } NULL`
            );
            indexes.push(fieldName);
          }
        }
      }

      await executeQuery(
        connection,
        `DROP TABLE IF EXISTS ${pool.escapeId(newTableName)};`
      );
      let createQuery = `CREATE TABLE ${pool.escapeId(
        newTableName
      )} (${columns.join(',')}`;
      if (indexes.length > 0) {
        createQuery = `${createQuery}, ${indexes
          .map(
            (index) =>
              `INDEX(${pool.escapeId(index)}${
                (entity.filterSortFields as Record<string, FilterSortField>)?.[
                  index
                ] === 'string'
                  ? '(191)'
                  : ''
              })`
          )
          .join(',')})`;
      } else {
        createQuery = `${createQuery})`;
      }

      debug('Creating temporary table for contents migration.', createQuery);
      await executeQuery(connection, createQuery);

      // Copy the data, validating JSON during copy
      debug('Copying contents to new table with JSON validation.');
      const newRepository = new Repository(
        entity,
        newTableName,
        getRepository,
        pool
      );

      const oldAll = await repository.getAll();
      for (const element of oldAll) {
        await newRepository.create(element);
      }

      debug(
        `Completed copy. Dropping table ${tableName} and renaming temporary table ${newTableName}.`
      );
      await executeQuery(connection, `DROP TABLE ${pool.escapeId(tableName)}`);
      await executeQuery(
        connection,
        `ALTER TABLE ${pool.escapeId(newTableName)} RENAME ${pool.escapeId(
          tableName
        )}`
      );

      return true; // Migration occurred
    }
    return false; // No migration needed
  } finally {
    connection.release();
  }
}

export default async (
  entity: EntityDefinition,
  tableName: string,
  pool: Pool,

  repository: Repository<any>,

  getRepository: (name: string, namespace?: string) => BaseRepository<any>
): Promise<void> => {
  // First, check if contents column needs migration
  const contentsMigrated = await migrateContentsColumn(
    entity,
    tableName,
    pool,
    repository,
    getRepository
  );

  // If contents was migrated, the table structure is already updated
  // But we still need to check if filterSortFields need updating
  if (typeof entity.filterSortFields === 'undefined') {
    return;
  }

  const connection: PoolConnection = await getConnectionFromPool(pool);
  try {
    const mysqlColumns = await getTableColumns(connection, tableName, entity);
    const newMysqlColumns: Record<string, MysqlType> =
      mapFilterSortFieldsToColumns(entity.filterSortFields);

    // Check if filterSortFields changed (including TEXT -> VARCHAR migration)
    if (!hasTableChanged(mysqlColumns, newMysqlColumns)) {
      debug('Table has not changed, not making changes.');
      return;
    }

    // If contents was already migrated, we don't need to recreate the table
    // Just migrate the filterSortFields
    if (contentsMigrated) {
      debug('Contents already migrated, only updating filterSortFields.');
      // Re-run the sync since contents migration may have been done with old field types
      // This will be handled by the regular sync logic below
    }

    const newTableName = `${tableName}_2`;
    const columns = ['id VARCHAR(32) PRIMARY KEY', 'contents JSON NOT NULL'];
    const indexes = [];

    const filterSortFieldNames: string[] = Object.keys(entity.filterSortFields);
    for (const fieldName of filterSortFieldNames) {
      const filterSortFieldType = entity.filterSortFields[fieldName];
      if (typeof filterSortFieldTypeMap[filterSortFieldType] === 'undefined') {
        throw new TypeError(`Unrecognized field type ${filterSortFieldType}.`);
      }

      if (fieldName !== 'id') {
        columns.push(
          `${pool.escapeId(fieldName)} ${
            filterSortFieldTypeMap[filterSortFieldType]
          } NULL`
        );
        indexes.push(fieldName);
      }
    }

    await executeQuery(
      connection,
      `DROP TABLE IF EXISTS ${pool.escapeId(newTableName)};`
    );
    let createQuery = `CREATE TABLE ${pool.escapeId(
      newTableName
    )} (${columns.join(',')}`;
    if (indexes.length > 0) {
      createQuery = `${createQuery}, ${indexes
        .map(
          (index) =>
            `INDEX(${pool.escapeId(index)}${
              (entity.filterSortFields as Record<string, FilterSortField>)[
                index
              ] === 'string'
                ? '(191)'
                : ''
            })`
        )
        .join(',')})`;
    } else {
      createQuery = `${createQuery})`;
    }

    // TODO start a transaction
    debug('Creating temporary table.', createQuery);
    await executeQuery(connection, createQuery);

    // copy the fields
    debug('Copying contents to new table.');
    const newRepository = new Repository(
      entity,
      newTableName,
      getRepository,
      pool
    );

    const oldAll = await repository.getAll();
    for (const element of oldAll) {
      await newRepository.create(element);
    }

    debug(
      `Completed copy. Dropping table ${tableName} and renaming temporary table ${newTableName}.`
    );
    await executeQuery(connection, `DROP TABLE ${pool.escapeId(tableName)}`);
    await executeQuery(
      connection,
      `ALTER TABLE ${pool.escapeId(newTableName)} RENAME ${pool.escapeId(
        tableName
      )}`
    );
  } finally {
    connection.release();
  }
};
