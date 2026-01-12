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
  test('create item returns created object', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);
    app.use('/', superSave.getNodeHandler());

    const planet: Omit<Planet, 'id'> = { name: 'Jupiter' };

    const response = await supertest(app)
      .post('/planets')
      .send(planet)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(typeof response.body.data).toBe('object');
    expect(response.body.data.name).toBe(planet.name);

    const planets = await planetRepository.getAll();
    expect(planets).toHaveLength(1);
    expect(planets[0].name).toBe(planet.name);
    await superSave.close();
  });
});

describe('Node HTTP adapter', () => {
  test('create item returns created object', async () => {
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);

    const server = http.createServer(superSave.getNodeHandler());

    const planet: Omit<Planet, 'id'> = { name: 'Jupiter' };

    const response = await supertest(server)
      .post('/planets')
      .send(planet)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(typeof response.body.data).toBe('object');
    expect(response.body.data.name).toBe(planet.name);

    const planets = await planetRepository.getAll();
    expect(planets).toHaveLength(1);
    expect(planets[0].name).toBe(planet.name);
    await superSave.close();
  });
});

// TODO test creating with relations
