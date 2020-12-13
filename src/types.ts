export interface Document {
  _id?: number;
  slug: string;
  url: string;
  weight: number;
  links: string[];
  headings: string[];
  text: string;
  tags: string;
  title: string;
  preview: string;
  searchProperty: string;
  includeInGlobalSearch?: boolean;
}

export interface InternalDocument {
  _id?: number;
  url: string;
  weight: number;
  links: string[];
  headings: string;
  text: string;
  tags: string;
  title: string;
  includeInGlobalSearch?: boolean;
}

export class RawManifest {
  body: string;
  lastModified: Date;
  searchProperty: string;

  constructor(body: string, lastModified: Date, searchProperty: string) {
    this.body = body;
    this.lastModified = lastModified;
    this.searchProperty = searchProperty;
  }
}

export interface Result {
  url: string;
  title: string;
  preview: string;
}

export interface RawResult extends Result {
  _id: number;
}

export interface WorkerRequestSearch {
  queryString: string;
  searchProperty: string;
  useHits: boolean;
}

export interface WorkerRequest {
  search?: WorkerRequestSearch;
  sync?: RawManifest[];
}

export interface WorkerResponse {
  results?: Result[];
}
