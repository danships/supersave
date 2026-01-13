import type { HttpCollection, ManagedCollection } from '../../types.js';
import { generatePath } from '../utils/index.js';

export default (
  prefix: string,
  getRegisteredCollections: () => ManagedCollection[]
) =>
  (): { data: HttpCollection[] | Record<string, HttpCollection[]> } => {
    const output: { [key: string]: HttpCollection[] } = {};

    const collections = getRegisteredCollections();
    collections.forEach((collection: ManagedCollection) => {
      const path = generatePath(collection);
      const namespace = collection.namespace ? `/${collection.namespace}` : '/';

      if (Array.isArray(output[namespace]) === false) {
        output[namespace] = [];
      }
      output[namespace].push({
        name: collection.name,
        description: collection.description,
        endpoint: `${prefix}${path}`,
        filters: collection.filterSortFields,
        sort: Object.keys(collection.filterSortFields || {}),
        ...(collection.additionalProperties || {}),
      });
    });

    if (
      Object.keys(output).length === 1 &&
      typeof output['/'] !== 'undefined'
    ) {
      return { data: output['/'] };
    }

    return { data: output };
  };
