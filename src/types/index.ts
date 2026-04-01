/**
 * Typed payload sent to Qdrant for code chunk points.
 * Tightening this to a concrete type lets TypeScript (and VS Code) catch
 * shape mismatches at the call site before they reach the wire.
 */
export interface CodeChunkPayload {
  type: 'code';
  repoId: string;
  filePath: string;
  language: string;
  codeChunk: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  updatedAt: number;
}

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: CodeChunkPayload;
}

export interface SearchRequest {
  query: string;
  repoId?: string;
  directoryPrefix?: string;
  language?: string;
  limit?: number;
  minScore?: number;
}

export interface SearchResult {
  score: number;
  filePath: string;
  startLine: number;
  endLine: number;
  codeChunk: string;
  repoId: string;
}

export interface SearchResponse {
  results: SearchResult[];
}

export interface IndexingStatus {
  repoId: string;
  collectionName: string;
  indexing_complete: boolean;
  started_at: number | null;
  completed_at: number | null;
  last_error: string | null;
}

export interface ChunkInput {
  repoId: string;
  filePath: string;
  language: string;
  content: string;
}

export interface Chunk {
  id: string;
  repoId: string;
  filePath: string;
  language: string;
  codeChunk: string;
  startLine: number;
  endLine: number;
  contentHash: string;
}
