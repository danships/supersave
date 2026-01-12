import type { Collection, HttpContext } from '../../../types.js';

export default async function transform(
  collection: Collection,
  ctx: HttpContext,
  item: unknown
): Promise<unknown> {
  let transformedItem = item;
  for (const hooks of collection.hooks || []) {
    if (hooks.entityTransform) {
      transformedItem = await hooks.entityTransform(
        collection,
        ctx,
        transformedItem
      );
    }
  }
  return transformedItem;
}
