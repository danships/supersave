import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  type Collection,
  HookError,
  type HttpContext,
  SuperSave,
} from '../../../../dist/index.js';
import getConnection from '../../../connection.js';
import { planetCollection } from '../../../entities.js';
import { clear } from '../../../mysql.js';
import type { Planet } from '../../../types.js';

beforeEach(clear);

describe('updateBefore hook', () => {
  test('the hook can manipulate a value.', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>({
      ...planetCollection,
      hooks: [
        {
          updateBefore: (
            _collection: Collection,
            _ctx: HttpContext,
            entity: any
          ): any => {
            return {
              ...entity,
              name: `HOOK-${entity.name ?? ''}`,
            };
          },
          entityTransform: (
            _collection: Collection,
            _ctx: HttpContext,
            entity: any
          ): any => {
            return {
              ...entity,
              name: `${entity.name}-TRANSFORM`,
            };
          },
        },
      ],
    });
    app.use('/', superSave.getNodeHandler());

    const planet: Omit<Planet, 'id'> = { name: 'Jupiter' };

    // create the planet
    const createResponse = await supertest(app)
      .post('/planets')
      .send(planet)
      .expect('Content-Type', /json/)
      .expect(200);
    expect(createResponse.body.data.name).toBe(`${planet.name}-TRANSFORM`);

    // update it
    const updateResponse = await supertest(app)
      .patch(`/planets/${createResponse.body.data.id}`)
      .send({ name: planet.name })
      .expect('Content-Type', /json/)
      .expect(200);

    expect(updateResponse.body.data?.name).toBe(
      `HOOK-${planet.name}-TRANSFORM`
    );
  });

  test('the statusCode and message are copied from the exception', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>({
      ...planetCollection,
      hooks: [
        {
          updateBefore: (
            _collection: Collection,
            _ctx: HttpContext,
            _entity: any
          ) => {
            throw new HookError('Test message', 401);
          },
        },
      ],
    });
    app.use('/', superSave.getNodeHandler());

    const planet: Omit<Planet, 'id'> = { name: 'Jupiter' };

    // create
    const createResponse = await supertest(app)
      .post('/planets')
      .send(planet)
      .expect('Content-Type', /json/)
      .expect(200);

    // update
    const response = await supertest(app)
      .patch(`/planets/${createResponse.body.data.id}`)
      .send({ name: 'Updated planet' })
      .expect('Content-Type', /json/)
      .expect(401);

    expect(response.body.message).toBe('Test message');
  });

  test('the message is copied from the exception', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    await superSave.addCollection<Planet>({
      ...planetCollection,
      hooks: [
        {
          updateBefore: (
            _collection: Collection,
            _ctx: HttpContext,
            _entity: any
          ) => {
            throw new HookError('Test message');
          },
        },
      ],
    });
    app.use('/', superSave.getNodeHandler());

    const planet: Omit<Planet, 'id'> = { name: 'Jupiter' };

    const createResponse = await supertest(app)
      .post('/planets')
      .send(planet)
      .expect('Content-Type', /json/)
      .expect(200);

    const updateResponse = await supertest(app)
      .patch(`/planets/${createResponse.body.data.id}`)
      .send(planet)
      .expect('Content-Type', /json/)
      .expect(500);

    expect(updateResponse.body.message).toBe('Test message');
  });
});
