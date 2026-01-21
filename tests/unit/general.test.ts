import { beforeEach, expect, test } from 'vitest';
import {
  type EntityDefinition,
  type Repository,
  SuperSave,
} from '../../dist/index.js';
import getConnection from '../connection.js';
import { moonEntity, planetEntity } from '../entities.js';
import { clear } from '../mysql.js';
import type { Moon, Planet } from '../types.js';

beforeEach(clear);

test('simple entity creation', async () => {
  const superSave = await SuperSave.create(getConnection());
  const planetRepository: Repository<Planet> =
    await superSave.addEntity<Planet>(planetEntity);

  const earth: Planet = await planetRepository.create({ name: 'Earth' });
  const mars: Planet = await planetRepository.create({ name: 'Mars' });

  expect(earth.name).toEqual('Earth');
  expect(mars.name).toEqual('Mars');
});

test('entity with relations', async () => {
  const superSave = await SuperSave.create(getConnection());
  const moonRepository: Repository<Moon> =
    await superSave.addEntity<Moon>(moonEntity);
  const planetRepository: Repository<Planet> =
    await superSave.addEntity<Planet>(planetEntity);

  await planetRepository.create({ name: 'Earth' });
  await planetRepository.create({ name: 'Mars' });

  const planets = await planetRepository.getAll();
  expect(planets).toHaveLength(2);

  const earth = planets[0].name === 'Earth' ? planets[0] : planets[1]; // Sorting is undetermined

  const earthMoon: Moon = await moonRepository.create({
    name: 'Moon',
    planet: earth,
  });
  expect(earthMoon.id).toBeDefined();
  expect(earthMoon.name).toEqual('Moon');
  expect(earthMoon.planet.name).toEqual('Earth');

  const retrievedMoon = await moonRepository.getById(earthMoon.id as string);
  expect(retrievedMoon).toBeDefined();
  await superSave.close();
});

test('not existing relation entity throws an error', async () => {
  const errorMoonEntity: EntityDefinition = {
    ...moonEntity,
    relations: [
      {
        name: 'not-existing',
        field: 'planet',
        multiple: false,
      },
    ],
  };

  const superSave = await SuperSave.create(getConnection());
  const moonRepository = await superSave.addEntity<Moon>(errorMoonEntity);
  await expect(async () => {
    try {
      await moonRepository.getAll();
    } catch (error) {
      // TODO rewrite this to work with jest and toThrow(), but was not able to get it to work.
      expect((error as Error).message).toContain('not-existing');
    } finally {
      await superSave.close();
    }
  });
});

test('entity delete', async () => {
  const superSave = await SuperSave.create(getConnection());
  const planetRepository: Repository<Planet> =
    await superSave.addEntity<Planet>(planetEntity);

  const earth: Planet = await planetRepository.create({ name: 'Earth' });
  await planetRepository.create({ name: 'Mars' });
  // @ts-expect-error
  await planetRepository.deleteUsingId(earth.id as string);

  const remainingEarths = await planetRepository.getAll();
  expect(remainingEarths).toHaveLength(1);
  expect(remainingEarths[0].name).toBe('Mars');
  await superSave.close();
});
