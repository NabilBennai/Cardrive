import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverpassProvider } from '../src/map/overpassProvider';

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
