import { beforeEach, expect, test } from 'vitest';
import { type EntityDefinition, type Repository, SuperSave } from '../../dist/index.js';
import getConnection from '../connection.js';
import { moonEntity, planetEntity } from '../entities.js';
import { clear } from '../mysql.js';
import type { Moon, Planet } from '../types.js';

beforeEach(clear);

test('there is a difference between with and without namespace', async () => {
  const superSave = await SuperSave.create(getConnection());

  const otherPlanetEntity: EntityDefinition = {
    ...planetEntity,
    namespace: 'other',
  };

  const planetRepository: Repository<Planet> =
    await superSave.addEntity<Planet>(planetEntity);
  const otherPlanetRepository: Repository<Planet> =
    await superSave.addEntity<Planet>(otherPlanetEntity);

  await planetRepository.create({ name: 'Earth' });
  const otherResults = await otherPlanetRepository.getAll();
  expect(otherResults).toHaveLength(0);
  await superSave.close();
});

test('there is a difference between different namespaces with same entity', async () => {
  const superSave = await SuperSave.create(getConnection());

  const namespacedPlanetEntity: EntityDefinition = {
    ...planetEntity,
    namespace: 'one',
  };

  const otherPlanetEntity: EntityDefinition = {
    ...namespacedPlanetEntity,
    namespace: 'other',
  };

  const planetRepository: Repository<Planet> =
    await superSave.addEntity<Planet>(planetEntity);
  const otherPlanetRepository: Repository<Planet> =
    await superSave.addEntity<Planet>(otherPlanetEntity);

  await planetRepository.create({ name: 'Earth' });
  const otherResults = await otherPlanetRepository.getAll();
  expect(otherResults).toHaveLength(0);
  await superSave.close();
});

test('relations from different namespace', async () => {
  const superSave = await SuperSave.create(getConnection());

  const namespacedPlanetEntity: EntityDefinition = {
    ...planetEntity,
    namespace: 'one',
  };

  const namespacedMoonEntity: EntityDefinition = {
    ...moonEntity,
    namespace: 'space',
    relations: [
      {
        name: namespacedPlanetEntity.name,
        namespace: 'one',
        field: 'planet',
        multiple: false,
      },
    ],
  };

  const planetRepository: Repository<Planet> =
    await superSave.addEntity<Planet>(namespacedPlanetEntity);
  const earth = await planetRepository.create({ name: 'Earth' });

  const moonRepository: Repository<Moon> =
    await superSave.addEntity<Moon>(namespacedMoonEntity);
  const earthMoon: Moon = await moonRepository.create({
    name: 'Moon',
    planet: earth,
  });
  expect(earthMoon.id).toBeDefined();
  expect(earthMoon.name).toEqual('Moon');
  expect(earthMoon.planet.name).toEqual('Earth');

  const retrievedMoon = await moonRepository.getById(earthMoon.id as string);
  expect(retrievedMoon).toBeDefined();
  expect((retrievedMoon as Moon).planet).toBeDefined();
  await superSave.close();
});
