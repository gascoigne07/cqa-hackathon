import { ApiError, type StreamHandlers, type Transport } from "./transport";

declare global {
  interface Window {
    /** Set before the bundle loads to point a hosted copy (e.g. a Dynamics web resource) at the API. */
    CQA_API_BASE?: string;
  }
}

const BASE = (window.CQA_API_BASE ?? import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

async function parse<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = await res.json();
    if (typeof body.detail === "string") message = body.detail;
    else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join("; ");
  } catch {
    /* not JSON */
  }
  throw new ApiError(res.status, message);
}

export const httpTransport: Transport = {
  url: (path) => `${BASE}${path}`,

  async get(path) {
    return parse(await fetch(`${BASE}${path}`));
  },

  async post(path, body) {
    return parse(
      await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  },

  async upload(path, file) {
    const form = new FormData();
    form.append("file", file);
    return parse(await fetch(`${BASE}${path}`, { method: "POST", body: form }));
  },

  stream<T>(path: string, { onEvent, onError }: StreamHandlers<T>) {
    const source = new EventSource(`${BASE}${path}`);
    const handle = (name: string) => (e: MessageEvent) => onEvent(name, JSON.parse(e.data) as T);
    source.addEventListener("progress", handle("progress"));
    source.addEventListener("done", (e) => {
      handle("done")(e as MessageEvent);
      source.close();
    });
    source.onerror = (e) => {
      onError?.(e);
      source.close();
    };
    return () => source.close();
  },
};
