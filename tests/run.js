import express from 'express';
import { SuperSave } from '../dist/index.js';

const planetEntity = {
  name: 'planet',
  template: {
    name: '',
  },
  relations: [],
  filterSortFields: {
    name: 'string',
  },
};

const planetCollection = {
  name: 'planet',
  template: planetEntity.template,
  relations: planetEntity.relations,
  filterSortFields: planetEntity.filterSortFields,
};

const moonEntity = {
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

const moonCollection = {
  name: 'moon',
  template: moonEntity.template,
  relations: moonEntity.relations,
};

const main = async () => {
  const connectionString = process.env.CONN || 'sqlite://memory:';
  const superSave = await SuperSave.create(connectionString);

  await superSave.addCollection(planetCollection);
  await superSave.addCollection(moonCollection);

  const app = express();
  const port = process.env.PORT || 4567;

  app.use('/api', superSave.getNodeHandler());

  app.listen(port, () => {
    // biome-ignore lint/suspicious/noConsole: It's a test file.
    console.log(`Test server listening at http://0.0.0.0:${port}`);
  });
};

main();
