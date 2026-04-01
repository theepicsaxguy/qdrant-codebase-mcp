import type { QdrantAdapter } from '../qdrant/adapter';
import type { EmbeddingAdapter } from '../embedding/adapter';
import { logger } from '../logger';
import { searchRequestsTotal, searchLatencySeconds } from '../metrics';
import type { SearchRequest, SearchResponse } from '../types';

export class SearchService {
  private readonly qdrantAdapters: Map<string, QdrantAdapter>;
  private readonly embedding: EmbeddingAdapter;
  private readonly log = logger.child({ component: 'SearchService' });

  private readonly minScore: number;

  constructor(
    qdrantAdapters: Map<string, QdrantAdapter>,
    embedding: EmbeddingAdapter,
    minScore = 0.8
  ) {
    this.qdrantAdapters = qdrantAdapters;
    this.embedding = embedding;
    this.minScore = minScore;
  }

  async search(req: SearchRequest): Promise<SearchResponse> {
    const repoId = req.repoId;
    const end = searchLatencySeconds.startTimer({ repo_id: repoId ?? 'global' });

    try {
      const queryVector = await this.embedding.embedQuery(req.query);
      // If minScore is not set in the request, use the config default
      const reqWithScore = { ...req, minScore: req.minScore ?? this.minScore };
      const results = repoId
        ? await this.searchSingleRepo(repoId, reqWithScore, queryVector)
        : await this.searchAcrossRepos(reqWithScore, queryVector);
      return { results };
    } catch (err) {
      searchRequestsTotal.inc({ repo_id: repoId ?? 'global', status: 'error' });
      this.log.error({ err, req }, 'Search failed');
      throw err;
    } finally {
      end();
    }
  }

  private async searchSingleRepo(
    repoId: string,
    req: SearchRequest,
    queryVector: number[]
  ): Promise<SearchResponse['results']> {
    const adapter = this.qdrantAdapters.get(repoId);
    if (!adapter) {
      throw new Error(`Unknown repoId: ${repoId}`);
    }

    const results = await adapter.search(this.buildSearchParams(req, queryVector));
    searchRequestsTotal.inc({ repo_id: repoId, status: 'success' });
    return results;
  }

  private async searchAcrossRepos(
    req: SearchRequest,
    queryVector: number[]
  ): Promise<SearchResponse['results']> {
    const allResults = await Promise.all(
      [...this.qdrantAdapters.entries()].map(async ([repoId, adapter]) => {
        const results = await adapter.search(this.buildSearchParams(req, queryVector));
        searchRequestsTotal.inc({ repo_id: repoId, status: 'success' });
        return results;
      })
    );

    return allResults
      .flat()
      .sort((left, right) => right.score - left.score)
      .slice(0, req.limit ?? 10);
  }

  private buildSearchParams(
    req: SearchRequest,
    queryVector: number[]
  ): Parameters<QdrantAdapter['search']>[0] {
    return {
      queryVector,
      directoryPrefix: req.directoryPrefix,
      language: req.language,
      limit: req.limit ?? 10,
      minScore: req.minScore ?? 0.45,
    };
  }
}
