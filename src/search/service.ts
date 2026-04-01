import { QdrantAdapter } from '../qdrant/adapter';
import { EmbeddingAdapter } from '../embedding/adapter';
import { logger } from '../logger';
import { searchRequestsTotal, searchLatencySeconds } from '../metrics';
import type { SearchRequest, SearchResponse } from '../types';

export class SearchService {
  private readonly qdrantAdapters: Map<string, QdrantAdapter>;
  private readonly embedding: EmbeddingAdapter;
  private readonly log = logger.child({ component: 'SearchService' });

  constructor(qdrantAdapters: Map<string, QdrantAdapter>, embedding: EmbeddingAdapter) {
    this.qdrantAdapters = qdrantAdapters;
    this.embedding = embedding;
  }

  async search(req: SearchRequest): Promise<SearchResponse> {
    const repoId = req.repoId;
    const end = searchLatencySeconds.startTimer({ repo_id: repoId ?? 'global' });

    try {
      const queryVector = await this.embedding.embedQuery(req.query);

      if (repoId) {
        const adapter = this.qdrantAdapters.get(repoId);
        if (!adapter) throw new Error(`Unknown repoId: ${repoId}`);

        const results = await adapter.search({
          queryVector,
          directoryPrefix: req.directoryPrefix,
          language: req.language,
          limit: req.limit ?? 10,
          minScore: req.minScore ?? 0.45,
        });

        searchRequestsTotal.inc({ repo_id: repoId, status: 'success' });
        return { results };
      }

      // Cross-repo search
      const allResults = await Promise.all(
        [...this.qdrantAdapters.entries()].map(async ([rid, adapter]) => {
          const res = await adapter.search({
            queryVector,
            directoryPrefix: req.directoryPrefix,
            language: req.language,
            limit: req.limit ?? 10,
            minScore: req.minScore ?? 0.45,
          });
          searchRequestsTotal.inc({ repo_id: rid, status: 'success' });
          return res;
        })
      );

      const merged = allResults
        .flat()
        .sort((a, b) => b.score - a.score)
        .slice(0, req.limit ?? 10);

      return { results: merged };
    } catch (err) {
      searchRequestsTotal.inc({ repo_id: repoId ?? 'global', status: 'error' });
      this.log.error({ err, req }, 'Search failed');
      throw err;
    } finally {
      end();
    }
  }
}
