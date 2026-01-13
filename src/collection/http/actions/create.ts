import type { Debugger } from 'debug';
import Debug from 'debug';
import type { HttpContext, ManagedCollection } from '../../types.js';
import transform from './utils/index.js';

const debug: Debugger = Debug('supersave:http:create');

export default (collection: ManagedCollection) =>
  async (ctx: any): Promise<{ data: unknown }> => {
    const body = ctx.body as Record<string, unknown>;

    if (typeof body !== 'object' || body === null) {
      throw ctx.error('BAD_REQUEST', {
        message: 'Request body is not an object.',
      });
    }

    collection.relations.forEach((relation) => {
      if (body[relation.field]) {
        if (relation.multiple && !Array.isArray(body[relation.field])) {
          throw ctx.error('BAD_REQUEST', {
            message: `Attribute ${relation.field} is a relation for multiple entities, but no array is provided.`,
          });
        } else if (relation.multiple) {
          const fieldValue = body[relation.field] as unknown[];
          if (typeof fieldValue[0] === 'string') {
            body[relation.field] = fieldValue.map((id: unknown) => ({
              id,
            }));
          }
        } else if (!relation.multiple) {
          if (typeof body[relation.field] === 'string') {
            body[relation.field] = {
              id: body[relation.field],
            };
          }
        }
      }
    });

    let item: unknown;
    let itemBody = body;

    const httpContext: HttpContext = {
      params: {},
      query: {},
      body,
      headers: ctx.headers ?? {},
      request: ctx.request,
    };

    for (const hooks of collection.hooks || []) {
      if (hooks.createBefore) {
        try {
          itemBody = (await hooks.createBefore(
            collection,
            httpContext,
            itemBody
          )) as Record<string, unknown>;
        } catch (error) {
          debug('Error thrown in createBeforeHook %o', error);
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

    try {
      item = await collection.repository.create(
        itemBody as Parameters<typeof collection.repository.create>[0]
      );
      debug('Created collection item');

      // transform hook
      try {
        item = await transform(collection, httpContext, item);
      } catch (error: unknown) {
        debug('Error thrown in create transformHook %o', error);
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

      return { data: item };
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
