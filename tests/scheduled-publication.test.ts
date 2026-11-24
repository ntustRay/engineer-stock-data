import { expect, it } from 'bun:test';
import { planPublication } from '../src/scheduled-publication.js';

it('uses Friday close during Saturday overnight recovery and skips a completed session', () => {
  const overnight = new Date('2026-11-27T23:35:00Z');
  expect(
    planPublication('overnight', undefined, overnight, '2026-11-26'),
  ).toEqual({
    targetDate: '2026-11-27',
    alreadyPublished: false,
    deferPending: true,
  });
  for (const published of ['2026-11-27', '2026-11-30'])
    expect(
      planPublication('overnight', undefined, overnight, published)
        .alreadyPublished,
    ).toBe(true);
  expect(
    planPublication('final-recovery', undefined, overnight, undefined)
      .deferPending,
  ).toBe(false);
});
it('requires today’s close at the evening attempt, even when yesterday was published', () => {
  const evening = new Date('2026-11-27T11:10:00Z');
  expect(planPublication('evening', undefined, evening, '2026-11-26')).toEqual({
    targetDate: '2026-11-27',
    alreadyPublished: false,
    deferPending: true,
  });
  expect(
    planPublication('push', undefined, evening, undefined).targetDate,
  ).toBeUndefined();
});
it('retains the previous session if the last recovery runner starts after the next close', () => {
  const delayed = new Date('2026-11-25T07:00:00Z');
  expect(
    planPublication('final-recovery', undefined, delayed, '2026-11-23')
      .targetDate,
  ).toBe('2026-11-24');
});
it('preserves strict manual targets and ordinary unscheduled builds', () => {
  const now = new Date('2026-11-27T11:10:00Z');
  expect(planPublication('overnight', '2026-11-25', now, '2026-11-26')).toEqual(
    {
      targetDate: '2026-11-25',
      alreadyPublished: false,
      deferPending: false,
    },
  );
  expect(
    planPublication(undefined, undefined, now, undefined).deferPending,
  ).toBe(false);
});
