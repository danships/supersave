import type { IncomingMessage, ServerResponse } from "node:http";
import CollectionHttp from "./collection/http/index.js";
import CollectionManager from "./collection/manager/index.js";
import type { Collection } from "./collection/types.js";
import type { EntityManager } from "./database/entity-manager/index.js";
import type Repository from "./database/entity-manager/repository.js";
import database from "./database/index.js";
import type { BaseEntity, EntityDefinition } from "./database/types.js";

type HandlerType = (request: Request) => Promise<Response>;
type NodeHandlerType = (req: IncomingMessage, res: ServerResponse) => void;

class SuperSave {
  private collectionManager: CollectionManager;

  private collectionHttp?: CollectionHttp;

  private initializedPrefix?: string;

  private constructor(private em: EntityManager) {
    this.collectionManager = new CollectionManager();
  }

  public static async create(connectionString: string): Promise<SuperSave> {
    const em = await database(connectionString);

    return new SuperSave(em);
  }

  public addEntity<T extends BaseEntity>(
    entity: EntityDefinition
  ): Promise<Repository<T>> {
    return this.em.addEntity<T>(entity);
  }

  public async addCollection<T extends BaseEntity>(
    collection: Collection
  ): Promise<Repository<T>> {
    const { filterSortFields = {} } = collection;
    filterSortFields.id = "string";

    const updatedCollection: Collection = {
      ...collection,
      filterSortFields,
    };

    const repository: Repository<T> = await this.addEntity({
      name: updatedCollection.name,
      namespace: updatedCollection.namespace,
      template: updatedCollection.template as Record<string, unknown>,
      relations: updatedCollection.relations,
      filterSortFields: updatedCollection.filterSortFields,
    });
    const managedCollection = { ...updatedCollection, repository };
    this.collectionManager.addCollection(managedCollection);
    if (typeof this.collectionHttp !== "undefined") {
      this.collectionHttp.register(managedCollection);
    }
    return repository;
  }

  public getRepository<T extends BaseEntity>(
    entityName: string,
    namespace?: string
  ): Repository<T> {
    return this.em.getRepository<T>(entityName, namespace);
  }

  private ensureHttpInitialized(prefix = "/"): CollectionHttp {
    const normalizedPrefix =
      prefix.charAt(prefix.length - 1) === "/"
        ? prefix.substring(0, prefix.length - 1)
        : prefix;

    if (typeof this.collectionHttp === "undefined") {
      this.collectionHttp = CollectionHttp.create(
        this.collectionManager,
        normalizedPrefix
      );
      this.initializedPrefix = normalizedPrefix;
    } else if (this.initializedPrefix !== normalizedPrefix) {
      throw new Error(
        `HTTP handler already initialized with prefix "${this.initializedPrefix}". Cannot reinitialize with "${normalizedPrefix}".`
      );
    }
    return this.collectionHttp;
  }

  /**
   * Returns the Web Standard Request/Response handler.
   * Works with Next.js, Bun, Deno, and any environment that supports the Fetch API.
   *
   * @example
   * // Next.js App Router
   * export async function GET(request: Request) {
   *   return superSave.getHandler()(request);
   * }
   */
  public getHandler(prefix = "/"): HandlerType {
    return this.ensureHttpInitialized(prefix).getHandler();
  }

  /**
   * Returns a Node.js http compatible handler.
   * Works with Node's http.createServer and Express.
   *
   * @example
   * // Express
   * app.use('/api', superSave.getNodeHandler());
   *
   * // Node HTTP
   * http.createServer(superSave.getNodeHandler()).listen(3000);
   */
  public getNodeHandler(prefix = "/"): NodeHandlerType {
    return this.ensureHttpInitialized(prefix).getNodeHandler();
  }

  public close(): Promise<void> {
    return this.em.close();
  }

  public getConnection<T>(): T {
    // Force the provided generic to be the return type.
    return this.em.getConnection() as T;
  }
}

export default SuperSave;
