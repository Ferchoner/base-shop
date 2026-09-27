import { DomainError, InvalidValueError } from './domain-error.js';

class InsufficientStockError extends DomainError {
  readonly code = 'insufficient-stock';
  readonly category = 'conflict';
}

describe('DomainError', () => {
  it('carries the problem type, the category and the details of a subclass', () => {
    const lines = [{ variantId: 'v-1', canFulfill: false }];
    const error = new InsufficientStockError('Some lines cannot be reserved', {
      lines,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('insufficient-stock');
    expect(error.category).toBe('conflict');
    expect(error.details).toEqual({ lines });
    expect(error.message).toBe('Some lines cannot be reserved');
    expect(error.name).toBe('InsufficientStockError');
  });

  it('has no details unless given', () => {
    expect(new InsufficientStockError('No stock').details).toBeUndefined();
  });

  it('reports invalid values as validation errors', () => {
    const error = new InvalidValueError('Amount must be positive');

    expect(error.code).toBe('validation-error');
    expect(error.category).toBe('invalid');
    expect(error.name).toBe('InvalidValueError');
  });
});
