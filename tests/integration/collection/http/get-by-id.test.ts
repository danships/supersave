import http from 'node:http';
import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import { type Repository, SuperSave } from '../../../../build';
import getConnection from '../../../connection';
import { planetCollection } from '../../../entities';
import { clear } from '../../../mysql';
import type { Planet } from '../../../types';

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
