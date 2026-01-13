import http from 'node:http';
import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import { type Repository, SuperSave } from '../../../../build';
import getConnection from '../../../connection';
import { moonCollection, planetCollection } from '../../../entities';
import { clear } from '../../../mysql';
import type { Moon, Planet } from '../../../types';

beforeEach(clear);

describe('Express adapter', () => {
  test('empty collection returns empty array', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>(planetCollection);
    app.use('/', superSave.getNodeHandler());
    await superSave.addCollection<Moon>(moonCollection);

    const response = await supertest(app)
      .get('/planets')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(0);
  });

  test('collection items are returned', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);
    app.use('/', superSave.getNodeHandler());

    await repository.create({ name: 'Earth' });
    const response = await supertest(app)
      .get('/planets')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Earth');
  });

  test('collection items are sorted when requested: ascending', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository: Repository<Planet> =
      await superSave.addCollection<Planet>({
        ...planetCollection,
        filterSortFields: { name: 'string' },
      });
    app.use('/', superSave.getNodeHandler());

    await repository.create({ name: 'Mars' });
    await repository.create({ name: 'Earth' });

    const response = await supertest(app)
      .get('/planets')
      .query({ sort: 'name' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].name).toBe('Earth');
  });

  test('collection items are sorted when requested: descending', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository: Repository<Planet> =
      await superSave.addCollection<Planet>({
        ...planetCollection,
        filterSortFields: { name: 'string' },
      });
    app.use('/', superSave.getNodeHandler());

    await repository.create({ name: 'Mars' });
    await repository.create({ name: 'Earth' });

    const response = await supertest(app)
      .get('/planets')
      .query({ sort: '-name' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].name).toBe('Mars');
  });

  test('collection items are sorted case-insensitive', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository: Repository<Planet> =
      await superSave.addCollection<Planet>({
        ...planetCollection,
        filterSortFields: { name: 'string' },
      });
    app.use('/', superSave.getNodeHandler());

    await repository.create({ name: 'mars' });
    await repository.create({ name: 'Earth' });
    await repository.create({ name: 'venus' });
    await repository.create({ name: 'Z Planet' });

    const response = await supertest(app)
      .get('/planets')
      .query({ sort: 'name' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(4);

    expect(response.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Earth' }),
        expect.objectContaining({ name: 'mars' }),
        expect.objectContaining({ name: 'venus' }),
        expect.objectContaining({ name: 'Z Planet' }),
      ])
    );
  });

  test('undefined sort fields are not accepted.', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>({
      ...planetCollection,
      filterSortFields: { name: 'string' },
    });
    app.use('/', superSave.getNodeHandler());

    await supertest(app)
      .get('/planets')
      .query({ sort: 'foobar' })
      .expect(400)
      .expect('Content-Type', /json/);
  });

  test('offset is honored', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository: Repository<Planet> =
      await superSave.addCollection<Planet>({
        ...planetCollection,
        filterSortFields: { name: 'string' },
      });
    app.use('/', superSave.getNodeHandler());

    await repository.create({ name: 'Mars' });
    await repository.create({ name: 'Earth' });
    await repository.create({ name: 'Venus' });

    const response = await supertest(app)
      .get('/planets')
      .query({ offset: 1, sort: 'name' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].name).toBe('Mars');
    expect(response.body.meta.offset).toBe(1);
    await superSave.close();
  });

  test('limit is honored', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository: Repository<Planet> =
      await superSave.addCollection<Planet>({
        ...planetCollection,
        filterSortFields: { name: 'string' },
      });
    app.use('/', superSave.getNodeHandler());

    await repository.create({ name: 'Mars' });
    await repository.create({ name: 'Earth' });

    const response = await supertest(app)
      .get('/planets')
      .query({ limit: 1, sort: 'name' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Earth');
    expect(response.body.meta.limit).toBe(1);
    await superSave.close();
  });
});

describe('Node HTTP adapter', () => {
  test('collection items are returned', async () => {
    const superSave = await SuperSave.create(getConnection());

    const repository: Repository<Planet> =
      await superSave.addCollection<Planet>(planetCollection);

    await repository.create({ name: 'Earth' });

    const server = http.createServer(superSave.getNodeHandler());

    const response = await supertest(server)
      .get('/planets')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Earth');
    await superSave.close();
  });

  test('sorting works with Node HTTP', async () => {
    const superSave = await SuperSave.create(getConnection());

    const repository: Repository<Planet> =
      await superSave.addCollection<Planet>({
        ...planetCollection,
        filterSortFields: { name: 'string' },
      });

    await repository.create({ name: 'Mars' });
    await repository.create({ name: 'Earth' });

    const server = http.createServer(superSave.getNodeHandler());

    const response = await supertest(server)
      .get('/planets')
      .query({ sort: 'name' })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].name).toBe('Earth');
    await superSave.close();
  });
});
