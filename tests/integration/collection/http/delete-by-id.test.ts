import http from 'node:http';
import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import { type Repository, SuperSave } from '../../../../dist/index.js';
import getConnection from '../../../connection.js';
import { planetCollection } from '../../../entities.js';
import { clear } from '../../../mysql.js';
import type { Planet } from '../../../types.js';

beforeEach(clear);

describe('Express adapter', () => {
  test('delete using id', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);
    const planet = await planetRepository.create({ name: 'Earth' });
    app.use('/', superSave.getNodeHandler());

    await supertest(app)
      .delete(`/planets/${planet.id as string}`)
      .expect(204);

    const allPlanets = await planetRepository.getAll();
    expect(allPlanets).toHaveLength(0);
    await superSave.close();
  });

  test('delete not existing item', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>(planetCollection);
    app.use('/', superSave.getNodeHandler());

    await supertest(app).delete('/planets/foo').expect(204);
    await superSave.close();
  });
});

describe('Node HTTP adapter', () => {
  test('delete using id', async () => {
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);
    const planet = await planetRepository.create({ name: 'Earth' });

    const server = http.createServer(superSave.getNodeHandler());

    await supertest(server)
      .delete(`/planets/${planet.id as string}`)
      .expect(204);

    const allPlanets = await planetRepository.getAll();
    expect(allPlanets).toHaveLength(0);
    await superSave.close();
  });
});
