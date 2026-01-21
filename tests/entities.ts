import type { Collection, EntityDefinition } from '../dist/index.js';

export const planetEntity: EntityDefinition = {
  name: 'planet',
  template: {
    name: '',
  },
  relations: [],
};

export const planetCollection: Collection = {
  name: 'planet',
  template: planetEntity.template,
  relations: planetEntity.relations,
};

export const moonEntity: EntityDefinition = {
  name: 'moon',
  template: {
    name: '',
  },
  relations: [
    {
      name: 'planet',
      field: 'planet',
      multiple: false,
    },
  ],
};

export const moonCollection: Collection = {
  name: 'moon',
  template: moonEntity.template,
  relations: moonEntity.relations,
};
