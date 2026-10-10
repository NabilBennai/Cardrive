import { afterEach, describe, expect, it, vi } from 'vitest';
import { MirrorHealth, OverpassProvider } from '../src/map/overpassProvider';

const bounds = { south: 43.49, west: -1.48, north: 43.5, east: -1.47 };

function jsonResponse(elements: unknown[], ok = true, status = 200): Response {
  return { ok, status, json: async () => ({ elements }) } as Response;
}

describe('OverpassProvider mirror fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getRoads tries the next mirror when one returns a suspiciously empty response (bug reproduced in session: a mirror silently returns 0 elements for a zone that has roads)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([
        { type: 'node', id: 1, lat: 43.49, lon: -1.48 },
        { type: 'node', id: 2, lat: 43.50, lon: -1.47 },
        { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
      ]));

    const provider = new OverpassProvider(['https://mirror-a/api/interpreter', 'https://mirror-b/api/interpreter']);
    const result = await provider.getRoads(bounds, new AbortController().signal);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.ways).toHaveLength(1);
  });

  it('getRoads accepts an empty result once every mirror has been tried (a genuinely empty zone is not an error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    const provider = new OverpassProvider(['https://mirror-a/api/interpreter', 'https://mirror-b/api/interpreter']);
    const result = await provider.getRoads(bounds, new AbortController().signal);
    expect(result.ways).toEqual([]);
  });

  it('getRoads falls through a hard error (e.g. HTTP 500) to the next mirror', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse([], false, 500))
      .mockResolvedValueOnce(jsonResponse([
        { type: 'node', id: 1, lat: 43.49, lon: -1.48 },
        { type: 'node', id: 2, lat: 43.50, lon: -1.47 },
        { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
      ]));
    const provider = new OverpassProvider(['https://mirror-a/api/interpreter', 'https://mirror-b/api/interpreter']);
    const result = await provider.getRoads(bounds, new AbortController().signal);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.ways).toHaveLength(1);
  });

  it('getBuildings accepts an empty response from the very first mirror without trying the rest (best-effort, zero buildings is normal)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
    const provider = new OverpassProvider(['https://mirror-a/api/interpreter', 'https://mirror-b/api/interpreter']);
    const result = await provider.getBuildings(bounds, new AbortController().signal);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.ways).toEqual([]);
  });
});

describe('MirrorHealth', () => {
  const urls = ['https://a', 'https://b', 'https://c'];

  it('keeps the configured order while every mirror is healthy', () => {
    expect(new MirrorHealth(() => 0).order(urls)).toEqual(urls);
  });

  it('pushes a mirror that just failed to the end, then trusts it again after the cooldown', () => {
    let now = 0;
    const health = new MirrorHealth(() => now);
    health.recordFailure('https://a');
    expect(health.order(urls)).toEqual(['https://b', 'https://c', 'https://a']);
    now = 29_000;
    expect(health.order(urls)[2]).toBe('https://a');
    now = 31_000;
    expect(health.order(urls)).toEqual(urls);
  });

  it('lengthens the cooldown with consecutive failures (capped at 5 minutes) and resets on success', () => {
    let now = 0;
    const health = new MirrorHealth(() => now);
    health.recordFailure('https://a'); health.recordFailure('https://a'); health.recordFailure('https://a');
    now = 100_000; // 3 échecs : 2 min de retrait
    expect(health.order(urls)[2]).toBe('https://a');
    now = 130_000;
    expect(health.order(urls)).toEqual(urls);
    for (let i = 0; i < 10; i += 1) health.recordFailure('https://a');
    now += 299_000;
    expect(health.order(urls)[2]).toBe('https://a');
    now += 2_000;
    expect(health.order(urls)).toEqual(urls); // plafonné à 5 min
    health.recordFailure('https://a');
    health.recordSuccess('https://a');
    expect(health.order(urls)).toEqual(urls);
  });

  it('never excludes a mirror: when all are penalized they are still tried, oldest failure first', () => {
    let now = 0;
    const health = new MirrorHealth(() => now);
    health.recordFailure('https://b'); now = 5; health.recordFailure('https://a'); now = 10; health.recordFailure('https://c');
    expect(health.order(urls)).toEqual(['https://b', 'https://a', 'https://c']);
  });

  it('counts a suspiciously empty response as half a failure: one is tolerated, two push the mirror back', () => {
    const health = new MirrorHealth(() => 0);
    health.recordFailure('https://a', 0.5);
    expect(health.order(urls)).toEqual(urls);
    health.recordFailure('https://a', 0.5);
    expect(health.order(urls)[2]).toBe('https://a');
  });
});

describe('OverpassProvider uses mirror health across requests', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('does not retry a mirror that just returned HTTP 500 first on the next request', async () => {
    const calledUrls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calledUrls.push(url);
      return url.includes('mirror-a')
        ? jsonResponse([], false, 500)
        : jsonResponse([
          { type: 'node', id: 1, lat: 43.49, lon: -1.48 },
          { type: 'node', id: 2, lat: 43.50, lon: -1.47 },
          { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
        ]);
    });
    const provider = new OverpassProvider(['https://mirror-a/api/interpreter', 'https://mirror-b/api/interpreter'], new MirrorHealth(() => 0));
    await provider.getRoads(bounds, new AbortController().signal);
    await provider.getRoads(bounds, new AbortController().signal);
    // 1re requête : a (500) puis b ; 2e requête : b directement, sans repasser par le miroir en panne.
    expect(calledUrls.map((url) => (url.includes('mirror-a') ? 'a' : 'b'))).toEqual(['a', 'b', 'b']);
  });
});
