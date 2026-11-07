// M0 research: classifying IP addresses for the network broker's SSRF rule. Hand-written (no new
// dependency): IPv4/IPv6 parsed to BigInt, compared against CIDR tables. IPv6 forms that embed an
// IPv4 address (IPv4-mapped, NAT64, 6to4) are checked by their embedded address too.
import net from "node:net";

export type AddressClass = "public" | "blocked";

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
  ["fec0::", 10, "site-local (deprecated)"],
  ["ff00::", 8, "multicast"],
];

function v4ToBig(ip: string): bigint {
  return ip.split(".").reduce((acc, part) => (acc << 8n) | BigInt(Number(part)), 0n);
}

function v6ToBig(ip: string): bigint {
  let text = ip.toLowerCase();
  // Trailing dotted IPv4 (e.g. ::ffff:127.0.0.1) -> two hex groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const v = v4ToBig(dotted[1]);
    text = text.slice(0, -dotted[1].length) + `${(v >> 16n).toString(16)}:${(v & 0xffffn).toString(16)}`;
  }
  const [head, tail] = text.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail !== undefined && tail !== "" ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = text.includes("::") ? [...headParts, ...Array(missing).fill("0"), ...tailParts] : headParts;
  return parts.reduce((acc, part) => (acc << 16n) | BigInt(parseInt(part || "0", 16)), 0n);
}

function inRange(value: bigint, base: bigint, prefix: number, bits: number): boolean {
  const shift = BigInt(bits - prefix);
  return value >> shift === base >> shift;
}

const V4_TABLE = V4_BLOCKED.map(([base, prefix, why]) => ({ base: v4ToBig(base), prefix, why }));
const V6_TABLE = V6_BLOCKED.map(([base, prefix, why]) => ({ base: v6ToBig(base), prefix, why }));

/** Why an address is blocked, or null for a public address. Throws for something that is not an IP. */
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
    // Embedded IPv4: ::ffff:0:0/96 (mapped), 64:ff9b::/96 (NAT64), ::/96 (compat), 2002::/16 (6to4).
    const embedded = (prefixBase: string, prefix: number, extract: (v: bigint) => bigint) =>
      inRange(v, v6ToBig(prefixBase), prefix, 128) ? extract(v) : null;
    const candidates = [
      embedded("::ffff:0:0", 96, (x) => x & 0xffffffffn),
      embedded("64:ff9b::", 96, (x) => x & 0xffffffffn),
      embedded("64:ff9b:1::", 48, (x) => x & 0xffffffffn),
      embedded("::", 96, (x) => x & 0xffffffffn),
      embedded("2002::", 16, (x) => (x >> 80n) & 0xffffffffn),
    ];
    for (const v4 of candidates) {
      if (v4 === null) continue;
      const hit = V4_TABLE.find((r) => inRange(v4, r.base, r.prefix, 32));
      return hit ? `embedded-ipv4 ${hit.why}` : null;
    }
    return null;
  }
  throw new Error(`not an IP address: ${address}`);
}

export const isBlockedAddress = (address: string): boolean => blockedReason(address) !== null;
