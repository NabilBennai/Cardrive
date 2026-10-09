import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIN_QUERY_LENGTH, searchAddress } from '../src/map/geocodeProvider';

describe('searchAddress', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty array without calling fetch when the query is shorter than MIN_QUERY_LENGTH', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const results = await searchAddress('a'.repeat(MIN_QUERY_LENGTH - 1), new AbortController().signal);
    expect(results).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses valid Nominatim rows and drops malformed ones', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ([
        { display_name: 'Bayonne, France', lat: '43.49', lon: '-1.47' },
        { display_name: 'Invalide', lat: 'nope', lon: '2.0' },
      ]),
    } as Response);

    const results = await searchAddress('Bayonne', new AbortController().signal);
    expect(results).toEqual([{ label: 'Bayonne, France', point: { latitudeDeg: 43.49, longitudeDeg: -1.47 } }]);
  });

  it('throws when the response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(searchAddress('Bayonne', new AbortController().signal)).rejects.toThrow();
  });
});
