/* HTTP client for the Nexus API.
 * The session lives in an HttpOnly cookie (nexus_token) issued by the server,
 * so every request just needs same-origin credentials. */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.code = message;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new ApiError(data?.error || data?.message || `Request failed (${res.status})`, res.status);
  return data;
}

export const fmt = (cents) =>
  (Number(cents || 0) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const fmtUsd = (cents) => `$${fmt(cents)}`;

export const fmtMult = (m) => `${Number(m || 0).toFixed(2)}x`;

export const timeAgo = (ts) => {
  const s = Math.floor((Date.now() - Number(ts || 0)) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

export const dt = (ts) => new Date(Number(ts) || 0).toLocaleString();
