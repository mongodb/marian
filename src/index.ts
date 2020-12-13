#!/usr/bin/env deno
"use strict";

import {
  Response,
  serve,
  ServerRequest,
} from "https://deno.land/std@0.80.0/http/server.ts";

import { Pool } from "./pool.ts";
import { RawManifest, Result, WorkerRequest, WorkerResponse } from "./types.ts";

import * as log from "https://deno.land/x/branch@0.1.4/mod.ts";
import getFiles from "https://deno.land/x/getfiles@v1.0.0/mod.ts";
import { S3 } from "https://deno.land/x/aws_sdk@v0.0.7/client-s3/mod.ts";
import { ApiFactory } from "https://deno.land/x/aws_api@v0.2.0/client/mod.ts";

const logger = log.create();

const MAXIMUM_QUERY_LENGTH = 100;

// If a worker's backlog rises above this threshold, reject the request.
// This prevents the server from getting bogged down for unbounded periods of time.
const MAXIMUM_BACKLOG = 20;
const WARNING_BACKLOG = 15;

const STANDARD_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

/**
 * If the request method does not match the method parameter, return false
 * and write a 405 status code. Otherwise return true.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {string} method
 * @return {boolean}
 */
function checkMethod(
  req: ServerRequest,
  res: Response,
  method: string,
): boolean {
  if (req.method !== method) {
    res.status = 405;
    return false;
  }

  return true;
}

/** A web worker with a promise-oriented message-call interface. */
class TaskWorker {
  worker: Worker;
  backlog: number;
  pending: Map<
    number,
    [(response: WorkerResponse) => void, (error: Error) => void]
  >;
  messageId: number;

  /**
     * Create a new TaskWorker.
     * @param {string} scriptPath - A path to a JS file to execute.
     */
  constructor() {
    this.worker = new Worker(
      new URL("worker-searcher.ts", import.meta.url).href,
      { type: "module" },
    );
    this.worker.onmessage = this.onmessage.bind(this);

    this.backlog = 0;
    this.pending = new Map();
    this.messageId = 0;
  }

  /**
     * Send a message to this TaskWorker.
     * @param {map} message - An object to send to the worker.
     * @return {Promise}
     */
  send(message: WorkerRequest): Promise<WorkerResponse> {
    if (this.backlog > MAXIMUM_BACKLOG) {
      throw new Error("backlog-exceeded");
    }

    return new Promise((resolve, reject) => {
      const messageId = this.messageId;
      this.messageId += 1;
      this.backlog += 1;

      this.worker.postMessage({ message: message, messageId: messageId });
      this.pending.set(messageId, [resolve, reject]);
    });
  }

  /**
     * Handler for messages received from the worker.
     * @private
     * @param {MessageEvent} event
     * @return {Promise<?, Error>}
     */
  onmessage(event: MessageEvent): void {
    const pair = this.pending.get(event.data.messageId);
    if (!pair) {
      logger.error(`Got unknown message ID ${event.data.messageId}`);
      return;
    }

    this.backlog -= 1;
    this.pending.delete(event.data.messageId);
    const [resolve, reject] = pair;
    if (event.data.error) {
      reject(new Error(event.data.error));
      return;
    }

    resolve(event.data);
  }
}

class Index {
  manifestSource: string;
  manifests: string[];
  errors: string[];
  lastSyncDate: Date | null;
  currentlyIndexing: boolean;
  workers: Pool<TaskWorker>;

  constructor(manifestSource: string) {
    this.manifestSource = manifestSource;
    this.manifests = [];
    this.errors = [];

    this.lastSyncDate = null;
    this.currentlyIndexing = false;

    const nWorkers = parseInt(Deno.env.get("MAX_WORKERS") || "2");
    this.workers = new Pool(nWorkers, () => new TaskWorker());

    // Suspend all of our workers until we have an index
    for (const worker of this.workers.pool) {
      this.workers.suspend(worker);
    }
  }

  getStatus() {
    return {
      manifests: this.manifests,
      lastSync: {
        errors: this.errors,
        finished: this.lastSyncDate ? this.lastSyncDate.toISOString() : null,
      },
      workers: this.workers.getStatus(),
    };
  }

