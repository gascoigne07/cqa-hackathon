/**
 * Transport abstraction. Every screen talks to the backend only through this
 * interface, so moving the UI into Dynamics 365 means writing one new
 * implementation (e.g. an Xrm.WebApi / custom API transport) — no screen changes.
 */
export interface StreamHandlers<T> {
  onEvent: (event: string, data: T) => void;
  onError?: (err: Event) => void;
}

export interface Transport {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  upload<T>(path: string, file: File): Promise<T>;
  /** Server-Sent Events stream. Returns a function that closes the stream. */
  stream<T>(path: string, handlers: StreamHandlers<T>): () => void;
  /** Absolute URL for things the browser loads directly (audio). */
  url(path: string): string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
