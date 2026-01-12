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
  test('update item returns updated object', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);
    app.use('/', superSave.getNodeHandler());

    const planet: Omit<Planet, 'id'> = { name: 'Jupiter' };
    const savedPlanet: Planet = await planetRepository.create(planet);

    const response = await supertest(app)
      .patch(`/planets/${savedPlanet.id}`)
      .send({ name: 'Jupiter 2' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(typeof response.body.data).toBe('object');
    expect(response.body.data.name).toBe('Jupiter 2');

    const checkPlanet: Planet | null = await planetRepository.getById(
      savedPlanet.id
    );
    expect(checkPlanet).not.toBeNull();
    expect((checkPlanet as Planet).name).toBe('Jupiter 2');
  });
});

describe('Node HTTP adapter', () => {
  test('update item returns updated object', async () => {
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);

    const planet: Omit<Planet, 'id'> = { name: 'Jupiter' };
    const savedPlanet: Planet = await planetRepository.create(planet);

    const server = http.createServer(superSave.getNodeHandler());

    const response = await supertest(server)
      .patch(`/planets/${savedPlanet.id}`)
      .send({ name: 'Jupiter 2' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(typeof response.body.data).toBe('object');
    expect(response.body.data.name).toBe('Jupiter 2');

    const checkPlanet: Planet | null = await planetRepository.getById(
      savedPlanet.id
    );
    expect(checkPlanet).not.toBeNull();
    expect((checkPlanet as Planet).name).toBe('Jupiter 2');
    await superSave.close();
  });
});

// TODO test updating with relation
