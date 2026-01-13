import type { Debugger } from 'debug';
import Debug from 'debug';
import type { Pool, PoolConnection } from 'mysql2/promise';
import type { EntityDefinition, FilterSortField } from '../../types.js';
import { isEqual } from '../utils.js';
import type Repository from './repository.js';
import { executeQuery, getConnectionFromPool, getQuery } from './utils.js';

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
  GENERATION_EXPRESSION: string | null;
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

/**
 * Get all column names that are not generated columns
 * Optimized to fetch all GENERATION_EXPRESSION values in a single query
 * instead of making N queries (one per column)
 */
async function getNonGeneratedColumns(
  connection: PoolConnection,
  tableName: string,
  columnNames: string[]
): Promise<string[]> {
  if (columnNames.length === 0) {
    return [];
  }

  // Fetch all GENERATION_EXPRESSION values for the specified columns in one query
  const placeholders = columnNames.map(() => '?').join(',');
  const query = `
    SELECT COLUMN_NAME, GENERATION_EXPRESSION
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME IN (${placeholders})
  `;
  const result = await getQuery<{
    COLUMN_NAME: string;
    GENERATION_EXPRESSION: string | null;
  }>(connection, query, [tableName, ...columnNames]);

  if (result === undefined) {
    // If query fails, return all column names (conservative approach)
    return columnNames;
  }

  // Create a map of column names to their generation status
  const generatedColumns = new Set(
    result
      .filter((row) => row.GENERATION_EXPRESSION !== null)
      .map((row) => row.COLUMN_NAME)
  );

  // Return columns that are not generated
  return columnNames.filter((columnName) => !generatedColumns.has(columnName));
}

/**
 * Validate and sanitize field name to prevent SQL injection and JSON path issues
 */
function validateFieldName(fieldName: string): void {
  // Enforce identifier regex: must start with letter or underscore, followed by letters, digits, or underscores
  const identifierRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (!identifierRegex.test(fieldName)) {
    throw new Error(
      `Invalid field name "${fieldName}". Field names must match /^[A-Za-z_][A-Za-z0-9_]*$/`
    );
  }
}

/**
 * Create a generated column expression for a filterSortField
 */
function createGeneratedColumnExpression(
  fieldName: string,
  fieldType: FilterSortField,
  entity: EntityDefinition
): string {
  // Validate fieldName before using it in JSON paths and SQL expressions
  validateFieldName(fieldName);

  const jsonPath = `$.${fieldName}`;
  const relation = entity.relations?.find((rel) => rel.field === fieldName);

  if (relation?.multiple) {
    // For multiple relations, the JSON stores an array like ["id1", "id2"]
    // We need to convert it to comma-separated "id1,id2"
    // Use REPLACE to remove brackets and quotes, then replace "," with ,
    const arrayExtract = `JSON_UNQUOTE(JSON_EXTRACT(contents, '${jsonPath}'))`;
    // Remove [ and ], then replace "," with ,
    return `REPLACE(REPLACE(REPLACE(REPLACE(${arrayExtract}, '[', ''), ']', ''), '","', ','), '"', '')`;
  } else if (relation && !relation?.multiple) {
    // Single relation - just extract the ID string
    return `JSON_UNQUOTE(JSON_EXTRACT(contents, '${jsonPath}'))`;
  } else if (fieldType === 'boolean') {
    // Handle JSON booleans explicitly for MariaDB compatibility
    // JSON_EXTRACT returns JSON boolean true/false, JSON string "true"/"false", or JSON null
    // We need to convert to 1/0/NULL for the INTEGER column
    const extractExpr = `JSON_EXTRACT(contents, '${jsonPath}')`;
    // Check JSON type and convert accordingly
    // For JSON boolean: check JSON_TYPE = 'BOOLEAN' and convert using JSON_UNQUOTE then comparison
    // MariaDB: JSON_UNQUOTE of a JSON boolean returns the string 'true' or 'false'
    // For JSON string: unquote and check if it's "true"/"false" (lowercased)
    // For JSON null: return NULL
    return `CASE 
      WHEN JSON_TYPE(${extractExpr}) = 'NULL' THEN NULL
      WHEN JSON_TYPE(${extractExpr}) = 'BOOLEAN' THEN IF(LOWER(JSON_UNQUOTE(${extractExpr})) = 'true', 1, 0)
      WHEN LOWER(JSON_UNQUOTE(${extractExpr})) = 'true' THEN 1
      WHEN LOWER(JSON_UNQUOTE(${extractExpr})) = 'false' THEN 0
      ELSE 0
    END`;
  } else if (fieldType === 'number') {
    return `CAST(JSON_EXTRACT(contents, '${jsonPath}') AS SIGNED)`;
  } else {
    // string
    // JSON_UNQUOTE returns NULL when JSON_EXTRACT returns JSON null or SQL NULL
    // However, we need to ensure it works correctly - use IFNULL to handle edge cases
    // JSON_EXTRACT returns NULL if field doesn't exist, or JSON null if field is null
    // JSON_UNQUOTE of JSON null should return SQL NULL, but let's be explicit
    const extractExpr = `JSON_EXTRACT(contents, '${jsonPath}')`;
    return `IF(JSON_TYPE(${extractExpr}) = 'NULL', NULL, JSON_UNQUOTE(${extractExpr}))`;
  }
}

