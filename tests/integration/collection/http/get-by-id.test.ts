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
  test('Existing id returns object', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);
    const planet = await planetRepository.create({ name: 'Earth' });
    app.use('/', superSave.getNodeHandler());

    const response = await supertest(app)
      .get(`/planets/${planet.id as string}`)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toEqual(planet);
    await superSave.close();
  });
});

describe('Node HTTP adapter', () => {
  test('Existing id returns object', async () => {
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);
    const planet = await planetRepository.create({ name: 'Earth' });

    const server = http.createServer(superSave.getNodeHandler());

    const response = await supertest(server)
      .get(`/planets/${planet.id as string}`)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toEqual(planet);
    await superSave.close();
  });
});
