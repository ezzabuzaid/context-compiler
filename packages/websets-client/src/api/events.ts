import z from 'zod';

import {
  Dispatcher,
  type InstanceType,
  fetchType,
} from '../http/dispatcher.ts';
import {
  type Interceptor,
  createBaseUrlInterceptor,
  createHeadersInterceptor,
} from '../http/interceptors.ts';
import { bodyless, buffered, chunked } from '../http/parse-response.ts';
import {
  type HeadersInit,
  empty,
  formdata,
  json,
  toRequest,
  urlencoded,
} from '../http/request.ts';
import * as http from '../http/response.ts';
import { type SSEListener, sse } from '../http/sse.ts';
import * as events from '../inputs/events.ts';
import * as outputs from '../outputs/index.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'GET /v1/datasets/{id}/events': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: events.listEventsSchema,
    output: [
      http.Ok<outputs.ListEvents>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.Gone<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof events.listEventsSchema>) {
      return toRequest(
        'GET /v1/datasets/{id}/events',
        empty(input, {
          inputHeaders: [],
          inputQuery: ['cursor', 'limit'],
          inputBody: [],
          inputParams: ['id'],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof events.listEventsSchema>,
      options: {
        signal?: AbortSignal;
        interceptors: Interceptor[];
        fetch: z.infer<typeof fetchType>;
      },
    ) {
      const dispatcher = new Dispatcher(options.interceptors, options.fetch);
      return dispatcher.send(
        this.toRequest(input),
        this.output,
        options?.signal,
      );
    },
  },
};