/**
 * Get existing indexes for a table
 */
async function getTableIndexes(
  connection: PoolConnection,
  tableName: string
): Promise<string[]> {
  const query = `
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND INDEX_NAME != 'PRIMARY'
    GROUP BY INDEX_NAME
  `;
  const result = await getQuery<{ INDEX_NAME: string }>(connection, query, [
    tableName,
  ]);

  if (result === undefined) {
    return [];
  }

  return result.map((row) => row.INDEX_NAME);
}

/**
 * Get index name for a column (MySQL creates indexes with column name or custom name)
 */
async function getIndexNameForColumn(
  connection: PoolConnection,
  tableName: string,
  columnName: string
): Promise<string | null> {
  const query = `
    SELECT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND COLUMN_NAME = ?
      AND INDEX_NAME != 'PRIMARY'
    LIMIT 1
  `;
  const result = await getQuery<{ INDEX_NAME: string }>(connection, query, [
    tableName,
    columnName,
  ]);

  if (result === undefined || result.length === 0) {
    return null;
  }

  return result[0].INDEX_NAME;
}

async function migrateContentsColumn(
  entity: EntityDefinition,
  tableName: string,
  pool: Pool,
  repository: Repository<any>
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

      // Include filterSortFields if they exist as generated columns
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
            const columnType = filterSortFieldTypeMap[filterSortFieldType];
            const expression = createGeneratedColumnExpression(
              fieldName,
              filterSortFieldType,
              entity
            );
            columns.push(
              `${pool.escapeId(
                fieldName
              )} ${columnType} GENERATED ALWAYS AS (${expression}) STORED`
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
      // Use direct INSERT to avoid issues with generated columns
      // Only insert id and contents - generated columns will be computed automatically
      debug('Copying contents to new table with JSON validation.');
      const oldAll = await repository.getAll();
      for (const element of oldAll) {
        const insertQuery = `INSERT INTO ${pool.escapeId(
          newTableName
        )} (${pool.escapeId('id')}, ${pool.escapeId(
          'contents'
        )}) VALUES (?, ?)`;
        // Reconstruct the JSON contents without the id (id is stored separately)
        const { id, ...elementWithoutId } = element;
        const contentsJson = JSON.stringify({
          ...entity.template,
          ...elementWithoutId,
        });
        await executeQuery(connection, insertQuery, [id, contentsJson]);
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
  repository: Repository<any>
): Promise<void> => {
  // First, check if contents column needs migration
  // migrateContentsColumn will also create generated columns for filterSortFields if they exist
  await migrateContentsColumn(entity, tableName, pool, repository);

  // If contents was migrated, the table structure is already updated with generated columns
  // But we still need to check if filterSortFields need updating (e.g., new fields added)
  if (typeof entity.filterSortFields === 'undefined') {
    return;
  }

  const connection: PoolConnection = await getConnectionFromPool(pool);
  try {
    const mysqlColumns = await getTableColumns(connection, tableName, entity);
    const newMysqlColumns: Record<string, MysqlType> =
      mapFilterSortFieldsToColumns(entity.filterSortFields);

    // Check if columns need to be migrated to generated columns
    const filterSortFieldNames = Object.keys(entity.filterSortFields).filter(
      (name) => name !== 'id'
    );
    const nonGeneratedColumns = await getNonGeneratedColumns(
      connection,
      tableName,
      filterSortFieldNames
    );

    // Get expected and existing indexes
    const expectedIndexColumns = filterSortFieldNames;
    const existingIndexes = await getTableIndexes(connection, tableName);

    // Check which indexes need to be added/removed
    const indexesToAdd: string[] = [];
    const indexesToRemove: string[] = [];

    for (const columnName of expectedIndexColumns) {
      const indexName = await getIndexNameForColumn(
        connection,
        tableName,
        columnName
      );
      if (!indexName) {
        indexesToAdd.push(columnName);
      }
    }

    // Find indexes that should be removed (exist but column no longer in filterSortFields)
    for (const indexName of existingIndexes) {
      // Check if this index is for a column that's no longer in filterSortFields
      const indexColumnsQuery = `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND INDEX_NAME = ?
      `;
      const indexColumns = await getQuery<{ COLUMN_NAME: string }>(
        connection,
        indexColumnsQuery,
        [tableName, indexName]
      );
      if (indexColumns && indexColumns.length > 0) {
        const columnName = indexColumns[0].COLUMN_NAME;
        if (
          columnName !== 'id' &&
          columnName !== 'contents' &&
          !expectedIndexColumns.includes(columnName)
        ) {
          indexesToRemove.push(indexName);
        }
      }
    }

    // If only indexes changed and columns are already generated, use ALTER TABLE
    // This avoids expensive table recreation when only indexes need updating
    const columnsChanged = hasTableChanged(mysqlColumns, newMysqlColumns);
    const needsColumnMigration = nonGeneratedColumns.length > 0;

    if (!columnsChanged && !needsColumnMigration) {
      // Columns are correct and already generated - only check indexes
      if (indexesToAdd.length > 0 || indexesToRemove.length > 0) {
        debug(
          'Only indexes changed, using ALTER TABLE statements (no table recreation needed).'
        );

        // Remove indexes
        for (const indexName of indexesToRemove) {
          debug(`Dropping index ${indexName}.`);
          await executeQuery(
            connection,
            `ALTER TABLE ${pool.escapeId(tableName)} DROP INDEX ${pool.escapeId(
              indexName
            )}`
          );
        }

        // Add indexes
        for (const columnName of indexesToAdd) {
          const fieldType =
            entity.filterSortFields[columnName as string] || 'string';
          const indexLength = fieldType === 'string' ? '(191)' : '';
          debug(`Adding index for column ${columnName}.`);
          await executeQuery(
            connection,
            `ALTER TABLE ${pool.escapeId(tableName)} ADD INDEX ${pool.escapeId(
              columnName
            )} (${pool.escapeId(columnName)}${indexLength})`
          );
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
    const columns = ['id VARCHAR(32) PRIMARY KEY', 'contents JSON NOT NULL'];
    const indexes = [];

    for (const fieldName of filterSortFieldNames) {
      const filterSortFieldType = entity.filterSortFields[fieldName];
      if (typeof filterSortFieldTypeMap[filterSortFieldType] === 'undefined') {
        throw new TypeError(`Unrecognized field type ${filterSortFieldType}.`);
      }

      const columnType = filterSortFieldTypeMap[filterSortFieldType];
      const expression = createGeneratedColumnExpression(
        fieldName,
        filterSortFieldType,
        entity
      );
      columns.push(
        `${pool.escapeId(
          fieldName
        )} ${columnType} GENERATED ALWAYS AS (${expression}) STORED`
      );
      indexes.push(fieldName);
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
    // Use direct INSERT to avoid issues with generated columns
    // Only insert id and contents - generated columns will be computed automatically
    debug('Copying contents to new table.');
    const oldAll = await repository.getAll();
    for (const element of oldAll) {
      const insertQuery = `INSERT INTO ${pool.escapeId(
        newTableName
      )} (${pool.escapeId('id')}, ${pool.escapeId('contents')}) VALUES (?, ?)`;
      // Reconstruct the JSON contents without the id (id is stored separately)
      const { id, ...elementWithoutId } = element;
      const contentsJson = JSON.stringify({
        ...entity.template,
        ...elementWithoutId,
      });
      await executeQuery(connection, insertQuery, [id, contentsJson]);
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
