import {
  InvalidStateTransitionError,
  InvalidValueError,
  newId,
} from '../../../shared-kernel/index.js';
import { Brand } from './brand.js';

const create = () =>
  Brand.create({ id: newId(), name: ' Marca ', slug: 'marca' });

describe('Brand (UC-CAT-13, BR-PRD-13)', () => {
  it('creates an active brand with a trimmed name', () => {
    expect(create().snapshot()).toMatchObject({
      name: 'Marca',
      slug: 'marca',
      status: 'ACTIVE',
    });
  });

  it('renames and changes the slug, with the same rules as categories', () => {
    const brand = create();

    brand.rename('Otra Marca');
    brand.changeSlug('otra-marca');

    expect(brand.snapshot()).toMatchObject({
      name: 'Otra Marca',
      slug: 'otra-marca',
    });
    expect(() => brand.rename(' ')).toThrow(InvalidValueError);
    expect(() => brand.changeSlug('Otra')).toThrow(InvalidValueError);
  });

  it('deactivates an active brand and reactivates it without conditions', () => {
    const brand = create();

    brand.deactivate();
    expect(brand.snapshot().status).toBe('INACTIVE');
    expect(() => brand.deactivate()).toThrow(InvalidStateTransitionError);

    brand.reactivate();
    expect(brand.snapshot().status).toBe('ACTIVE');
    expect(() => brand.reactivate()).toThrow(InvalidStateTransitionError);
  });
});
