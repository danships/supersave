import pluralize from 'pluralize';
import type { ManagedCollection } from '../../types.js';

export const generatePath = (collection: ManagedCollection): string =>
  `/${collection.namespace ? `${collection.namespace}/` : ''}${pluralize(collection.name)}`
    .toLowerCase()
    .replace(/\s/g, '-');
