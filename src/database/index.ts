import type { Debugger } from 'debug';
import Debug from 'debug';
import type { EntityManager } from './entity-manager/index.js';
import dbInitializer from './entity-manager/index.js';

const debug: Debugger = Debug('supersave:db');

export default async (connection: string): Promise<EntityManager> => {
  debug('Got connection string', connection);

  if (connection.substring(0, 9) === 'sqlite://') {
    const file: string = connection.substring(9);
    debug('Found sqlite connection string, using file', file);
    return await dbInitializer('sqlite', { file });
  }

  if (connection.substring(0, 8) === 'mysql://') {
    return await dbInitializer('mysql', { connection });
  }

  throw new Error('Unrecognized connection string.');
};
