import { beforeEach, describe, expect, test } from 'vitest';
import {
  type BaseEntity,
  type EntityDefinition,
  type Query,
  SuperSave,
} from '../../dist/index.js';
import getConnection from '../connection.js';
import { planetEntity } from '../entities.js';
import { clear } from '../mysql.js';
import type { Planet } from '../types.js';

beforeEach(clear);

describe('general filter tests', () => {
  test('additional filter/sort fields can be defined', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
        distance: 'number',
        inhabitable: 'boolean',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Earth' });
    await superSave.close();
  });

  test('data can be queried using a filter', async () => {
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
    const query: Query = planetRepository.createQuery();
    query.eq('name', 'Earth');

    const filteredResult = await planetRepository.getOneByQuery(query);
    await superSave.close();

    expect(filteredResult).toBeDefined();
    expect((filteredResult as Planet).name).toBe('Earth');
  });

  test('results are filtered and sorted', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Mars' });
    await planetRepository.create({ name: 'Earth' });

    const earthQuery: Query = planetRepository.createQuery();
    earthQuery.eq('name', 'Earth').limit(1);
    earthQuery.sort('name');

    const earthResult = await planetRepository.getOneByQuery(earthQuery);
    expect(earthResult).toBeDefined();
    expect((earthResult as Planet).name).toBe('Earth');

    const marsQuery: Query = planetRepository.createQuery();
    marsQuery.eq('name', 'Mars').limit(1);
    marsQuery.sort('name');

    const marsResult = await planetRepository.getOneByQuery(marsQuery);
    expect(marsResult).toBeDefined();
    expect((marsResult as Planet).name).toBe('Mars');
    await superSave.close();
  });

  test('results are filtered and sorted', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Mars' });
    await planetRepository.create({ name: 'Earth' });

    const ascQuery: Query = planetRepository.createQuery();
    ascQuery.sort('name');

    const ascResult = await planetRepository.getByQuery(ascQuery);
    expect(ascResult).toHaveLength(2);
    expect((ascResult[0] as Planet).name).toBe('Earth');

    const descQuery: Query = planetRepository.createQuery();
    descQuery.sort('name', 'desc');

    const descResult = await planetRepository.getByQuery(descQuery);
    expect(descResult).toHaveLength(2);
    expect((descResult[0] as Planet).name).toBe('Mars');
    await superSave.close();
  });

  test('results are properly limited', async () => {
    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<Planet>(filteredPlanetEntity);

    await planetRepository.create({ name: 'Mars' });
    await planetRepository.create({ name: 'Earth' });

    const limitQuery: Query = planetRepository.createQuery();
    limitQuery.sort('name').limit(1);

    const limitResult = await planetRepository.getByQuery(limitQuery);
    expect(limitResult).toHaveLength(1);
    expect((limitResult[0] as Planet).name).toBe('Earth');

    const offsetQuery: Query = planetRepository.createQuery();
    offsetQuery.sort('name', 'desc').limit(1).offset(1);

    const offsetResult = await planetRepository.getByQuery(offsetQuery);
    expect(offsetResult).toHaveLength(1);
    expect((offsetResult[0] as Planet).name).toBe('Earth');
    await superSave.close();
  });

  test('Updates to filters', async () => {
    interface FilteredPlanet extends Planet {
      visible: boolean;
      distance: number;
      age: number;
    }

    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        name: 'string',
        visible: 'boolean',
        distance: 'number',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<FilteredPlanet>(planetEntity);

    await planetRepository.create({
      name: 'Earth',
      distance: 200,
      visible: false,
    });

    // initialize it again, with filters
    const superSaveReinitialized: SuperSave = await SuperSave.create(
      getConnection()
    );
    const reinitializedPlanetRepository =
      await superSaveReinitialized.addEntity<FilteredPlanet>(
        filteredPlanetEntity
      );

    await reinitializedPlanetRepository.create({
      name: 'Earth',
      distance: 200,
      visible: false,
    });

    // initialize it again, with additional filters
    const ageFilteredPlanetEntity: EntityDefinition = {
      ...filteredPlanetEntity,
      filterSortFields: {
        name: 'string',
        visible: 'boolean',
        distance: 'number',
      },
    };

    const superSaveReinitializedAge: SuperSave = await SuperSave.create(
      getConnection()
    );
    const reinitializedAgePlanetRepository =
      await superSaveReinitializedAge.addEntity<FilteredPlanet>(
        ageFilteredPlanetEntity
      );

    await reinitializedAgePlanetRepository.create({
      name: 'Earth',
      distance: 200,
      visible: false,
    });
    await superSave.close();
  });
});

