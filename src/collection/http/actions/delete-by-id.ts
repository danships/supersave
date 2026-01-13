import type { Debugger } from "debug";
import Debug from "debug";
import type { HttpContext, ManagedCollection } from "../../types.js";

const debug: Debugger = Debug("supersave:http:deleteById");

export default (collection: ManagedCollection) =>
  async (ctx: any): Promise<Response> => {
    const { id } = ctx.params as { id: string };
    const { repository } = collection;

    const httpContext: HttpContext = {
      params: { id },
      query: {},
      body: {},
      headers: ctx.headers ?? {},
      request: ctx.request,
    };

    try {
      // Use this one-liner to determine if there are any hooks to run.
      const deleteHooks = (collection.hooks || [])
        .map((hooks) => hooks.deleteBefore)
        .filter((deleteBefore) => typeof deleteBefore !== "undefined");

      if (deleteHooks.length > 0) {
        const item = await repository.getById(id);
        if (item === null) {
          throw ctx.error("NOT_FOUND", { message: "Not found", meta: { id } });
        }
        for (const hooks of collection.hooks || []) {
          if (hooks.deleteBefore) {
            try {
              await hooks.deleteBefore(
                collection,
                httpContext,
                item as Parameters<NonNullable<typeof hooks.deleteBefore>>[2]
              );
            } catch (error: unknown) {
              debug("Error thrown in deleteBeforeHook %o", error);
              const code =
                (error as { statusCode?: number })?.statusCode ?? 500;
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
      }

      await repository.deleteUsingId(id);
      debug("Deleted from", collection.name, id);
      // Return 204 No Content
      return new Response(null, { status: 204 });
    } catch (error) {
      debug("Error while deleting item. %o", error);
      if ((error as { status?: unknown })?.status) {
        throw error; // Re-throw API errors
      }
      throw ctx.error("INTERNAL_SERVER_ERROR", {
        message: (error as Error).message,
      });
    }
  };
