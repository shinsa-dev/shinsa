export interface ByteRange {
  readonly offset: number;
  readonly length: number;
}

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface BucketHeadObject {
  readonly size: number;
  readonly httpEtag: string;
  readonly uploaded: Date;
}

interface BucketBodyObject {
  readonly body: ReadableStream | null;
  text(): Promise<string>;
}

export interface BucketBinding {
  head(key: string): Promise<BucketHeadObject | null>;
  get(key: string, options?: { range?: ByteRange }): Promise<BucketBodyObject | null>;
}

export interface CacheBinding {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}
