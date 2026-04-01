export interface IndexedChunk {
  id: string;
  vector: number[];
  repoId: string;
  filePath: string;
  language: string;
  codeChunk: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  updatedAt: number;
}

export interface MetadataPoint {
  type: 'metadata';
  indexing_complete: boolean;
  started_at: number;
  completed_at: number | null;
  last_error: string | null;
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

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink' | 'rename';
  filePath: string;
  oldFilePath?: string;
  repoId: string;
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

export interface RepoStatusResponse {
  repoId: string;
  collectionName: string;
  status: IndexingStatus;
}