  search(queryString: string, searchProperty: string): Promise<Result[]> {
    const worker = this.workers.get();
    const useHits = worker.backlog <= WARNING_BACKLOG;

    return worker.send({
      search: {
        queryString: queryString,
        searchProperty: searchProperty,
        useHits: useHits,
      },
    }).then((message) => message.results!);
  }

  async getManifestsFromS3(
    bucketName: string,
    prefix: string,
  ): Promise<RawManifest[]> {
    const factory = new ApiFactory();
    const s3 = new S3(factory);
    const result = await s3.listObjectsV2(
      { Bucket: bucketName, Prefix: prefix },
    );

    if (result.IsTruncated) {
      // This would indicate something awry, since we shouldn't
      // ever have more than 1000 properties. And if we ever did,
      // everything would need to be rearchitected.
      throw new Error("Got truncated response from S3");
    }

    const manifests: RawManifest[] = [];
    for (const bucketEntry of result.Contents || []) {
      const key = bucketEntry.Key;
      if (bucketEntry.Size === 0 || !key) {
        continue;
      }

      const matches = key.match(/([^/]+).json$/);
      if (matches === null) {
        this.errors.push(`Got weird filename in manifest listing: "${key}"`);
        continue;
      }

      const searchProperty = matches[1];
      const data = await s3.getObject({ Bucket: bucketName, Key: key });

      manifests.push(
        new RawManifest(
          data.Body.toString("utf-8"),
          data.LastModified || new Date(0),
          searchProperty,
        ),
      );
    }

    return manifests;
  }

  getManifestsFromDirectory(prefix: string): RawManifest[] {
    const manifests: RawManifest[] = [];

    for (const entry of getFiles({ root: prefix, hasInfo: true })) {
      const matches = entry.path.match(/([^/]+).json$/);
      if (!matches) continue;
      const searchProperty = matches[1];

      const decoder = new TextDecoder("utf-8");
      manifests.push(
        new RawManifest(
          decoder.decode(Deno.readFileSync(entry.path)),
          entry.info?.mtime || new Date(0),
          searchProperty,
        ),
      );
    }

    return manifests;
  }

  async getManifests(): Promise<RawManifest[]> {
    const parsedSource = this.manifestSource.match(/((?:bucket)|(?:dir)):(.+)/);
    if (!parsedSource) {
      throw new Error("Bad manifest source");
    }

    logger.info(`Fetching manifests from ${parsedSource}`);
    let manifests: RawManifest[];
    if (parsedSource[1] === "bucket") {
      const parts = parsedSource[2].split("/", 2);
      const bucketName = parts[0].trim();
      const prefix = parts[1].trim();
      if (!bucketName.length || !prefix.length) {
        throw new Error("Bad bucket manifest source");
      }
      manifests = await this.getManifestsFromS3(bucketName, prefix);
    } else if (parsedSource[1] === "dir") {
      manifests = await this.getManifestsFromDirectory(parsedSource[2]);
    } else {
      throw new Error("Unknown manifest source protocol");
    }

    logger.info("Finished fetching manifests");
    return manifests;
  }

  async load() {
    if (this.currentlyIndexing) {
      throw new Error("already-indexing");
    }
    this.currentlyIndexing = true;

    let manifests: RawManifest[];
    try {
      manifests = await this.getManifests();
    } catch (err) {
      this.currentlyIndexing = false;
      throw err;
    }

    this.errors = [];
    setTimeout(async () => {
      for (const worker of this.workers.pool) {
        this.workers.suspend(worker);
        try {
          await worker.send({ sync: manifests });
        } finally {
          this.workers.resume(worker);
        }

        // Ideally we would have a lastSyncDate per worker.
        this.lastSyncDate = new Date();
      }

      this.currentlyIndexing = false;
      this.manifests = manifests.map((manifest) => manifest.searchProperty);

      logger.info("Loaded new index");
    }, 1);
  }
}

class HTTPStatusException extends Error {
  code: number;
  result: string;

  constructor(code: number, result: string) {
    super(`HTTP Status ${code}`);
    this.code = code;
    this.result = result;
    Error.captureStackTrace(this, HTTPStatusException);
  }
}

