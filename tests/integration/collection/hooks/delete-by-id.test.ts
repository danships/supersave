import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  type Collection,
  HookError,
  type HttpContext,
  type Repository,
  SuperSave,
} from '../../../../dist/index.js';
import getConnection from '../../../connection.js';
import { planetCollection } from '../../../entities.js';
import { clear } from '../../../mysql.js';
import type { Planet } from '../../../types.js';

beforeEach(clear);

describe('deleteBefore', () => {
  test.each([
    undefined,
    401,
  ])('delete is blocked by an exception', async (statusCode?: number) => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>({
        ...planetCollection,
        hooks: [
          {
            deleteBefore: (
              _collection: Collection,
              _ctx: HttpContext,
              _entity: any
            ) => {
              throw new HookError('Test message', statusCode);
            },
          },
        ],
      });
    const planet = await planetRepository.create({ name: 'Earth' });
    app.use('/', superSave.getNodeHandler());

    await supertest(app)
      .delete(`/planets/${planet.id as string}`)
      .expect(statusCode ?? 500);

    const allPlanets = await planetRepository.getAll();
    expect(allPlanets).toHaveLength(1);
    await superSave.close();
  });
});
