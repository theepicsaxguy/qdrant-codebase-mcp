import * as client from 'prom-client';

export const registry = new client.Registry();

client.collectDefaultMetrics({
  register: registry,
  prefix: 'sci_',
  labels: { service: 'semantic-code-index' },
});

export const filesIndexedTotal = new client.Counter({
  name: 'sci_files_indexed_total',
  help: 'Total number of files indexed',
  labelNames: ['repo_id', 'status'] as const,
  registers: [registry],
});

export const chunksIndexedTotal = new client.Counter({
  name: 'sci_chunks_indexed_total',
  help: 'Total chunks upserted into Qdrant',
  labelNames: ['repo_id'] as const,
  registers: [registry],
});

export const indexingErrorsTotal = new client.Counter({
  name: 'sci_indexing_errors_total',
  help: 'Total indexing errors',
  labelNames: ['repo_id'] as const,
  registers: [registry],
});

export const searchRequestsTotal = new client.Counter({
  name: 'sci_search_requests_total',
  help: 'Total search requests',
  labelNames: ['repo_id', 'status'] as const,
  registers: [registry],
});

export const indexingDurationSeconds = new client.Histogram({
  name: 'sci_indexing_duration_seconds',
  help: 'Duration of full indexing runs in seconds',
  labelNames: ['repo_id'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [registry],
});

export const searchLatencySeconds = new client.Histogram({
  name: 'sci_search_latency_seconds',
  help: 'Search request latency in seconds',
  labelNames: ['repo_id'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});

export const embeddingLatencySeconds = new client.Histogram({
  name: 'sci_embedding_latency_seconds',
  help: 'Embedding batch latency in seconds',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [registry],
});
