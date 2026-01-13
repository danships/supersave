import express from 'express';
import supertest from 'supertest';
import { beforeEach, expect, test } from 'vitest';
import { type Repository, SuperSave } from '../../../../build';
import getConnection from '../../../connection';
import { planetCollection } from '../../../entities';
import { clear } from '../../../mysql';
import type { Planet } from '../../../types';

beforeEach(clear);

const appForFilter: () => Promise<[express.Application, SuperSave]> =
  async (): Promise<[express.Application, SuperSave]> => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository: Repository<Planet> =
      await superSave.addCollection<Planet>({
        ...planetCollection,
        filterSortFields: { name: 'string', distance: 'number' },
      });

    app.use('/', superSave.getNodeHandler());
    await repository.create({ name: 'Mars', distance: 0 });
    await repository.create({ name: 'Earth', distance: 1000 });
    await repository.create({ name: 'Jupiter', distance: 2500 });

    return [app, superSave];
  };

test('filter on equals', async () => {
  const [app, superSave]: [express.Application, SuperSave] =
    await appForFilter();

  const response = await supertest(app)
    .get('/planets')
    .query({ name: 'Earth' })
    .expect('Content-Type', /json/)
    .expect(200);

  expect(response.body.data).toBeDefined();
  expect(Array.isArray(response.body.data)).toBe(true);
  expect(response.body.data).toHaveLength(1);
  expect(response.body.data[0].name).toBe('Earth');
  await superSave.close();
});

test('filter using gt()', async () => {
  const [app, superSave]: [express.Application, SuperSave] =
    await appForFilter();

  const response = await supertest(app)
    .get('/planets')
    .query({ 'distance[>]': '0' })
    .expect('Content-Type', /json/)
    .expect(200);

  expect(response.body.data).toBeDefined();
  expect(Array.isArray(response.body.data)).toBe(true);
  expect(response.body.data).toHaveLength(2);
  await superSave.close();
});

test('filter using gte()', async () => {
  const [app, superSave]: [express.Application, SuperSave] =
    await appForFilter();

  const response = await supertest(app)
    .get('/planets')
    .query({ 'distance[>=]': '0' })
    .expect('Content-Type', /json/)
    .expect(200);

  expect(response.body.data).toBeDefined();
  expect(Array.isArray(response.body.data)).toBe(true);
  expect(response.body.data).toHaveLength(3);
  await superSave.close();
});

test('filter using gte() with express simple query', async () => {
  const [app, superSave]: [express.Application, SuperSave] =
    await appForFilter();
  app.set('query parser', 'simple');

  const response = await supertest(app)
    .get('/planets')
    .query({ 'distance[>=]': '0' })
    .expect('Content-Type', /json/)
    .expect(200);

  expect(response.body.data).toBeDefined();
  expect(Array.isArray(response.body.data)).toBe(true);
  expect(response.body.data).toHaveLength(3);
  await superSave.close();
});

test('filter using lt()', async () => {
  const [app, superSave]: [express.Application, SuperSave] =
    await appForFilter();

  const response = await supertest(app)
    .get('/planets')
    .query({ 'distance[<]': '0' })
    .expect('Content-Type', /json/)
    .expect(200);

  expect(response.body.data).toBeDefined();
  expect(Array.isArray(response.body.data)).toBe(true);
  expect(response.body.data).toHaveLength(0);
  await superSave.close();
});

test('filter using lte()', async () => {
  const [app, superSave]: [express.Application, SuperSave] =
    await appForFilter();

  const response = await supertest(app)
    .get('/planets')
    .query({ 'distance[<=]': '0' })
    .expect('Content-Type', /json/)
    .expect(200);

  expect(response.body.data).toBeDefined();
  expect(Array.isArray(response.body.data)).toBe(true);
  expect(response.body.data).toHaveLength(1);
  await superSave.close();
});

test('filter using like()', async () => {
  const [app, superSave]: [express.Application, SuperSave] =
    await appForFilter();

  const response = await supertest(app)
    .get('/planets')
    .query({ 'name[~]': '*art*' })
    .expect('Content-Type', /json/)
    .expect(200);

  expect(response.body.data).toBeDefined();
  expect(Array.isArray(response.body.data)).toBe(true);
  expect(response.body.data).toHaveLength(1);
  expect(response.body.data[0].name).toBe('Earth');
  await superSave.close();
});

test('filter using in()', async () => {
  const [app, superSave]: [express.Application, SuperSave] =
    await appForFilter();

  const response = await supertest(app)
    .get('/planets')
    .query({ 'name[in]': 'Earth,Mars' })
    .expect('Content-Type', /json/)
    .expect(200);

  expect(response.body.data).toBeDefined();
  expect(Array.isArray(response.body.data)).toBe(true);
  expect(response.body.data).toHaveLength(2);
  await superSave.close();
});

test('not existing filters', async () => {
  const [app, superSave]: [express.Application, SuperSave] =
    await appForFilter();

  const response = await supertest(app)
    .get('/planets')
    .query({ foo: 'bar' })
    .expect('Content-Type', /json/)
    .expect(400);

  expect(response.body.message).toBeDefined();
  expect(response.body.message).toBe('Cannot filter on not defined field foo.');
  await superSave.close();
});
