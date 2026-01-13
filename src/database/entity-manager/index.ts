import type { Database } from 'better-sqlite3';
import type { Debugger } from 'debug';
import Debug from 'debug';
import type { Pool } from 'mysql2/promise';
import EntityManager from './entity-manager.js';
import type { MysqlOptions } from './mysql/connection.js';
import Query from './query.js';
import Repository from './repository.js';

const debug: Debugger = Debug('supersave:db:em');

export { Repository, Query, EntityManager };

export const MYSQL = 'mysql';
export const SQLITE = 'sqlite';

type SqliteOptions = {
  file: string;
};

// Helper to extract default export from dynamic import (handles both ESM and CJS interop)
function getDefaultExport<T>(
  mod: { default: T } | { default: { default: T } }
): T {
  const defaultExport = mod.default;
  // Handle double-default from CJS interop
  if (
    defaultExport &&
    typeof defaultExport === 'object' &&
    'default' in defaultExport
  ) {
    return (defaultExport as { default: T }).default;
  }
  return defaultExport as T;
}

export default async (
  type: typeof MYSQL | typeof SQLITE,
  options: SqliteOptions | MysqlOptions
): Promise<EntityManager> => {
  if (type === 'sqlite') {
    const sqliteModule = await import('./sqlite/index.js');
    const connectionModule = await import('./sqlite/connection.js');
    const Sqlite = getDefaultExport(sqliteModule) as unknown as new (
      conn: Database
    ) => EntityManager;
    const createConnection = getDefaultExport(connectionModule) as unknown as (
      file: string
    ) => Database;
    debug('Setting up connection for', options);
    const conn = createConnection((options as SqliteOptions).file);
    return new Sqlite(conn);
  }
  if (type === 'mysql') {
    const mysqlModule = await import('./mysql/index.js');
    const connectionModule = await import('./mysql/connection.js');
    const Mysql = getDefaultExport(mysqlModule) as unknown as new (
      pool: Pool
    ) => EntityManager;
    const createPool = getDefaultExport(connectionModule) as unknown as (
      conn: string
    ) => Promise<Pool>;
    debug('Setting up connection for mysql.');
    const conn = await createPool((options as MysqlOptions).connection);
    return new Mysql(conn);
  }

  throw new Error(`Unrecognized db type ${type}.`);
};
