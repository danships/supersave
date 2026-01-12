import express from 'express';
import supertest from 'supertest';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  type Collection,
  type HttpContext,
  type Repository,
  SuperSave,
} from '../../../../build';
import getConnection from '../../../connection';
import { planetCollection } from '../../../entities';
import { clear } from '../../../mysql';
import type { Planet } from '../../../types';

beforeEach(clear);

describe('getById Hook', () => {
  test('Hook returns manipulated object', async () => {
    const app: express.Application = express();
    const superSave = await SuperSave.create(getConnection());

    const planetRepository: Repository<Planet> =
      await superSave.addCollection<Planet>({
        ...planetCollection,
        hooks: [
          {
            getById: (
              _collection: Collection,
              _ctx: HttpContext,
              entity: any
            ) => {
              return {
                ...entity,
                name: `HOOK-${entity.name}`,
              };
            },
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
          {
            entityTransform: (
              _collection: Collection,
              _ctx: HttpContext,
              entity: any
            ): any => {
              return {
                ...entity,
                name: `2ND - ${entity.name}`,
              };
            },
          },
        ],
      });
    const planet = await planetRepository.create({ name: 'Earth' });
    app.use('/', superSave.getNodeHandler());

    const response = await supertest(app)
      .get(`/planets/${planet.id as string}`)
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body.data.name).toEqual(`2ND - HOOK-${planet.name}`);
    expect(response.body.data.extra).toBe(true);
    await superSave.close();
  });
});
