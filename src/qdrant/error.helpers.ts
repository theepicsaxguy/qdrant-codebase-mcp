export function isMissingCollectionError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  if ('status' in err && err.status === 404) {
    return true;
  }

  if (!('message' in err) || typeof err.message !== 'string') {
    return false;
  }

  return err.message.includes("doesn't exist") || err.message.includes('Not found: Collection');
}