describe('there can be filtered on relation fields', () => {
  test('a single relation field', async () => {
    const superSave: SuperSave = await SuperSave.create(getConnection());

    interface Moon extends BaseEntity {
      name: string;
      size: number;
    }

    interface Planet extends BaseEntity {
      id: string;
      name: string;
      moon: Moon;
    }

    const moonRepository = await superSave.addEntity<Moon>({
      name: 'moon',
      template: {},
      relations: [],
    });
    const planetRepository = await superSave.addEntity<Planet>({
      name: 'planet',
      template: {},
      relations: [
        {
          name: 'moon',
          field: 'moon',
          multiple: false,
        },
      ],
      filterSortFields: {
        moon: 'string',
      },
    });
    const moon = await moonRepository.create({ name: 'Moon', size: 12 });
    await planetRepository.create({ name: 'Earth', moon });

    // Attempt to retrieve the planet by the moon attribute
    const planets = await planetRepository.getByQuery(
      planetRepository.createQuery().eq('moon', moon.id)
    );
    expect(planets).toHaveLength(1);

    await superSave.close();
  });

  test('a multiple relation field', async () => {
    const superSave: SuperSave = await SuperSave.create(getConnection());

    interface Moon extends BaseEntity {
      name: string;
      size: number;
    }

    interface Planet extends BaseEntity {
      id: string;
      name: string;
      moon: Moon[];
    }

    const moonRepository = await superSave.addEntity<Moon>({
      name: 'moon',
      template: {},
      relations: [],
    });
    const planetRepository = await superSave.addEntity<Planet>({
      name: 'planet',
      template: {},
      relations: [
        {
          name: 'moon',
          field: 'moons',
          multiple: true,
        },
      ],
      filterSortFields: {
        moons: 'string',
      },
    });
    const ioMoon = await moonRepository.create({ name: 'Io', size: 9 });
    const europaMoon = await moonRepository.create({
      name: 'Europa',
      size: 36,
    });
    await planetRepository.create({
      name: 'Jupiter',
      moons: [ioMoon, europaMoon],
    });

    // Attempt to retrieve the planet by the moon attribute
    const planets = await planetRepository.getByQuery(
      planetRepository.createQuery().like('moons', `%${europaMoon.id}%`)
    );
    expect(planets).toHaveLength(1);

    await superSave.close();
  });

  test('there can be multiple filters on one field', async () => {
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

    await planetRepository.create({ name: 'Earth', distance: 1000 });
    await planetRepository.create({ name: 'Pluto', distance: 9877654 });

    const results = await planetRepository.getByQuery(
      planetRepository.createQuery().gt('distance', 800).lt('distance', 9999999)
    );
    expect(results.length).toBe(2);

    await superSave.close();
  });

  test('can filter by null values using eq', async () => {
    interface PlanetWithOptionalField extends Planet {
      description?: string | null;
    }

    const filteredPlanetEntity: EntityDefinition = {
      ...planetEntity,
      filterSortFields: {
        ...(planetEntity.filterSortFields || {}),
        name: 'string',
        description: 'string',
      },
    };

    const superSave: SuperSave = await SuperSave.create(getConnection());
    const planetRepository =
      await superSave.addEntity<PlanetWithOptionalField>(filteredPlanetEntity);

    // Create planets with null and non-null description values
    await planetRepository.create({
      name: 'Earth',
      description: 'Blue planet',
    });
    await planetRepository.create({ name: 'Mars', description: null });
    await planetRepository.create({ name: 'Jupiter', description: null });
    await planetRepository.create({ name: 'Venus', description: 'Hot planet' });

    // Query for planets with null description
    const nullQuery: Query = planetRepository.createQuery();
    nullQuery.eq('description', null);

    const nullResults = await planetRepository.getByQuery(nullQuery);
    expect(nullResults).toHaveLength(2);
    expect(
      nullResults.map((p) => (p as PlanetWithOptionalField).name).sort()
    ).toEqual(['Jupiter', 'Mars']);

    // Query for planets with non-null description to ensure normal queries still work
    const nonNullQuery: Query = planetRepository.createQuery();
    nonNullQuery.eq('description', 'Blue planet');

    const nonNullResults = await planetRepository.getByQuery(nonNullQuery);
    expect(nonNullResults).toHaveLength(1);
    expect((nonNullResults[0] as PlanetWithOptionalField).name).toBe('Earth');

    await superSave.close();
  });
});
