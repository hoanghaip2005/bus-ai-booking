export class CatalogValidationError extends Error {
  constructor(
    readonly requestId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CatalogValidationError';
  }
}
