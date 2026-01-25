import { beforeEach, describe, expect, test } from 'vitest';
import type { EntityDefinition } from '../../dist/index.js';
import { SuperSave } from '../../dist/index.js';
import getConnection from '../connection.js';
import { planetEntity } from '../entities.js';
import { clear } from '../mysql.js';
import type { Planet } from '../types.js';

beforeEach(clear);

describe('logical operators: AND, OR, NOT', () => {
  test('explicit AND with fluent chaining', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
        distance: 'number',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Earth', distance: 100 });
    await planetRepository.create({ name: 'Earth', distance: 200 });
    await planetRepository.create({ name: 'Mars', distance: 100 });

    const query = planetRepository.createQuery();
    query.and().eq('name', 'Earth').eq('distance', 100);

    const results = await planetRepository.getByQuery(query);
    expect(results).toHaveLength(1);
    expect((results[0] as Planet).name).toBe('Earth');
    expect((results[0] as Planet).distance).toBe(100);

    await superSave.close();
  });

  test('OR with fluent chaining', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Earth' });
    await planetRepository.create({ name: 'Mars' });
    await planetRepository.create({ name: 'Venus' });

    const query = planetRepository.createQuery();
    query.or().eq('name', 'Earth').eq('name', 'Mars');

    const results = await planetRepository.getByQuery(query);
    expect(results).toHaveLength(2);
    expect(results.map((p) => (p as Planet).name).sort()).toEqual([
      'Earth',
      'Mars',
    ]);

    await superSave.close();
  });

  test('NOT single filter', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Earth' });
    await planetRepository.create({ name: 'Mars' });
    await planetRepository.create({ name: 'Pluto' });

    const query = planetRepository.createQuery();
    query.not().eq('name', 'Pluto');

    const results = await planetRepository.getByQuery(query);
    expect(results).toHaveLength(2);
    expect(results.map((p) => (p as Planet).name).sort()).toEqual([
      'Earth',
      'Mars',
    ]);

    await superSave.close();
  });

  test('nested groups: OR of two ANDs', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
        distance: 'number',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Earth', distance: 100 });
    await planetRepository.create({ name: 'Mars', distance: 200 });
    await planetRepository.create({ name: 'Jupiter', distance: 100 });
    await planetRepository.create({ name: 'Venus', distance: 200 });

    const query = planetRepository.createQuery();
    query.or(
      planetRepository
        .createQuery()
        .and()
        .eq('name', 'Earth')
        .eq('distance', 100),
      planetRepository
        .createQuery()
        .and()
        .eq('name', 'Venus')
        .eq('distance', 200)
    );

    const results = await planetRepository.getByQuery(query);
    expect(results).toHaveLength(2);
    expect(results.map((p) => (p as Planet).name).sort()).toEqual([
      'Earth',
      'Venus',
    ]);

    await superSave.close();
  });

  test('complex: AND with OR sub-group', async () => {
    interface PlanetWithVisible extends Planet {
      visible: boolean;
    }

    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
        visible: 'boolean',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<PlanetWithVisible>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Earth', visible: true });
    await planetRepository.create({ name: 'Mars', visible: true });
    await planetRepository.create({ name: 'Jupiter', visible: false });
    await planetRepository.create({ name: 'Venus', visible: false });

    const query = planetRepository.createQuery();
    query
      .and()
      .eq('visible', true)
      .or(
        planetRepository.createQuery().eq('name', 'Mars'),
        planetRepository.createQuery().eq('name', 'Venus')
      );

    const results = await planetRepository.getByQuery(query);
    expect(results).toHaveLength(1);
    expect((results[0] as PlanetWithVisible).name).toBe('Mars');

    await superSave.close();
  });

  test('backward compatibility: implicit AND still works', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
        distance: 'number',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Earth', distance: 100 });
    await planetRepository.create({ name: 'Earth', distance: 200 });
    await planetRepository.create({ name: 'Mars', distance: 100 });

    const query = planetRepository.createQuery();
    query.eq('name', 'Earth').eq('distance', 100);

    const results = await planetRepository.getByQuery(query);
    expect(results).toHaveLength(1);
    expect((results[0] as Planet).name).toBe('Earth');

    await superSave.close();
  });

  test('mixed: implicit AND with explicit OR', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
        distance: 'number',
        visible: 'boolean',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository = await superSave.addEntity<
      Planet & { visible: boolean }
    >(filteredPlanetEntity);

    await planetRepository.create({
      name: 'Earth',
      distance: 100,
      visible: true,
    });
    await planetRepository.create({
      name: 'Mars',
      distance: 200,
      visible: true,
    });
    await planetRepository.create({
      name: 'Jupiter',
      distance: 100,
      visible: false,
    });

    const query = planetRepository.createQuery();
    query
      .eq('visible', true)
      .or(
        planetRepository.createQuery().eq('distance', 100),
        planetRepository.createQuery().eq('distance', 200)
      );

    const results = await planetRepository.getByQuery(query);
    expect(results).toHaveLength(2);

    await superSave.close();
  });

  test('IN with empty array returns no results', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Earth' });
    await planetRepository.create({ name: 'Mars' });

    const query = planetRepository.createQuery();
    query.in('name', []);

    const results = await planetRepository.getByQuery(query);
    expect(results).toHaveLength(0);

    await superSave.close();
  });
});
