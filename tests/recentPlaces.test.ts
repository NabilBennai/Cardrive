import { describe, expect, it } from 'vitest';
import { MAX_RECENT_PLACES, withRecentPlace, type RecentPlace } from '../src/map/recentPlaces';

const place = (n: number): RecentPlace => ({ label: `lieu ${n}`, point: { latitudeDeg: 40 + n, longitudeDeg: 2 } });

describe('withRecentPlace', () => {
  it('puts the newest first and caps the list at five', () => {
    let list: RecentPlace[] = [];
    for (let n = 1; n <= 7; n += 1) list = withRecentPlace(list, place(n));
    expect(list).toHaveLength(MAX_RECENT_PLACES);
    expect(list.map((p) => p.label)).toEqual(['lieu 7', 'lieu 6', 'lieu 5', 'lieu 4', 'lieu 3']);
  });

  it('moves a re-chosen place to the front instead of duplicating it', () => {
    const list = withRecentPlace([place(1), place(2), place(3)], place(3));
    expect(list.map((p) => p.label)).toEqual(['lieu 3', 'lieu 1', 'lieu 2']);
  });
});
