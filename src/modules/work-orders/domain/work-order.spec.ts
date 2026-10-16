import { Money, newId } from '../../../shared-kernel/index.js';
import {
  type NewWorkOrderDetails,
  type UserId,
  WORK_ORDER_TEXT_LIMITS,
  WorkOrder,
  type WorkOrderStatus,
} from './work-order.js';

const AT = new Date('2026-10-15T16:00:00.000Z');
const LATER = new Date('2026-10-16T18:30:00.000Z');
const clerk = newId<'User'>() as UserId;
const technician = newId<'User'>() as UserId;

const DETAILS: NewWorkOrderDetails = {
  customerId: null,
  customerName: 'María López Hernández',
  customerPhone: '4431234567',
  customerEmail: null,
  equipmentType: 'Laptop',
  equipmentBrand: 'Lenovo',
  equipmentModel: 'ThinkPad T14',
  serialNumber: 'PF3ABC12',
  accessories: 'Cargador',
  equipmentCondition: 'Rayones en la tapa',
  reportedFault: 'No enciende',
  estimatedCost: null,
  technicianId: null,
};

const receive = (details: Partial<NewWorkOrderDetails> = {}) =>
  WorkOrder.receive({
    id: newId(),
    details: { ...DETAILS, ...details },
    warehouseId: newId(),
    receivedBy: clerk,
    at: AT,
  });

/** A work order moved to `status` along the way forward, or cancelled from RECEIVED. */
function workOrderIn(status: WorkOrderStatus): WorkOrder {
  const workOrder = WorkOrder.restore(receive().snapshot);
  if (status === 'CANCELLED') {
    workOrder.moveTo('CANCELLED', clerk, 'El cliente se lo llevó', AT);
  } else if (status !== 'RECEIVED') {
    workOrder.moveTo(status, clerk, null, AT);
  }
  return WorkOrder.restore(workOrder.snapshot);
}

const invalid = (message: string) => ({
  code: 'validation-error',
  message,
});

const transition = (currentStatus: WorkOrderStatus) => ({
  code: 'invalid-state-transition',
  details: { currentStatus },
});

