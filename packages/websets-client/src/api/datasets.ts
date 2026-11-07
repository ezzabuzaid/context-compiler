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
import * as datasets from '../inputs/datasets.ts';
import * as outputs from '../outputs/index.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'GET /v1/datasets': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: datasets.listDatasetsSchema,
    output: [
      http.Ok<outputs.ListDatasets>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof datasets.listDatasetsSchema>) {
      return toRequest(
        'GET /v1/datasets',
        empty(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof datasets.listDatasetsSchema>,
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
  'POST /v1/datasets': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: datasets.createDatasetSchema,
    output: [
      http.Created<outputs.CreateDataset201>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.Conflict<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof datasets.createDatasetSchema>) {
      return toRequest(
        'POST /v1/datasets',
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
      input: z.input<typeof datasets.createDatasetSchema>,
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
  'GET /v1/datasets/{id}': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: datasets.getDatasetSchema,
    output: [
      http.Ok<outputs.GetDataset>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof datasets.getDatasetSchema>) {
      return toRequest(
        'GET /v1/datasets/{id}',
        empty(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [],
          inputParams: ['id'],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof datasets.getDatasetSchema>,
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
  'DELETE /v1/datasets/{id}': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: datasets.deleteDatasetSchema,
    output: [
      http.NoContent,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.Conflict<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof datasets.deleteDatasetSchema>) {
      return toRequest(
        'DELETE /v1/datasets/{id}',
        empty(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [],
          inputParams: ['id'],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof datasets.deleteDatasetSchema>,
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
