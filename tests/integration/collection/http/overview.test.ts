import http from 'node:http';
import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import { SuperSave } from '../../../../dist/index.js';
import getConnection from '../../../connection.js';
import { moonCollection, planetCollection } from '../../../entities.js';
import { clear } from '../../../mysql.js';
import type { Moon, Planet } from '../../../types.js';

beforeEach(clear);

describe('Express adapter', () => {
  test('only collections with no namespace returns array', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>(planetCollection);
    app.use('/', superSave.getNodeHandler());
    await superSave.addCollection<Moon>(moonCollection);

    const response = await supertest(app)
      .get('/')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data[0].name).toBe(planetCollection.name);
    expect(response.body.data[1].name).toBe(moonCollection.name);
    await superSave.close();
  });

  test('collections with namespace', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>({
      ...planetCollection,
      namespace: 'space',
    });
    app.use('/', superSave.getNodeHandler());
    await superSave.addCollection<Moon>({
      ...moonCollection,
      namespace: 'space',
    });

    const response = await supertest(app)
      .get('/')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data['/space']).toBeDefined();
    expect(Array.isArray(response.body.data['/space'])).toBe(true);
    expect(response.body.data['/space'][0].name).toBe(planetCollection.name);
    expect(response.body.data['/space'][1].name).toBe(moonCollection.name);
    await superSave.close();
  });

  test('additional collection properties are returned', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>({
      ...planetCollection,
      additionalProperties: { foo: 'bar' },
    });
    app.use('/', superSave.getNodeHandler());
    await superSave.addCollection<Moon>(moonCollection);

    const response = await supertest(app)
      .get('/')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data[0].name).toBe(planetCollection.name);
    expect(response.body.data[0].foo).toBeDefined();
    expect(response.body.data[0].foo).toBe('bar');
    await superSave.close();
  });
});

describe('Node HTTP adapter', () => {
  test('collections are returned', async () => {
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>(planetCollection);
    await superSave.addCollection<Moon>(moonCollection);

    const server = http.createServer(superSave.getNodeHandler());

    const response = await supertest(server)
      .get('/')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data[0].name).toBe(planetCollection.name);
    expect(response.body.data[1].name).toBe(moonCollection.name);
    await superSave.close();
  });
});
