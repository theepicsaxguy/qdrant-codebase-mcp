import type { QdrantClient, Schemas } from '@qdrant/js-client-rest';
import type { Logger } from '../logger';
import { isMissingCollectionError } from './error.helpers';

interface UpsertWithRecoveryOptions {
  client: QdrantClient;
  collectionName: string;
  points: Schemas['PointStruct'][];
  log: Logger;
  initialize: () => Promise<void>;
}

export async function upsertWithRecovery(options: UpsertWithRecoveryOptions): Promise<void> {
  const { client, collectionName, points, log, initialize } = options;
  try {
    await client.upsert(collectionName, { points, wait: true });
  } catch (err) {
    if (!isMissingCollectionError(err)) {
      throw err;
    }

    log.warn(
      { collection: collectionName },
      'Collection missing during upsert; reinitializing and retrying'
    );
    await initialize();
    await client.upsert(collectionName, { points, wait: true });
  }
}
