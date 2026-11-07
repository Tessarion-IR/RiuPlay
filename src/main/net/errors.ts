// RiuPlay M3: why a request through the controlled path was refused or failed. Messages never
// contain credentials, query strings or full URLs (see redact.ts) - at most a host name.
export type NetErrorCode =
  | "invalid-url"
  | "scheme-not-allowed"
  | "http-not-allowed"
  | "credentials-in-url"
  | "host-not-permitted"
  | "blocked-address"
  | "dns-failed"
  | "too-many-redirects"
  | "downgrade"
  | "body-too-large"
  | "decoded-too-large"
  | "timeout"
  | "aborted"
  | "proxy-failed"
  | "proxy-invalid"
  | "proxy-unavailable"
  | "connect-failed"
  | "rate-limited"
  | "too-many-requests"
  | "quota-exceeded";

export class NetError extends Error {
  constructor(
    readonly code: NetErrorCode,
    message: string,
  ) {
    super(`${message} (${code})`);
    this.name = "NetError";
  }
}

/** Failures that a retry could plausibly fix (transport), as opposed to refusals by policy. */
export const RETRYABLE_CODES: ReadonlySet<NetErrorCode> = new Set(["timeout", "connect-failed", "dns-failed"]);
