import { beforeEach, describe, expect, test } from 'vitest';
import {
  type BaseEntity,
  type Repository,
  SuperSave,
} from '../../dist/index.js';
import getConnection from '../connection.js';
import { planetEntity } from '../entities.js';
import { clear } from '../mysql.js';
import type { Planet } from '../types.js';

beforeEach(clear);

describe('update', () => {
  test('simple entity update', async () => {
    const superSave = await SuperSave.create(getConnection());
    const planetRepository: Repository<Planet> =
      await superSave.addEntity<Planet>(planetEntity);

    const earth: Planet = await planetRepository.create({ name: 'Earth' });
    await planetRepository.update({
      id: earth.id as string,
      name: 'Updated Earth',
    });

    const checkEarth = await planetRepository.getById(earth.id as string);

    expect(checkEarth).toBeDefined();
    expect((checkEarth as Planet).name).toBe('Updated Earth');
    await superSave.close();
  });

  test('updates to entity with a single relation filterSearch field', async () => {
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
    const planet = await planetRepository.create({ name: 'Earth', moon });

    const updatedPlanet = await planetRepository.update({
      ...planet,
      name: 'Earth 2',
    });
    expect(updatedPlanet.name).toEqual('Earth 2');

    await superSave.close();
  });

  test('updates to entity with a multple relation filterSearch field', async () => {
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
    const planet = await planetRepository.create({
      name: 'Jupiter',
      moons: [ioMoon, europaMoon],
    });

    const updatedPlanet = await planetRepository.update({
      ...planet,
      name: 'Jupiter 2',
    });
    expect(updatedPlanet.name).toEqual('Jupiter 2');

    await superSave.close();
  });
});
