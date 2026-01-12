import type { Debugger } from 'debug';
import Debug from 'debug';
import type { Query } from '../../../database/entity-manager/index.js';
import type { FilterSortField } from '../../../database/types.js';
import { QueryOperatorEnum } from '../../../database/types.js';
import type { HttpContext, ManagedCollection } from '../../types.js';
import transform from './utils/index.js';

const debug: Debugger = Debug('supersave:http:get');

function sort(query: Query, sortRequest: string): void {
  const sorts = sortRequest.split(',');
  sorts.forEach((sortField: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    let parsedSortField = sortField;

    if (sortField.startsWith('-')) {
      parsedSortField = sortField.substring(1);
      direction = 'desc';
    }
    query.sort(parsedSortField, direction);
  });
}

function filter(
  collection: ManagedCollection,
  query: Query,
  filters: Record<string, string>
): void {
  if (Object.keys(filters).length === 0) {
    return;
  }
  if (!collection.filterSortFields) {
    throw new Error(
      'There are no fields available to filter on, while filters were provided.'
    );
  }

  const filterSortFields: Record<string, FilterSortField> =
    collection.filterSortFields;
  Object.entries(filters).forEach(([field, value]: [string, string]) => {
    const matches: string[] | null = (field || '').match(/(.*)\[(.*)\]$/);
    if (matches === null || matches.length !== 3) {
      if (
        collection.filterSortFields &&
        collection.filterSortFields[field] === 'boolean'
      ) {
        query.eq(field, ['1', 1, 'true', true].includes(value));
      } else {
        query.eq(field, value);
      }
      return;
    }

    const filteredField: string = matches[1];
    const operator: string = matches[2];

    if (!filterSortFields[filteredField]) {
      throw new Error(`${filteredField} is not a field you can filter on.`);
    }

    switch (operator) {
      case QueryOperatorEnum.EQUALS: {
        query.eq(filteredField, value);
        break;
      }
      case QueryOperatorEnum.GREATER_THAN: {
        query.gt(filteredField, value);
        break;
      }
      case QueryOperatorEnum.GREATER_THAN_EQUALS: {
        query.gte(filteredField, value);
        break;
      }
      case QueryOperatorEnum.LESS_THAN: {
        query.lt(filteredField, value);
        break;
      }
      case QueryOperatorEnum.LESS_THAN_EQUALS: {
        query.lte(filteredField, value);
        break;
      }
      case 'in': {
        query.in(filteredField, value.split(','));
        break;
      }
      case '~': {
        query.like(filteredField, value);
        break;
      }
      default:
        throw new Error(
          `Unrecognized operator ${operator} for filteredField ${filteredField}.`
        );
    }
  });
}

function limitOffset(query: Query, params: Record<string, string>): void {
  const { limit = '25', offset = '0' } = params;
  if (limit === '-1') {
    query.limit(undefined);
  } else {
    query.limit(parseInt(limit, 10) || 25);
  }

  query.offset(parseInt(offset, 10) || 0);
}

export default (collection: ManagedCollection) =>
  async (ctx: any): Promise<{ data: unknown[]; meta: unknown }> => {
    const queryParams = (ctx.query || {}) as Record<string, string>;

    const httpContext: HttpContext = {
      params: {},
      query: queryParams,
      body: {},
      headers: {},
      request: ctx.request,
    };

    // hook
    for (const hooks of collection.hooks || []) {
      if (hooks.get) {
        try {
          await hooks.get(collection, httpContext);
        } catch (error: unknown) {
          debug('Error thrown in getHook %o', error);
          const code = (error as { statusCode?: number })?.statusCode ?? 500;
          const status =
            code === 400
              ? 'BAD_REQUEST'
              : code === 401
                ? 'UNAUTHORIZED'
                : code === 403
                  ? 'FORBIDDEN'
                  : code === 404
                    ? 'NOT_FOUND'
                    : 'INTERNAL_SERVER_ERROR';
          throw ctx.error(status, { message: (error as Error).message });
        }
      }
    }

    const query: Query = collection.repository.createQuery();
    if (queryParams.sort) {
      try {
        sort(query, queryParams.sort);
      } catch (error) {
        throw ctx.error('BAD_REQUEST', { message: (error as Error).message });
      }
    }

    const filters: Record<string, string> = {};

    Object.entries(queryParams).forEach(([field, value]: [string, string]) => {
      if (field === 'sort' || field === 'limit' || field === 'offset') {
        return;
      }
      filters[field] = value;
    });

    try {
      filter(collection, query, filters);
    } catch (error) {
      throw ctx.error('BAD_REQUEST', { message: (error as Error).message });
    }

    try {
      limitOffset(query, queryParams);
      let items = await collection.repository.getByQuery(query);

      // transform hook
      try {
        items = (await Promise.all(
          items.map(async (item) => transform(collection, httpContext, item))
        )) as typeof items;
      } catch (error: unknown) {
        debug('Error thrown in get transform %o', error);
        const code = (error as { statusCode?: number })?.statusCode ?? 500;
        const status =
          code === 400
            ? 'BAD_REQUEST'
            : code === 401
              ? 'UNAUTHORIZED'
              : code === 403
                ? 'FORBIDDEN'
                : code === 404
                  ? 'NOT_FOUND'
                  : 'INTERNAL_SERVER_ERROR';
        throw ctx.error(status, { message: (error as Error).message });
      }

      return {
        data: items,
        meta: {
          sort: query.getSort(),
          limit: query.getLimit(),
          filters: query.getWhere(),
          offset: query.getOffset(),
        },
      };
    } catch (error) {
      debug('Unexpected error while querying collection.', error);
      if ((error as { status?: unknown })?.status) {
        throw error; // Re-throw API errors
      }
      throw ctx.error('INTERNAL_SERVER_ERROR', {
        message: 'An unexpected error occurred, try again later.',
      });
    }
  };
