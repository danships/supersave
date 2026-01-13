import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  type Collection,
  HookError,
  type HttpContext,
  SuperSave,
} from '../../../../build';
import getConnection from '../../../connection';
import { planetCollection } from '../../../entities';
import { clear } from '../../../mysql';
import type { Planet } from '../../../types';

beforeEach(clear);

describe('getHook', () => {
  test('get hook can manipulate filter', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository = await superSave.addCollection<Planet>({
      ...planetCollection,
      hooks: [
        {
          get: (_collection: Collection, ctx: HttpContext) => {
            // Modify the query to filter by a non-existing id
            ctx.query.id = 'non-existing-id';
          },
        },
      ],
    });
    await repository.create({ name: 'Earth' });
    app.use('/', superSave.getNodeHandler());

    const response = await supertest(app)
      .get('/planets')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data).toHaveLength(0);
  });

  test('transform hook changes entity', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository = await superSave.addCollection<Planet>({
      ...planetCollection,
      hooks: [
        {
          entityTransform: (
            _collection: Collection,
            _ctx: HttpContext,
            entity: any
          ): any => {
            return {
              ...entity,
              extra: true,
            };
          },
        },
      ],
    });
    await repository.create({ name: 'Earth' });
    app.use('/', superSave.getNodeHandler());

    const response = await supertest(app)
      .get('/planets')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data).toBeDefined();
    expect(response.body.data[0].extra).toBe(true);
  });

  test('thrown error with status code is returned', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const repository = await superSave.addCollection<Planet>({
      ...planetCollection,
      hooks: [
        {
          get: (_collection: Collection, _ctx: HttpContext) => {
            throw new HookError('Test message', 401);
          },
        },
      ],
    });
    await repository.create({ name: 'Earth' });
    app.use('/', superSave.getNodeHandler());

    const response = await supertest(app)
      .get('/planets')
      .expect('Content-Type', /json/)
      .expect(401);

    expect(response.body.message).toBe('Test message');
  });
});
