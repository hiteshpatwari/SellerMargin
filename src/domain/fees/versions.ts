import type { FeeSchedule } from '../types';
import us2026AugustV1 from './verified-us.json';

export const FEE_SCHEDULE_VERSIONS = {
  'us-2026-08-v1': us2026AugustV1 as FeeSchedule,
} as const;

export type FeeScheduleVersion = keyof typeof FEE_SCHEDULE_VERSIONS;
export const ACTIVE_FEE_SCHEDULE_VERSION: FeeScheduleVersion = 'us-2026-08-v1';

export function getFeeScheduleVersion(version: FeeScheduleVersion): FeeSchedule {
  return FEE_SCHEDULE_VERSIONS[version];
}
