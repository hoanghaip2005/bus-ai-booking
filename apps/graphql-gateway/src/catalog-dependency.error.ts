export class CatalogDependencyError extends Error {
  constructor(
    readonly requestId: string,
    options?: ErrorOptions,
  ) {
    super('Catalog Service is unavailable.', options);
    this.name = 'CatalogDependencyError';
  }
}
