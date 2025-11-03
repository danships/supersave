import type { Database } from 'better-sqlite3';
import type { Debugger } from 'debug';
import Debug from 'debug';
import shortUuid from 'short-uuid';
import type {
  BaseEntity,
  EntityDefinition,
  FilterSortField,
  QueryFilter,
  QuerySort,
  Relation,
} from '../../types';
import { QueryOperatorEnum } from '../../types';
import type Query from '../query';
import BaseRepository from '../repository';

const debug: Debugger = Debug('supersave:db:sqlite:repo');

class Repository<T extends BaseEntity> extends BaseRepository<T> {
  constructor(
    protected readonly definition: EntityDefinition,
    protected readonly tableName: string,
    protected readonly getRepository: (
      name: string,
      namespace?: string
    ) => BaseRepository<any>,
    protected readonly connection: Database
  ) {
    super(definition, tableName, getRepository);
  }

  public async getByIds(ids: string[]): Promise<T[]> {
    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.connection.prepare(
      `SELECT id, contents FROM ${this.tableName} WHERE id IN (${placeholders})`
    );
    const result = stmt.all(...ids);
    if (result) {
      return await this.transformQueryResultRows(
        result as { id: string; contents: string }[]
      );
    }
    return [];
  }

  public async getAll(): Promise<T[]> {
    const stmt = this.connection.prepare(
      `SELECT id, contents FROM ${this.tableName}`
    );
    const result = stmt.all();

    if (result) {
      return await this.transformQueryResultRows(
        result as { id: string; contents: string }[]
      );
    }
    return [];
  }

  public async getByQuery(query: Query): Promise<T[]> {
    const values: (string | number)[] = [];
    const where: string[] = [];

    query.getWhere().forEach((queryFilter: QueryFilter) => {
      if (queryFilter.operator === QueryOperatorEnum.IN) {
        const placeholders = queryFilter.value.map(() => '?').join(',');
        where.push(`"${queryFilter.field}" IN (${placeholders})`);
        values.push(...queryFilter.value);
      } else if (
        queryFilter.operator === QueryOperatorEnum.EQUALS &&
        (queryFilter.value === null || queryFilter.value === undefined)
      ) {
        // Handle null comparison - use IS NULL instead of = NULL
        where.push(`"${queryFilter.field}" IS NULL`);
      } else {
        where.push(`"${queryFilter.field}" ${queryFilter.operator} ?`);
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

    let sqlQuery = `SELECT id,contents FROM ${this.tableName}
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
    `;
    if (query.getSort().length > 0) {
      sqlQuery = `${sqlQuery} ORDER BY ${query
        .getSort()
        .map(
          (sort: QuerySort) =>
            `"${sort.field}" COLLATE NOCASE ${sort.direction}`
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
    const stmt = this.connection.prepare(sqlQuery);
    const result = stmt.all(...values);
    debug('Found result count', result.length);
    if (result) {
      return await this.transformQueryResultRows(
        result as { id: string; contents: string }[]
      );
    }
    return [];
  }

  public deleteUsingId(id: string): Promise<void> {
    const stmt = this.connection.prepare(
      `DELETE FROM ${this.tableName} WHERE id = ?`
    );
    stmt.run(id);
    return Promise.resolve();
  }

  public async create(object: T): Promise<T> {
    const columns: string[] = ['id', 'contents'];
    const uuid =
      typeof object.id === 'string' ? object.id : shortUuid.generate();

    const valuesObj: Record<string, string | number | null> = {
      id: uuid,
      contents: JSON.stringify({
        ...this.definition.template,
        ...this.simplifyRelations(object),
      }),
    };

    if (typeof this.definition.filterSortFields !== 'undefined') {
      Object.entries(this.definition.filterSortFields).forEach(
        ([field, type]: [field: string, type: FilterSortField]) => {
          columns.push(field);
          if (type === 'boolean') {
            valuesObj[field] = object[field] === true ? 1 : 0;
          } else if (this.relationsMap.has(field)) {
            const relation = this.relationsMap.get(field) as Relation;
            if (Array.isArray(object[field]) && relation.multiple) {
              valuesObj[field] = object[field]
                .map((entity: BaseEntity) => entity.id)
                .join(',');
            } else if (relation.multiple) {
              valuesObj[field] = null;
            } else {
              if (typeof object[field] !== 'object') {
                throw new TypeError(
                  `The provided relation value for ${field}/${type} is not an object. It should be.`
                );
              }
              valuesObj[field] = object[field]?.id || null;
            }
          } else if (field !== 'id') {
            valuesObj[field] =
              typeof object[field] !== 'undefined' && object[field] !== null
                ? object[field]
                : null;
          }
        }
      );
    }

    const columnNames = columns
      .map((column: string) => `"${column}"`)
      .join(',');
    const valuePlaceholders = columns.map(() => '?').join(',');
    const stmt = this.connection.prepare(
      `INSERT INTO ${this.tableName} (${columnNames}) VALUES (${valuePlaceholders})`
    );

    const insertValues = columns.map((col) => valuesObj[col]);
    debug('Generated create query.', stmt.source, insertValues);
    stmt.run(...insertValues);

    return (await this.getById(uuid)) as unknown as T;
  }

  public async update(object: T): Promise<T> {
    const columns = ['contents'];

    const simplifiedObject: any = await this.simplifyRelations(object);
    simplifiedObject.id = undefined;

    const valuesObj: Record<string, string | number | boolean | null> = {
      contents: JSON.stringify(simplifiedObject),
      id: object.id || '',
    };

    if (typeof this.definition.filterSortFields !== 'undefined') {
      Object.entries(this.definition.filterSortFields).forEach(
        ([field, type]: [field: string, type: FilterSortField]) => {
          if (field === 'id') {
            return;
          }
          if (typeof object[field] !== 'undefined') {
            columns.push(field);
            if (type === 'boolean') {
              valuesObj[field] = object[field] === true ? 1 : 0;
            } else if (this.relationsMap.has(field)) {
              const relation = this.relationsMap.get(field) as Relation;
              if (Array.isArray(simplifiedObject[field]) && relation.multiple) {
                valuesObj[field] = simplifiedObject[field]
                  .map((entity: BaseEntity) => entity.id)
                  .join(',');
              } else if (relation.multiple) {
                valuesObj[field] = null;
              } else {
                if (typeof object[field] !== 'object') {
                  throw new TypeError(
                    `The provided relation value for ${field}/${type} is not an object. It should be.`
                  );
                }
                valuesObj[field] = object[field]?.id || null;
              }
            } else {
              valuesObj[field] = simplifiedObject[field] || null;
            }
          }
        }
      );
    }

    const setClauses = columns
      .map((column: string) => `"${column}" = ?`)
      .join(', ');
    const stmt = this.connection.prepare(
      `UPDATE ${this.tableName} SET ${setClauses} WHERE id = ?`
    );
    const updateValues = columns.map((col) => valuesObj[col]);
    updateValues.push(valuesObj.id); // for the WHERE clause

    debug('Generated update query.', stmt.source, updateValues);
    stmt.run(...updateValues);
    return (await this.queryById(object.id as string)) as unknown as T;
  }

  protected async queryById(id: string): Promise<T | null> {
    const stmt = this.connection.prepare(
      `SELECT id, contents FROM ${this.tableName} WHERE id = ? LIMIT 1`
    );
    debug('Query for getById', stmt.source, id);
    const result = stmt.get(id) as { id: string; contents: string } | undefined;
    if (result) {
      return await this.transformQueryResultRow(result);
    }
    debug('No result for queryById().');
    return null;
  }
}

export default Repository;
