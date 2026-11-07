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
import * as monitors from '../inputs/monitors.ts';
import * as outputs from '../outputs/index.ts';
import {
  CursorPagination,
  OffsetPagination,
  Pagination,
} from '../pagination/index.ts';

export default {
  'GET /v1/monitors/{id}/events': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: monitors.listMonitorEventsSchema,
    output: [
      http.Ok<outputs.ListMonitorEvents>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.Gone<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof monitors.listMonitorEventsSchema>) {
      return toRequest(
        'GET /v1/monitors/{id}/events',
        empty(input, {
          inputHeaders: [],
          inputQuery: ['cursor', 'limit'],
          inputBody: [],
          inputParams: ['id'],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof monitors.listMonitorEventsSchema>,
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
  'GET /v1/monitors': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: monitors.listMonitorsSchema,
    output: [
      http.Ok<outputs.ListMonitors>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof monitors.listMonitorsSchema>) {
      return toRequest(
        'GET /v1/monitors',
        empty(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof monitors.listMonitorsSchema>,
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
  'POST /v1/monitors': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: monitors.createMonitorSchema,
    output: [
      http.Created<outputs.CreateMonitor201>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof monitors.createMonitorSchema>) {
      return toRequest(
        'POST /v1/monitors',
        json(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: ['cron', 'name', 'target'],
          inputParams: [],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof monitors.createMonitorSchema>,
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
  'GET /v1/monitors/{id}': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: monitors.getMonitorSchema,
    output: [
      http.Ok<outputs.GetMonitor>,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof monitors.getMonitorSchema>) {
      return toRequest(
        'GET /v1/monitors/{id}',
        empty(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [],
          inputParams: ['id'],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof monitors.getMonitorSchema>,
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
  'DELETE /v1/monitors/{id}': {
    security: [{ bearer: [] }] as readonly Record<string, readonly string[]>[],
    schema: monitors.deleteMonitorSchema,
    output: [
      http.NoContent,
      http.BadRequest<outputs.ApiError>,
      http.Unauthorized<outputs.ApiError>,
      http.NotFound<outputs.ApiError>,
      http.UnsupportedMediaType<outputs.ApiError>,
      http.InternalServerError<outputs.ApiError>,
    ],
    toRequest(input: z.input<typeof monitors.deleteMonitorSchema>) {
      return toRequest(
        'DELETE /v1/monitors/{id}',
        empty(input, {
          inputHeaders: [],
          inputQuery: [],
          inputBody: [],
          inputParams: ['id'],
        }),
      );
    },
    async dispatch(
      input: z.input<typeof monitors.deleteMonitorSchema>,
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
