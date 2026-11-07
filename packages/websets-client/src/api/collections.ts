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
import * as collections from '../inputs/collections.ts';
import * as outputs from '../outputs/index.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'GET /v1/collections': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: collections.listCollectionsSchema,
    output: [
      http.Ok<outputs.ListCollections>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof collections.listCollectionsSchema>) {
      return toRequest(
        'GET /v1/collections',
        empty(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof collections.listCollectionsSchema>,
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
  'POST /v1/collections': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: collections.createCollectionSchema,
    output: [
      http.Created<outputs.CreateCollection201>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.Conflict<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof collections.createCollectionSchema>) {
      return toRequest(
        'POST /v1/collections',
        json(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [
            'criteria',
            'fields',
            'lists',
            'monitor',
            'pages',
            'search',
            'title',
          ],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof collections.createCollectionSchema>,
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
  'GET /v1/collections/{id}': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: collections.getCollectionSchema,
    output: [
      http.Ok<outputs.GetCollection>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof collections.getCollectionSchema>) {
      return toRequest(
        'GET /v1/collections/{id}',
        empty(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [],
          inputParams: ['id'],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof collections.getCollectionSchema>,
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
  'DELETE /v1/collections/{id}': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: collections.deleteCollectionSchema,
    output: [
      http.NoContent,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.Conflict<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof collections.deleteCollectionSchema>) {
      return toRequest(
        'DELETE /v1/collections/{id}',
        empty(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [],
          inputParams: ['id'],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof collections.deleteCollectionSchema>,
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