function escapeHTML(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

class Marian {
  index: Index;
  errors: Error[];

  constructor(bucket: string) {
    this.index = new Index(bucket);
    this.errors = [];

    // Fire-and-forget loading
    this.index.load().catch((err) => {
      this.errors.push(err);
    });
  }

  async start(port: number) {
    const server = serve({ hostname: "0.0.0.0", port: port });
    logger.info(`Listening on port ${port}`);

    for await (const request of server) {
      const response: Response = {};
      await this.handle(request, response);
      request.respond(response);
    }
  }

  async handle(req: ServerRequest, res: Response): Promise<void> {
    const parsedUrl = new URL(req.url, "http://example.com");

    const pathname = parsedUrl.pathname.replace(/\/+$/, "");
    if (pathname === "/search") {
      if (checkMethod(req, res, "GET")) {
        await this.handleSearch(parsedUrl, req, res);
      }
    } else if (pathname === "/refresh") {
      if (checkMethod(req, res, "POST")) {
        await this.handleRefresh(parsedUrl, req, res);
      }
    } else if (pathname === "/status") {
      if (checkMethod(req, res, "GET")) {
        await this.handleStatus(parsedUrl, req, res);
      }
    } else if (pathname === "") {
      if (checkMethod(req, res, "GET")) {
        await this.handleUI(parsedUrl, req, res);
      }
    } else {
      res.status = 404;
    }
  }

  async handleRefresh(parsedUrl: URL, req: ServerRequest, res: Response) {
    const headers: Headers = new Headers({
      "Vary": "Accept-Encoding",
    });
    Object.assign(headers, STANDARD_HEADERS);

    try {
      await this.index.load();
    } catch (err) {
      headers.set("Content-Type", "application/json");
      const body = JSON.stringify({ "errors": [err] });

      res.headers = headers;
      if (err.message === "already-indexing") {
        logger.warning("Index request rejected: busy");
        res.status = 200;
        res.headers = headers;
      } else {
        res.status = 500;
      }
      res.body = body;
      return;
    }

    if (this.index.errors.length > 0) {
      headers.set("Content-Type", "application/json");
      const body = JSON.stringify({ "errors": this.index.errors });
      res.status = 200;
      res.headers = headers;
      res.body = body;
      return;
    }

    res.status = 200;
    res.headers = headers;
  }

  async handleStatus(parsedUrl: URL, req: ServerRequest, res: Response) {
    const headers = {
      "Content-Type": "application/json",
      "Vary": "Accept-Encoding",
      "Pragma": "no-cache",
      "Access-Control-Allow-Origin": "*",
    };
    Object.assign(headers, STANDARD_HEADERS);

    const status = this.index.getStatus();
    const body = JSON.stringify(status);

    // If all workers are overloaded, return 503
    let statusCode = 200;
    if (status.workers.filter((n) => n <= WARNING_BACKLOG).length === 0) {
      statusCode = 503;
    }

    res.headers = new Headers(headers);
    res.status = statusCode;
    res.body = body;
  }

  async fetchResults(parsedUrl: URL, req: ServerRequest): Promise<Result[]> {
    const rawIfModifiedSince = req.headers.get("if-modified-since");
    if (rawIfModifiedSince && this.index.lastSyncDate) {
      const lastSyncDateNoMilliseconds = new Date(this.index.lastSyncDate);
      // HTTP dates truncate the milliseconds.
      lastSyncDateNoMilliseconds.setMilliseconds(0);

      const ifModifiedSince = new Date(rawIfModifiedSince);
      if (ifModifiedSince >= lastSyncDateNoMilliseconds) {
        throw new HTTPStatusException(304, "");
      }
    }

    if (parsedUrl.search.length > MAXIMUM_QUERY_LENGTH) {
      throw new HTTPStatusException(400, "[]");
    }

    const query = parsedUrl.searchParams.get("q");
    if (!query) {
      throw new HTTPStatusException(400, "[]");
    }

    try {
      return await this.index.search(
        query,
        parsedUrl.searchParams.get("searchProperty") || "",
      );
    } catch (err) {
      if (
        err.message === "still-indexing" ||
        err.message === "backlog-exceeded" || err.message === "pool-unavailable"
      ) {
        // Search index isn't yet loaded, or our backlog is out of control
        logger.error(`Cannot respond to request: ${err.message}`);
        throw new HTTPStatusException(503, "[]");
      } else if (err.message === "query-too-long") {
        throw new HTTPStatusException(400, "[]");
      }

      logger.error(err);
    }

    return [];
  }

  async handleSearch(parsedUrl: URL, req: ServerRequest, res: Response) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Vary": "Accept-Encoding",
      "Cache-Control": "public,max-age=120,must-revalidate",
      "Access-Control-Allow-Origin": "*",
    };
    Object.assign(headers, STANDARD_HEADERS);

    let results;
    try {
      results = await this.fetchResults(parsedUrl, req);
    } catch (err) {
      if (err.code === undefined || err.result === undefined) {
        throw (err);
      }

      res.status = err.code;
      res.headers = new Headers(headers);
      res.body = err.result;
      return;
    }

    if (this.index.lastSyncDate) {
      headers["Last-Modified"] = this.index.lastSyncDate.toUTCString();
    }
    const responseBody = JSON.stringify(results);

    res.status = 200;
    res.headers = new Headers(headers);
    res.body = responseBody;
  }

  async handleUI(parsedUrl: URL, req: ServerRequest, res: Response) {
    const headers = {
      "Content-Type": "text/html",
      "Vary": "Accept-Encoding",
      "Cache-Control": "public,max-age=120,must-revalidate",
    };
    Object.assign(headers, STANDARD_HEADERS);

    const dataList = this.index.manifests.map((manifest) =>
      encodeURIComponent(manifest)
    );
    if (dataList.length > 0) {
      dataList.unshift("");
    }

    const query = parsedUrl.searchParams.get("q") || "";
    const searchProperty = parsedUrl.searchParams.get("searchProperty") || "";
    let results: Result[] = [];
    let resultError = false;
    if (query) {
      try {
        results = (await this.fetchResults(parsedUrl, req));
      } catch (err) {
        if (err.code === undefined || err.result === undefined) {
          throw (err);
        }

        resultError = true;
      }
    }

    const resultTextParts = results.map((result) => {
      return `<li class="result">
                <div class="result-title"><a href="${encodeURI(result.url)}">${
        escapeHTML(result.title)
      }</a></div>
                <div class="result-preview">${escapeHTML(result.preview)}</div>
            </li>`;
    });

    const responseBody = `<!doctype html><html lang="en">
        <head><title>Marian</title><meta charset="utf-8">
        <style>
        .results{list-style:none}
        .result{padding:10px 0;max-width:50em}
        </style>
        </head>
        <body>
        <form>
        <input placeholder="Search query" maxLength=100 id="input-search" autofocus value="${
      escapeHTML(query)
    }">
        <input placeholder="Property to search" maxLength=50 list="properties" id="input-properties" value="${
      escapeHTML(searchProperty)
    }">
        <input type="submit" value="search" formaction="javascript:search()">
        </form>
        <datalist id=properties>
        ${dataList.join("<option>")}
        </datalist>
        ${resultError ? "<p>Error fetching results</p>" : ""}
        <ul class="results">
        ${resultTextParts.join("\n")}
        </ul>
        <script>
        function search() {
            const rawQuery = document.getElementById("input-search").value
            const rawProperties = document.getElementById("input-properties").value.trim()
            const propertiesComponent = rawProperties.length > 0 ? "&searchProperty=" + encodeURIComponent(rawProperties) : ""
            document.location.search = "q=" + encodeURIComponent(rawQuery) + propertiesComponent
        }
        </script>
        </body>
        </html>`;

    res.status = 200;
    res.headers = new Headers(headers);
    res.body = responseBody;
  }
}

async function main() {
  await log.setup({ filter: "INFO" });

  const manifestSource = Deno.args[0];
  if (!manifestSource) {
    throw new Error("Must provide a manifest source");
  }

  const server = new Marian(manifestSource);
  await server.start(8080);
}

main();
