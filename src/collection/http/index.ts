import type { IncomingMessage, ServerResponse } from "node:http";
import { createEndpoint, createRouter } from "better-call";
import { toNodeHandler } from "better-call/node";
import type Manager from "../manager/index.js";
import type { ManagedCollection } from "../types.js";
import * as actions from "./actions/index.js";
import { generatePath } from "./utils/index.js";

type RouterType = ReturnType<typeof createRouter>;
type HandlerType = (request: Request) => Promise<Response>;
type NodeHandlerType = (req: IncomingMessage, res: ServerResponse) => void;
type EndpointRecord = Record<string, any>;

class Http {
  private router!: RouterType;

  public static create(manager: Manager, prefix: string): Http {
    return new Http(manager, prefix);
  }

  private constructor(private manager: Manager, private prefix: string) {
    this.buildRouter();
  }

  private buildRouter(): void {
    const endpoints: EndpointRecord = {};

    // Add overview endpoint
    const overviewHandler = actions.overview(this.prefix, () =>
      this.getRegisteredCollections()
    );
    endpoints.overview = createEndpoint("/", { method: "GET" }, async () =>
      overviewHandler()
    );

    // Add endpoints for each collection
    this.manager.getCollections().forEach((collection: ManagedCollection) => {
      const path = generatePath(collection);
      // Use char code encoding to preserve uniqueness and prevent collisions
      const safeName = collection.name.replace(
        /[^a-zA-Z0-9]/g,
        (char) => `_${char.charCodeAt(0)}_`
      );
      const namespace = collection.namespace ? `${collection.namespace}_` : "";

      const baseKey = `${namespace}${safeName}`;
      if (endpoints[`${baseKey}_get`]) {
        throw new Error(
          `Endpoint key collision detected for collection "${collection.name}"`
        );
      }

      // GET /collection - list items
      endpoints[`${baseKey}_get`] = createEndpoint(
        path,
        { method: "GET" },
        actions.get(collection)
      );

      // POST /collection - create item
      endpoints[`${baseKey}_create`] = createEndpoint(
        path,
        { method: "POST" },
        actions.create(collection)
      );

      // GET /collection/:id - get item by id
      endpoints[`${baseKey}_getById`] = createEndpoint(
        `${path}/:id`,
        { method: "GET" },
        actions.getById(collection)
      );

      // PATCH /collection/:id - update item by id
      endpoints[`${baseKey}_updateById`] = createEndpoint(
        `${path}/:id`,
        { method: "PATCH" },
        actions.updateById(collection)
      );

      // DELETE /collection/:id - delete item by id
      endpoints[`${baseKey}_deleteById`] = createEndpoint(
        `${path}/:id`,
        { method: "DELETE" },
        actions.deleteById(collection)
      );
    });

    this.router = createRouter(endpoints);
  }

  public register(_collection: ManagedCollection): Http {
    // Rebuild the router when a new collection is added
    this.buildRouter();
    return this;
  }

  public getRegisteredCollections(): ManagedCollection[] {
    return this.manager.getCollections();
  }

  /**
   * Returns the Web Standard Request/Response handler.
   * Works with Next.js, Bun, Deno, and any environment that supports the Fetch API.
   */
  public getHandler(): HandlerType {
    return this.router.handler;
  }

  /**
   * Returns a Node.js http compatible handler.
   * Works with Node's http.createServer and Express.
   */
  public getNodeHandler(): NodeHandlerType {
    return toNodeHandler(this.router.handler);
  }
}

export default Http;
