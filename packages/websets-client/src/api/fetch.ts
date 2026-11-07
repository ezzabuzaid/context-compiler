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
import * as fetch from '../inputs/fetch.ts';
import * as outputs from '../outputs/index.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'POST /v1/fetch': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: fetch.fetchSchema,
    output: [
      http.Ok<outputs.Fetch>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof fetch.fetchSchema>) {
      return toRequest(
        'POST /v1/fetch',
        json(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: ['urls'],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof fetch.fetchSchema>,
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
