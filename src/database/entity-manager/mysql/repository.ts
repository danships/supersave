import type { Debugger } from 'debug';
import Debug from 'debug';
import type { Pool } from 'mysql2/promise';
import shortUuid from 'short-uuid';
import type {
  BaseEntity,
  EntityDefinition,
  EntityRow,
  FilterSortField,
  QueryFilter,
  QuerySort,
  Relation,
} from '../../types';
import { QueryOperatorEnum } from '../../types';
import type Query from '../query';
import BaseRepository from '../repository';
import { executeQuery, getQuery } from './utils';

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
    const result = await getQuery<EntityRow>(this.pool, query, whereValues);
    const transformResult: T[] = [];
    if (result) {
      const promises = [];
      for (const [iter, element] of result.entries()) {
        const promise = this.transformQueryResultRow(element);
        promises.push(promise);
        transformResult[iter] = await promise;
      }
      await Promise.all(promises);
      return transformResult;
    }
    return [];
  }

  public async getAll(): Promise<T[]> {
    const query = `SELECT id,contents FROM ${this.pool.escapeId(
      this.tableName
    )}`;
    const result = await getQuery<EntityRow>(this.pool, query);

    if (result) {
      const newResults = await this.transformQueryResultRows(result);
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
    const result = await getQuery<EntityRow>(this.pool, sqlQuery, values);
    debug('Found result count', result.length);
    if (result) {
      return this.transformQueryResultRows(result);
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
    const columns: string[] = ['id', 'contents'];
    const uuid =
      typeof object.id === 'string'
        ? (object.id as string)
        : shortUuid.generate();

    const values: (string | number | null)[] = [
      uuid,
      JSON.stringify({
        ...this.definition.template,
        ...this.simplifyRelations(object),
      }),
    ];
    if (typeof this.definition.filterSortFields !== 'undefined') {
      // eslint-disable-next-line max-len
      Object.entries(this.definition.filterSortFields).forEach(
        ([field, type]: [field: string, type: FilterSortField]) => {
          if (field === 'id') {
            return;
          }
          columns.push(field);
          if (type === 'boolean') {
            values.push(object[field] === true ? 1 : 0);
          } else if (this.relationsMap.has(field)) {
            const relation = this.relationsMap.get(field) as Relation;
            if (Array.isArray(object[field]) && relation.multiple) {
              // If an filterSortField is a list, store its ids , separated, so we can filter on it using a LIKE.
              values.push(
                object[field].map((entity: BaseEntity) => entity.id).join(',')
              );
            } else if (relation.multiple) {
              // Its a list, but no array is set.
              values.push(null);
            } else {
              // Store the individual value.
              if (typeof object[field] !== 'object') {
                throw new TypeError(
                  `The provided relation value for ${field}/${type} is not an object. It should be.`
                );
              }
              values.push(
                typeof object[field] === 'string'
                  ? object[field]
                  : object[field]?.id
              );
            }
          } else if (field !== 'id') {
            values.push(
              typeof object[field] !== 'undefined' && object[field] !== null
                ? object[field]
                : null
            );
          }
        }
      );
    }

    const query = `INSERT INTO ${this.pool.escapeId(this.tableName)} (${columns
      .map((column: string) => this.pool.escapeId(column))
      .join(',')}) VALUES(
      ${columns.map(() => '?')}
    )`;
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

    if (typeof this.definition.filterSortFields !== 'undefined') {
      Object.entries(this.definition.filterSortFields).forEach(
        ([field, type]: [field: string, type: FilterSortField]) => {
          if (field === 'id') {
            return;
          }
          if (typeof object[field] !== 'undefined') {
            columns.push(field);
            if (type === 'boolean') {
              values.push(object[field] === true ? 1 : 0);
            } else if (this.relationsMap.has(field)) {
              const relation = this.relationsMap.get(field) as Relation;
              if (Array.isArray(object[field]) && relation.multiple) {
                // If an filterSortField is a list, store its ids , separated, so we can filter on it using a LIKE.
                values.push(
                  object[field].map((entity: BaseEntity) => entity.id).join(',')
                );
              } else if (relation.multiple) {
                // Its a list, but no array is set.
                values.push(null);
              } else {
                // Store the individual value.
                if (typeof object[field] !== 'object') {
                  throw new TypeError(
                    `The provided relation value for ${field}/${type} is not an object. It should be.`
                  );
                }
                values.push(object[field]?.id);
              }
            } else {
              values.push(simplifiedObject[field] || null);
            }
          }
        }
      );
    }

    const query = `UPDATE ${this.pool.escapeId(this.tableName)} SET
      ${columns.map((column: string) => `${this.pool.escapeId(column)} = ?`)}
      WHERE id = ?
    `;
    values.push(object.id || '');
    debug('Generated update query.', query);
    await executeQuery(this.pool, query, values);
    return this.queryById(object.id as string) as unknown as Promise<T>;
  }

  protected async queryById(id: string): Promise<T | null> {
    const query = `SELECT id,contents FROM ${this.pool.escapeId(
      this.tableName
    )} WHERE id = ? LIMIT 1`;
    debug('Query for getById', query, id);
    const result = await getQuery<EntityRow>(this.pool, query, [id]);
    if (result.length > 0) {
      return this.transformQueryResultRow(result[0]);
    }
    debug('No result for queryById().');
    return null;
  }
}

export default Repository;
