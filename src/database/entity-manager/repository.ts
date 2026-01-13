import type {
  BaseEntity,
  EntityDefinition,
  EntityRow,
  Relation,
} from '../types.js';
import Query from './query.js';

export default abstract class Repository<T> {
  protected relationFields: string[];

  protected relationsMap: Map<string, Relation>;

  constructor(
    protected readonly definition: EntityDefinition,
    protected readonly tableName: string,
    protected readonly getRepository: (
      name: string,
      namespace?: string
    ) => Repository<any>
  ) {
    this.relationFields = definition.relations.map(
      (relation: Relation) => relation.field
    );
    this.relationsMap = new Map<string, Relation>();
    definition.relations.forEach((relation) => {
      this.relationsMap.set(relation.field, relation);
    });
  }

  public async getById(id: string): Promise<T | null> {
    return await this.queryById(id);
  }

  public async getOneByQuery(query: Query): Promise<T | null> {
    const result: T[] = await this.getByQuery(query);
    if (result.length === 0) {
      return null;
    }
    return result[0];
  }

  protected async transformQueryResultRows(rows: EntityRow[]): Promise<T[]> {
    const results: T[] = [];
    for (const row of rows) {
      results.push(await this.transformQueryResultRow(row));
    }
    return results;
  }

  protected async transformQueryResultRow(row: EntityRow): Promise<T> {
    const parsedContents = JSON.parse(row.contents);
    return {
      ...this.definition.template,
      ...(await this.fillInRelations(parsedContents)),
      id: row.id, // always make the row the leading ID field
    } as unknown as T;
  }

  protected async fillInRelations(entity: T): Promise<T> {
    if (!this.definition.relations?.length) {
      return entity;
    }

    const clone: T = JSON.parse(JSON.stringify(entity)); // TODO replace with clone function

    for (const relation of this.definition.relations) {
      const repository = this.getRepository(relation.name, relation.namespace);

      if (!relation.multiple) {
        // @ts-expect-error Suppress the TS error because there is no guarantee that the attribute exists.
        const id = clone[relation.field];
        if (typeof id === 'string') {
          const relatedEntity = await repository.getById(id);
          if (!relatedEntity) {
            throw new Error(
              `Unable to find related entity ${relation.name} with id ${
                // @ts-expect-error Suppress the TS error because there is no guarantee that the attribute exists.
                entity[relation.field]
              }`
            );
          }
          // @ts-expect-error Suppress the TS error because there is no guarantee that the attribute exists.
          clone[relation.field] = relatedEntity;
        }
      } else {
        const mappedEntities = await this.mapRelationToMultiple(
          relation,
          // @ts-expect-error Suppress the TS error because there is no guarantee that the attribute exists.
          clone[relation.field]
        );
        // @ts-expect-error Suppress the TS error because there is no guarantee that the attribute exists.
        clone[relation.field] = mappedEntities;
      }
    }
    return clone;
  }

  protected async mapRelationToMultiple(
    relation: Relation,
    array: string[]
  ): Promise<BaseEntity[]> {
    if (!Array.isArray(array) || array.length === 0) {
      return [];
    }
    const repository = this.getRepository(relation.name, relation.namespace);
    const repositoryResults = await repository.getByIds(array);

    // preserve the ordering
    const resultsMap = new Map<string, BaseEntity>();
    repositoryResults.forEach((result) => {
      resultsMap.set(result.id, result);
    });

    const mappedResults: BaseEntity[] = [];
    array.forEach((id) => {
      if (resultsMap.get(id)) {
        mappedResults.push(resultsMap.get(id) as BaseEntity);
      }
    });
    return mappedResults;
  }

  /**
   * Reads of the attributes marked as relations. Flattens it to a string id.
   * @param entity any
   * @returns any
   */

  protected simplifyRelations(entity: any): T {
    // eslint-disable-line @typescript-eslint/explicit-module-boundary-types
    if (this.definition.relations.length === 0) {
      return { ...entity };
    }

    const clone = { ...entity };
    this.definition.relations.forEach((relation: Relation) => {
      if (!clone[relation.field]) {
        return;
      }
      if (relation.multiple) {
        clone[relation.field] = entity[relation.field].map(
          // if it is an object, use its id, else the entity is already represented by its as as string, use that immediately
          (relationEntity: BaseEntity) =>
            typeof relationEntity === 'string'
              ? relationEntity
              : relationEntity.id
        );
      } else {
        // if it is an object, use its id, else the entity is already represented by its as as string, use that immediately
        clone[relation.field] =
          typeof clone[relation.field] === 'string'
            ? clone[relation.field]
            : clone[relation.field].id;
      }
    });
    return clone;
  }

  public createQuery(): Query {
    return new Query(this.definition.filterSortFields || {});
  }

  public abstract getAll(): Promise<T[]>;

  public abstract getByQuery(query: Query): Promise<T[]>;

  public abstract deleteUsingId(id: string): Promise<void>;

  public abstract create(object: Omit<T, 'id'>): Promise<T>;

  public abstract update(object: T): Promise<T>;

  public abstract getByIds(ids: string[]): Promise<T[]>;

  protected abstract queryById(id: string): Promise<T | null>;
}
