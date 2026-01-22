import type { Debugger } from 'debug';
import Debug from 'debug';
import type { Pool } from 'mysql2/promise';
import shortUuid from 'short-uuid';

const { generate } = shortUuid;

import type {
  BaseEntity,
  EntityDefinition,
  EntityRow,
  QueryFilter,
  QuerySort,
} from '../../types.js';
import { QueryOperatorEnum } from '../../types.js';
import type Query from '../query.js';
import BaseRepository from '../repository.js';
import { executeQuery, getQuery } from './utils.js';

const debug: Debugger = Debug('supersave:db:mysql:repo');

class Repository<T extends BaseEntity> extends BaseRepository<T> {
  constructor(
    protected readonly definition: EntityDefinition,
    protected readonly tableName: string,
    protected readonly getRepository: (
      name: string,
      namespace?: string
    ) => BaseRepository<any>,
    protected readonly pool: Pool
  ) {
    super(definition, tableName, getRepository);
  }

  public async getByIds(ids: string[]): Promise<T[]> {
    const wherePlaceholders: string[] = [];
    const whereValues: (string | number | boolean)[] = [];

    ids.forEach((value) => {
      wherePlaceholders.push('?');
      whereValues.push(value);
    });

    const query = `SELECT id,contents FROM ${this.pool.escapeId(
      this.tableName
    )} WHERE id IN(${wherePlaceholders.join(',')})`;
    const result = await getQuery<
      EntityRow | { id: string; contents: string | object }
    >(this.pool, query, whereValues);

    if (result) {
      const transformResult: T[] = await Promise.all(
        result.map((element) => this.transformQueryResultRow(element))
      );
      return transformResult;
    }
    return [];
  }

  public async getAll(): Promise<T[]> {
    const query = `SELECT id,contents FROM ${this.pool.escapeId(
      this.tableName
    )}`;
    const result = await getQuery<
      EntityRow | { id: string; contents: string | object }
    >(this.pool, query);

    if (result) {
      const newResults: T[] = [];
      for (const row of result) {
        newResults.push(await this.transformQueryResultRow(row));
      }
      return newResults;
    }
    return [];
  }

  public async getByQuery(query: Query): Promise<T[]> {
    const values: (string | number | boolean)[] = [];
    const where: string[] = [];

    query.getWhere().forEach((queryFilter: QueryFilter) => {
      if (queryFilter.operator === QueryOperatorEnum.IN) {
        const placeholders: string[] = [];
        queryFilter.value.forEach((value: string) => {
          const placeholder = '?';
          placeholders.push(placeholder);
          values.push(value);
        });

        where.push(
          `${this.pool.escapeId(queryFilter.field)} IN(${placeholders.join(
            ','
          )})`
        );
      } else if (
        queryFilter.operator === QueryOperatorEnum.EQUALS &&
        (queryFilter.value === null || queryFilter.value === undefined)
      ) {
        // Handle null comparison - use IS NULL instead of = NULL
        where.push(`${this.pool.escapeId(queryFilter.field)} IS NULL`);
      } else {
        where.push(
          `${this.pool.escapeId(queryFilter.field)} ${queryFilter.operator} ?`
        );
        if (
          this.definition.filterSortFields &&
          this.definition.filterSortFields[queryFilter.field] === 'boolean'
        ) {
          values.push(
            ['1', 1, 'true', true].includes(queryFilter.value) ? 1 : 0
          );
        } else if (queryFilter.operator === QueryOperatorEnum.LIKE) {
          values.push(`${queryFilter.value}`.replace(/\*/g, '%'));
        } else {
          values.push(queryFilter.value);
        }
      }
    });

    let sqlQuery = `SELECT id,contents FROM ${this.pool.escapeId(
      this.tableName
    )}
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    `;
    if (query.getSort().length > 0) {
      sqlQuery = `${sqlQuery} ORDER BY ${query
        .getSort()
        .map(
          (sort: QuerySort) =>
            `${this.pool.escapeId(sort.field)} ${sort.direction}`
        )
        .join(',')}`;
    }
    if (query.getLimit()) {
      sqlQuery = `${sqlQuery} LIMIT ${
        typeof query.getOffset() !== 'undefined'
          ? `${query.getOffset()},${query.getLimit()}`
          : query.getLimit()
      }`;
    }

    debug('Querying data using query.', sqlQuery);
    const result = await getQuery<
      EntityRow | { id: string; contents: string | object }
    >(this.pool, sqlQuery, values);
    debug('Found result count', result.length);
    if (result) {
      const newResults: T[] = await Promise.all(
        result.map((row) => this.transformQueryResultRow(row))
      );
      return newResults;
    }
    return [];
  }

  public async deleteUsingId(id: string): Promise<void> {
    const query = `DELETE FROM ${this.pool.escapeId(
      this.tableName
    )} WHERE id = ?`;
    await executeQuery(this.pool, query, [id]);
  }

  public async create(object: Omit<T, 'id'>): Promise<T> {
    const uuid =
      typeof object.id === 'string' ? (object.id as string) : generate();

    const values: (string | number | null)[] = [
      uuid,
      JSON.stringify({
        ...this.definition.template,
        ...this.simplifyRelations(object),
      }),
    ];

    // Use INSERT ... SET syntax to explicitly set only id and contents
    // This avoids any issues with generated columns
    const query = `INSERT INTO ${this.pool.escapeId(
      this.tableName
    )} SET ${this.pool.escapeId('id')} = ?, ${this.pool.escapeId(
      'contents'
    )} = ?`;
    debug('Generated create query.', query, values);

    await executeQuery(this.pool, query, values);

    return this.getById(uuid) as unknown as T;
  }

  public async update(object: T): Promise<T> {
    const columns = ['contents'];

    const simplifiedObject: any = this.simplifyRelations(object);
    delete simplifiedObject.id; // the id is already stored as a column
    const values: (string | number | boolean | null)[] = [
      JSON.stringify(simplifiedObject),
    ];

    const query = `UPDATE ${this.pool.escapeId(this.tableName)} SET
      ${columns.map((column: string) => `${this.pool.escapeId(column)} = ?`)}
      WHERE id = ?
    `;
    values.push(object.id || '');
    debug('Generated update query.', query);
    await executeQuery(this.pool, query, values);
    return this.queryById(object.id as string) as unknown as Promise<T>;
  }

  protected async transformQueryResultRow(
    row: EntityRow | { id: string; contents: string | object }
  ): Promise<T> {
    // MySQL JSON columns return objects, not strings - handle both cases
    const parsedContents =
      typeof row.contents === 'string'
        ? JSON.parse(row.contents)
        : row.contents;
    return {
      ...this.definition.template,
      ...(await this.fillInRelations(parsedContents)),
      id: row.id, // always make the row the leading ID field
    } as unknown as T;
  }

  protected async queryById(id: string): Promise<T | null> {
    const query = `SELECT id,contents FROM ${this.pool.escapeId(
      this.tableName
    )} WHERE id = ? LIMIT 1`;
    debug('Query for getById', query, id);
    const result = await getQuery<
      EntityRow | { id: string; contents: string | object }
    >(this.pool, query, [id]);
    if (result.length > 0) {
      return this.transformQueryResultRow(result[0]);
    }
    debug('No result for queryById().');
    return null;
  }
}

export default Repository;
