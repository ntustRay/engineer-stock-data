import { z } from 'zod/v4';
import { taipeiDate } from './calendar.js';

const windowSchema = z.enum(['push', 'evening', 'overnight', 'final-recovery']);

export function planPublication(
  automaticWindow: string | undefined,
  explicitDate: string | undefined,
  now: Date,
  lastPublished: string | undefined,
) {
  if (!automaticWindow || explicitDate)
    return {
      targetDate: explicitDate,
      alreadyPublished: false,
      deferPending: false,
    };
  const window = windowSchema.parse(automaticWindow);
  const recovery = window === 'overnight' || window === 'final-recovery';
  // Overnight retries belong to the preceding Taipei date, even if delayed past today's close.
  // A delayed evening publish may also start after midnight, before the next 13:30 close.
  const hoursBack = recovery ? 24 : 13.5;
  const date = taipeiDate(new Date(now.getTime() - hoursBack * 60 * 60 * 1000));
  return {
    targetDate: window === 'push' ? undefined : date,
    alreadyPublished:
      recovery && lastPublished !== undefined && lastPublished >= date,
    deferPending: window !== 'final-recovery',
  };
}
