import { z } from 'zod';

export const fetchSchema = z.object({ urls: z.array(z.url()) });
