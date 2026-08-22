import mysql, { type Connection } from 'mysql2/promise';
import getConnection from './connection.js';

// When a freshly started MySQL/MariaDB container (as used in CI) has only
// just reported "ready for connections", it can still briefly reset new
// connections while it finishes internal startup work. Retry transient
// connection errors instead of failing the whole test file immediately.
const RETRYABLE_CONNECTION_ERROR_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
]);

async function createConnectionWithRetry(
  connectionString: string,
  maxAttempts: number = 10,
  delayMs: number = 500
): Promise<Connection> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await mysql.createConnection(connectionString);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (
        attempt === maxAttempts ||
        !code ||
        !RETRYABLE_CONNECTION_ERROR_CODES.has(code)
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  // Unreachable, but keeps TypeScript happy.
  throw new Error('Failed to create MySQL connection after retries');
}

export const clear = async (): Promise<void> => {
  const connectionString = getConnection();

  if (connectionString.substring(0, 9) === 'sqlite://') {
    return;
  }

  const connection: Connection =
    await createConnectionWithRetry(connectionString);

  const tables: Record<string, any>[] = await getQuery(
    connection,
    'SHOW TABLES'
  );
  const promises: Promise<void>[] = [];
  // biome-ignore lint/suspicious/useAwait: forEach with async is intentional for parallel execution
  Object.values(tables).forEach(async (tableRow) => {
    promises.push(
      executeQuery(
        connection,
        `DROP TABLE ${connection.escapeId(Object.values(tableRow)[0] as string)}`
      )
    );
  });
  await Promise.all(promises);
  await connection.end();
};

async function executeQuery(
  connection: Connection,
  query: string,
  values: (string | number | boolean | null)[] = []
): Promise<void> {
  await connection.query(query, values);
}

async function getQuery<T>(
  connection: Connection,
  query: string,
  values: (string | number | boolean | null)[] = []
): Promise<T[]> {
  const [results] = await connection.query(query, values);
  return results as unknown as T[];
}
