import type { Hono } from 'hono';

import { currentAsOf, programResources } from '../programs.ts';

export default function (router: Hono) {
  // The programs of each company, as their pages' registrable domain groups
  // them: microsoft.com/startups and learn.microsoft.com/startups are one
  // company's.
  router.get('/v1/companies', (c) => {
    const companies = Map.groupBy(
      programResources(),
      ({ company }) => company.domain,
    );
    return c.json({
      companies: [...companies].map(([domain, programs]) => ({
        domain,
        name: programs[0]!.company.name,
        programs,
      })),
      currentAsOf: currentAsOf(),
    });
  });
}