describe('WorkOrder (ADR-0165, ADR-0166)', () => {
  describe('receiving the equipment (UC-WRK-01)', () => {
    it('starts RECEIVED, without diagnosis nor work, in the name of who received it', () => {
      const cost = Money.of(35_000, 'MXN');
      const workOrder = receive({
        estimatedCost: cost,
        technicianId: technician,
      });

      expect(workOrder.snapshot).toMatchObject({
        ...DETAILS,
        estimatedCost: cost,
        technicianId: technician,
        diagnosis: null,
        workPerformed: null,
        status: 'RECEIVED',
        receivedBy: clerk,
        receivedAt: AT,
        closedAt: null,
        version: 1,
      });
      expect(workOrder.statusChanges).toEqual([
        { from: null, to: 'RECEIVED', actorId: clerk, note: null, at: AT },
      ]);
    });

    it('trims the texts, keeps blank optional ones as null and the email in lowercase', () => {
      const workOrder = receive({
        customerName: '  María López  ',
        customerEmail: '  Maria@Example.COM ',
        equipmentType: ' Laptop ',
        equipmentBrand: '   ',
        equipmentModel: '',
        serialNumber: ' PF3ABC12 ',
        accessories: ' ',
        equipmentCondition: null,
        reportedFault: ' No enciende ',
      });

      expect(workOrder.snapshot).toMatchObject({
        customerName: 'María López',
        customerEmail: 'maria@example.com',
        equipmentType: 'Laptop',
        equipmentBrand: null,
        equipmentModel: null,
        serialNumber: 'PF3ABC12',
        accessories: null,
        equipmentCondition: null,
        reportedFault: 'No enciende',
      });
    });

    it.each([
      ['customerName', 'A customer name has 1 to 120 characters'],
      ['equipmentType', 'An equipment type has 1 to 60 characters'],
      ['reportedFault', 'A reported fault has 1 to 2000 characters'],
    ] as const)('requires %s', (field, message) => {
      expect(() => receive({ [field]: '  ' })).toThrow(
        expect.objectContaining(invalid(message)),
      );
    });

    it.each([
      ['customerName', 'A customer name has 1 to 120 characters'],
      ['customerEmail', 'An email has at most 254 characters'],
      ['equipmentType', 'An equipment type has 1 to 60 characters'],
      ['equipmentBrand', 'A brand has at most 60 characters'],
      ['equipmentModel', 'A model has at most 60 characters'],
      ['serialNumber', 'A serial number has at most 60 characters'],
      ['accessories', 'A list of accessories has at most 500 characters'],
      ['equipmentCondition', 'The condition has at most 1000 characters'],
      ['reportedFault', 'A reported fault has 1 to 2000 characters'],
    ] as const)('takes %s up to its limit, not beyond', (field, message) => {
      const limit = WORK_ORDER_TEXT_LIMITS[field];

      expect(receive({ [field]: 'x'.repeat(limit) }).snapshot[field]).toBe(
        'x'.repeat(limit),
      );
      expect(() => receive({ [field]: 'x'.repeat(limit + 1) })).toThrow(
        expect.objectContaining(invalid(message)),
      );
    });

    it.each(['443123456', '44312345678', '443-123-45', '443 123 4567'])(
      'rejects the phone %j: exactly 10 digits',
      (customerPhone) => {
        expect(() => receive({ customerPhone })).toThrow(
          expect.objectContaining(invalid('A phone has exactly 10 digits')),
        );
      },
    );
  });

  describe('editing (UC-WRK-03)', () => {
    it('changes what is sent, keeps what is not and clears an optional field with null', () => {
      const workOrder = receive();

      workOrder.edit({
        diagnosis: ' Disco dañado ',
        workPerformed: 'Cambio de disco',
        equipmentBrand: null,
        estimatedCost: Money.of(120_000, 'MXN'),
        technicianId: technician,
        customerName: undefined,
      });

      expect(workOrder.snapshot).toMatchObject({
        ...DETAILS,
        diagnosis: 'Disco dañado',
        workPerformed: 'Cambio de disco',
        equipmentBrand: null,
        estimatedCost: Money.of(120_000, 'MXN'),
        technicianId: technician,
        status: 'RECEIVED',
      });
      expect(workOrder.statusChanges).toHaveLength(1);
    });

    it.each([
      ['diagnosis', 'A diagnosis has at most 4000 characters'],
      ['workPerformed', 'The work performed has at most 4000 characters'],
    ] as const)('takes %s up to its limit, not beyond', (field, message) => {
      const limit = WORK_ORDER_TEXT_LIMITS[field];
      const workOrder = receive();

      workOrder.edit({ [field]: 'x'.repeat(limit) });
      expect(workOrder.snapshot[field]).toBe('x'.repeat(limit));
      expect(() => workOrder.edit({ [field]: 'x'.repeat(limit + 1) })).toThrow(
        expect.objectContaining(invalid(message)),
      );
    });

    it('checks the rules of the data again', () => {
      expect(() => receive().edit({ customerPhone: '123' })).toThrow(
        expect.objectContaining(invalid('A phone has exactly 10 digits')),
      );
    });

    it.each(['DELIVERED', 'CANCELLED'] as const)(
      'takes no change once %s: the note was printed',
      (status) => {
        expect(() => workOrderIn(status).edit({ diagnosis: 'Otro' })).toThrow(
          expect.objectContaining(transition(status)),
        );
      },
    );
  });

  describe('moving it (UC-WRK-04)', () => {
    it('moves forward one step at a time, recording who, when and the note', () => {
      const workOrder = workOrderIn('RECEIVED');

      workOrder.moveTo('DIAGNOSED', technician, ' Disco dañado ', AT);
      workOrder.moveTo('IN_REPAIR', technician, null, AT);
      workOrder.moveTo('READY', technician, '   ', AT);
      workOrder.moveTo('DELIVERED', clerk, null, LATER);

      expect(workOrder.snapshot).toMatchObject({
        status: 'DELIVERED',
        closedAt: LATER,
      });
      expect(workOrder.statusChanges).toEqual([
        {
          from: 'RECEIVED',
          to: 'DIAGNOSED',
          actorId: technician,
          note: 'Disco dañado',
          at: AT,
        },
        {
          from: 'DIAGNOSED',
          to: 'IN_REPAIR',
          actorId: technician,
          note: null,
          at: AT,
        },
        {
          from: 'IN_REPAIR',
          to: 'READY',
          actorId: technician,
          note: null,
          at: AT,
        },
        {
          from: 'READY',
          to: 'DELIVERED',
          actorId: clerk,
          note: null,
          at: LATER,
        },
      ]);
    });

    it.each([
      ['RECEIVED', 'READY'],
      ['RECEIVED', 'DELIVERED'],
      ['DIAGNOSED', 'READY'],
      ['DIAGNOSED', 'DELIVERED'],
      ['IN_REPAIR', 'DELIVERED'],
    ] as const)('skips steps forward, from %s to %s', (from, to) => {
      const workOrder = workOrderIn(from);

      workOrder.moveTo(to, clerk, null, LATER);

      expect(workOrder.status).toBe(to);
      expect(workOrder.snapshot.closedAt).toEqual(
        to === 'DELIVERED' ? LATER : null,
      );
    });

    it.each([
      ['RECEIVED', 'RECEIVED'],
      ['DIAGNOSED', 'DIAGNOSED'],
      ['DIAGNOSED', 'RECEIVED'],
      ['IN_REPAIR', 'DIAGNOSED'],
      ['READY', 'IN_REPAIR'],
      ['READY', 'RECEIVED'],
    ] as const)('never goes back nor stays, from %s to %s', (from, to) => {
      const workOrder = workOrderIn(from);

      expect(() => workOrder.moveTo(to, clerk, null, LATER)).toThrow(
        expect.objectContaining(transition(from)),
      );
      expect(workOrder.statusChanges).toEqual([]);
    });

    it.each(['RECEIVED', 'DIAGNOSED', 'IN_REPAIR', 'READY'] as const)(
      'cancels it from %s with a note, closing it',
      (from) => {
        const workOrder = workOrderIn(from);

        workOrder.moveTo(
          'CANCELLED',
          clerk,
          ' Se lo llevó sin reparar ',
          LATER,
        );

        expect(workOrder.snapshot).toMatchObject({
          status: 'CANCELLED',
          closedAt: LATER,
        });
        expect(workOrder.statusChanges).toEqual([
          {
            from,
            to: 'CANCELLED',
            actorId: clerk,
            note: 'Se lo llevó sin reparar',
            at: LATER,
          },
        ]);
      },
    );

    it.each([null, '  '])('does not cancel it with the note %j', (note) => {
      const workOrder = workOrderIn('READY');

      expect(() => workOrder.moveTo('CANCELLED', clerk, note, LATER)).toThrow(
        expect.objectContaining(invalid('A cancelled work order needs a note')),
      );
      expect(workOrder.status).toBe('READY');
    });

    it('takes a note up to 500 characters, not beyond', () => {
      const workOrder = workOrderIn('RECEIVED');

      expect(() =>
        workOrder.moveTo('DIAGNOSED', clerk, 'x'.repeat(501), AT),
      ).toThrow(
        expect.objectContaining(invalid('A note has at most 500 characters')),
      );
      workOrder.moveTo('DIAGNOSED', clerk, 'x'.repeat(500), AT);
      expect(workOrder.statusChanges[0].note).toBe('x'.repeat(500));
    });

    it.each([
      ['DELIVERED', 'CANCELLED'],
      ['CANCELLED', 'DELIVERED'],
      ['CANCELLED', 'CANCELLED'],
    ] as const)('does not move it once %s, not even to %s', (from, to) => {
      expect(() =>
        workOrderIn(from).moveTo(to, clerk, 'Otra vez', LATER),
      ).toThrow(expect.objectContaining(transition(from)));
    });
  });
});
