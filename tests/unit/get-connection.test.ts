import { expect, test } from 'vitest';
import { SuperSave } from '../../dist/index.js';
import getConnection from '../connection.js';

test('get-connection returns something', async () => {
  const superSave = await SuperSave.create(getConnection());

  try {
    expect(superSave.getConnection()).toBeTruthy();
  } finally {
    await superSave.close();
  }
});
