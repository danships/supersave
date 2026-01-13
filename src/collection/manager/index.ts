// import { Repository } from "../../database/EntityManager";
import type { ManagedCollection } from '../types.js';

class Manager {
  private collections: Map<string, ManagedCollection<any>>;

  constructor() {
    this.collections = new Map<string, ManagedCollection<any>>();
  }

  private getCollectionIdentifier(name: string, namespace?: string): string {
    return namespace ? `${namespace}_${name}` : name;
  }

  public addCollection<T>(collection: ManagedCollection<T>): Manager {
    this.collections.set(
      this.getCollectionIdentifier(collection.name, collection.namespace),
      collection
    );
    return this;
  }

  public getCollections(): ManagedCollection<any>[] {
    return [...this.collections.values()];
  }
}

export default Manager;
