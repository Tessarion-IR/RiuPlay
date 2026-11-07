// RiuPlay M3: which IP addresses a request may connect to. Production version of the M0 research
// classifier (research/m0/net/ip.ts, kept unchanged for reproducibility). IPv4/IPv6 are parsed to
// BigInt and compared against CIDR tables; IPv6 forms that embed an IPv4 address (IPv4-mapped,
// NAT64, IPv4-compatible, 6to4) are judged by the embedded address too.
import net from "node:net";

const V4_BLOCKED: Array<[string, number, string]> = [
  ["0.0.0.0", 8, "this-network"],
  ["10.0.0.0", 8, "private"],
  ["100.64.0.0", 10, "carrier-nat"],
  ["127.0.0.0", 8, "loopback"],
  ["169.254.0.0", 16, "link-local (incl. cloud metadata)"],
  ["172.16.0.0", 12, "private"],
  ["192.0.0.0", 24, "ietf-assignments"],
  ["192.0.2.0", 24, "documentation"],
  ["192.88.99.0", 24, "6to4-relay"],
  ["192.168.0.0", 16, "private"],
  ["198.18.0.0", 15, "benchmarking"],
  ["198.51.100.0", 24, "documentation"],
  ["203.0.113.0", 24, "documentation"],
  ["224.0.0.0", 4, "multicast"],
  ["240.0.0.0", 4, "reserved/broadcast"],
];

const V6_BLOCKED: Array<[string, number, string]> = [
  ["::", 128, "unspecified"],
  ["::1", 128, "loopback"],
  ["100::", 64, "discard"],
  ["2001::", 32, "teredo"],
  ["2001:db8::", 32, "documentation"],
  ["fc00::", 7, "unique-local"],
  ["fe80::", 10, "link-local"],
  ["fec0::", 10, "site-local"],
  ["ff00::", 8, "multicast"],
];

function v4ToBig(ip: string): bigint {
  return ip.split(".").reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
}

function v6ToBig(ip: string): bigint {
  let text = ip.toLowerCase();
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const v = v4ToBig(dotted[1]);
    text = text.slice(0, -dotted[1].length) + `${(v >> 16n).toString(16)}:${(v & 0xffffn).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const parts = text.includes("::") ? [...headParts, ...Array(8 - headParts.length - tailParts.length).fill("0"), ...tailParts] : headParts;
  return parts.reduce((acc, part) => (acc << 16n) | BigInt(parseInt(part || "0", 16)), 0n);
}

const inRange = (value: bigint, base: bigint, prefix: number, bits: number) => value >> BigInt(bits - prefix) === base >> BigInt(bits - prefix);
const V4_TABLE = V4_BLOCKED.map(([base, prefix, why]) => ({ base: v4ToBig(base), prefix, why }));
const V6_TABLE = V6_BLOCKED.map(([base, prefix, why]) => ({ base: v6ToBig(base), prefix, why }));
const EMBEDDING: Array<[string, number, (v: bigint) => bigint]> = [
  ["::ffff:0:0", 96, (x) => x & 0xffffffffn], // IPv4-mapped
  ["64:ff9b::", 96, (x) => x & 0xffffffffn], // NAT64
  ["64:ff9b:1::", 48, (x) => x & 0xffffffffn], // local-use NAT64
  ["::", 96, (x) => x & 0xffffffffn], // IPv4-compatible (deprecated)
  ["2002::", 16, (x) => (x >> 80n) & 0xffffffffn], // 6to4
];

/** Why an address must not be contacted, or null for a public address. Throws for a non-IP. */
export function blockedReason(address: string): string | null {
  const kind = net.isIP(address);
  if (kind === 4) {
    const v = v4ToBig(address);
    return V4_TABLE.find((r) => inRange(v, r.base, r.prefix, 32))?.why ?? null;
  }
  if (kind === 6) {
    if (address.includes("%")) return "ipv6-zone-id";
    const v = v6ToBig(address);
    const direct = V6_TABLE.find((r) => inRange(v, r.base, r.prefix, 128));
    if (direct) return direct.why;
    for (const [base, prefix, extract] of EMBEDDING) {
      if (!inRange(v, v6ToBig(base), prefix, 128)) continue;
      const v4 = extract(v);
      const hit = V4_TABLE.find((r) => inRange(v4, r.base, r.prefix, 32));
      return hit ? `embedded-ipv4 ${hit.why}` : null;
    }
    return null;
  }
  throw new Error("not an IP address");
}

export const isBlockedAddress = (address: string): boolean => blockedReason(address) !== null;
