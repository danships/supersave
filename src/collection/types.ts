import type { Repository } from '../database/entity-manager/index.js';
import type { FilterSortField, Relation } from '../database/types.js';

export type HttpContext = {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  request?: Request;
};

export type HttpCollection = {
  name: string;
  description?: string;
  endpoint: string;

  [key: string]: unknown;
};

export type Collection = {
  name: string;
  description?: string;
  namespace?: string;

  template: unknown;
  relations: Relation[];
  filterSortFields?: Record<string, FilterSortField>;

  additionalProperties?: Record<string, unknown>;
  hooks?: Hooks[];
};

export interface ManagedCollection<T = unknown> extends Collection {
  repository: Repository<T>;
}

export type Hooks = {
  get?: (collection: Collection, ctx: HttpContext) => Promise<void> | void;
  getById?: <T>(
    collection: Collection,
    ctx: HttpContext,
    entity: T | null
  ) => Promise<T> | T;
  entityTransform?: <IN, OUT>(
    collection: Collection,
    ctx: HttpContext,
    entity: IN
  ) => Promise<OUT> | OUT;
  updateBefore?: <IN, OUT>(
    collection: Collection,
    ctx: HttpContext,
    entity: Partial<IN>
  ) => Promise<OUT> | OUT;
  createBefore?: <IN, OUT>(
    collection: Collection,
    ctx: HttpContext,
    entity: Omit<IN, 'id'>
  ) => Promise<OUT> | OUT;
  deleteBefore?: <T>(
    collection: Collection,
    ctx: HttpContext,
    item: T | null
  ) => Promise<void> | void;
};
