/**
 * Turns on Opus DTX (no packets during silence) for what *we* send. `usedtx` in an SDP states the
 * preference of that SDP's receiver, so it goes into the remote description before it is
 * applied: our encoder then honors it. Munging the remote side keeps the browser's own offers and
 * answers untouched, which perfect negotiation relies on.
 */
export function withOpusDtx(sdp: string): string {
  const opus = new Set<string>();
  for (const m of sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000/gim)) opus.add(m[1] as string);
  if (opus.size === 0) return sdp;
  return sdp.replace(/^a=fmtp:(\d+) ([^\r\n]*)/gm, (line, pt: string, params: string) => {
    if (!opus.has(pt) || /(^|;)\s*usedtx=/.test(params)) return line;
    return `a=fmtp:${pt} ${params};usedtx=1`;
  });
}
