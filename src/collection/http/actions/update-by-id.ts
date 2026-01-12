import type { Debugger } from 'debug';
import Debug from 'debug';
import type { HttpContext, ManagedCollection } from '../../types.js';
import transform from './utils/index.js';

const debug: Debugger = Debug('supersave:http:updateById');

export default (collection: ManagedCollection) =>
  async (ctx: any): Promise<{ data: unknown }> => {
    const { id } = ctx.params as { id: string };
    const { repository } = collection;
    const body = ctx.body as Record<string, unknown>;

    const httpContext: HttpContext = {
      params: { id },
      query: {},
      body,
      headers: {},
      request: ctx.request,
    };

    try {
      const item = await repository.getById(id);
      if (item === null) {
        throw ctx.error('NOT_FOUND', { message: 'Not Found' });
      }

      debug('Incoming update request', body);
      collection.relations.forEach((relation) => {
        if (body[relation.field]) {
          const fieldValue = body[relation.field] as unknown[];
          if (
            relation.multiple &&
            Array.isArray(fieldValue) &&
            fieldValue.length > 0
          ) {
            // check if an array of strings was provided, if so, we translate it to an array of empty objects with the id attribute set.
            if (typeof fieldValue[0] === 'string') {
              body[relation.field] = fieldValue.map((relationId: unknown) => ({
                id: relationId,
              }));
            }
          } else if (
            !relation.multiple &&
            typeof body[relation.field] === 'string'
          ) {
            // the relation is provided as a string, map it to an empty object with an id attribute.
            body[relation.field] = {
              id: body[relation.field],
            };
          }
        }
      });

      let updatedEntity = {
        ...(item as Record<string, unknown>),
        ...body,
      };
      debug('Updating entity.', updatedEntity);

      let updatedResult: unknown;

      for (const hooks of collection.hooks || []) {
        if (hooks.updateBefore) {
          try {
            updatedEntity = (await hooks.updateBefore(
              collection,
              httpContext,
              updatedEntity
            )) as typeof updatedEntity;
          } catch (error: unknown) {
            debug('Error thrown in updateBeforeHook %o', error);
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
      updatedResult = await collection.repository.update(
        updatedEntity as Parameters<typeof collection.repository.update>[0]
      );

      // transform hook
      try {
        updatedResult = await transform(collection, httpContext, updatedResult);
      } catch (error: unknown) {
        debug('Error thrown in updateById transform %o', error);
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

      return { data: updatedResult };
    } catch (error) {
      debug('Error while storing item. %o', error);
      if ((error as { status?: unknown })?.status) {
        throw error; // Re-throw API errors
      }
      throw ctx.error('INTERNAL_SERVER_ERROR', {
        message: (error as Error).message,
      });
    }
  };
