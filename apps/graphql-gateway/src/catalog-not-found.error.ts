export class CatalogNotFoundError extends Error {
  constructor(
    readonly requestId: string,
    message = 'Trip was not found.',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CatalogNotFoundError';
  }
}
