import { z } from 'zod';

import { markup, separated } from './markup.ts';

// brutalist.report's Limit and Time choices.
const limits = [5, 10, 15, 25, 50] as const;
const windows = [
  [24, '24h'],
  [72, '3d'],
  [168, '7d'],
  [720, '30d'],
] as const;

const choice = <T extends number>(values: readonly T[], fallback: T) =>
  z
    .string()
    .optional()
    .transform((text) => (text === undefined ? fallback : Number(text)))
    .pipe(z.union(values.map((value) => z.literal(value))));

export const controlsSchema = {
  limit: choice(limits, 10),
  hours: choice(
    windows.map(([hours]) => hours),
    168,
  ),
};
export type Controls = { readonly limit: number; readonly hours: number };

export function controls(path: string, { limit, hours }: Controls) {
  const choose = (query: Controls, label: string, current: boolean) =>
    current
      ? markup`<b>${label}</b>`
      : markup`<a href="${path}?limit=${query.limit}&amp;hours=${query.hours}">${label}</a>`;
  return markup`<nav>Limit: [ ${separated(
    limits.map((value) =>
      choose({ limit: value, hours }, String(value), value === limit),
    ),
  )} ]</nav><nav>Time: [ ${separated(
    windows.map(([value, label]) =>
      choose({ limit, hours: value }, label, value === hours),
    ),
  )} ]</nav>`;
}
