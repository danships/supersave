import type { Debugger } from "debug";
import Debug from "debug";
import type { HttpContext, ManagedCollection } from "../../types.js";
import transform from "./utils/index.js";

const debug: Debugger = Debug("supersave:http:getById");

export default (collection: ManagedCollection) =>
  async (ctx: any): Promise<{ data: unknown }> => {
    const { id } = ctx.params as { id: string };
    const { repository } = collection;

    const httpContext: HttpContext = {
      params: { id },
      query: {},
      body: {},
      headers: {},
      request: ctx.request,
    };

    try {
      let item = await repository.getById(id);

      // hook
      for (const hooks of collection.hooks || []) {
        if (hooks.getById) {
          try {
            item = await hooks.getById(collection, httpContext, item);
          } catch (error: unknown) {
            debug("Error thrown in getById hook %o", error);
            const code = (error as { statusCode?: number })?.statusCode ?? 500;
            const status =
              code === 400
                ? "BAD_REQUEST"
                : code === 401
                ? "UNAUTHORIZED"
                : code === 403
                ? "FORBIDDEN"
                : code === 404
                ? "NOT_FOUND"
                : "INTERNAL_SERVER_ERROR";
            throw ctx.error(status, { message: (error as Error).message });
          }
        }
      }

      if (item === null) {
        throw ctx.error("NOT_FOUND", { message: "Not found", meta: { id } });
      }

      // transform hook
      try {
        item = await transform(collection, httpContext, item);
      } catch (error: unknown) {
        debug("Error thrown in getById transformHook %o", error);
        const code = (error as { statusCode?: number })?.statusCode ?? 500;
        const status =
          code === 400
            ? "BAD_REQUEST"
            : code === 401
            ? "UNAUTHORIZED"
            : code === 403
            ? "FORBIDDEN"
            : code === 404
            ? "NOT_FOUND"
            : "INTERNAL_SERVER_ERROR";
        throw ctx.error(status, { message: (error as Error).message });
      }

      return { data: item };
    } catch (error) {
      debug("Error while fetching item with id %s, %o", id, error);
      if ((error as { status?: unknown })?.status) {
        throw error; // Re-throw API errors
      }
      throw ctx.error("INTERNAL_SERVER_ERROR", {
        message: (error as Error).message,
      });
    }
  };
