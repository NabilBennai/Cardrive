import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LapHudState, RaceNotice } from '../ui/LapHud';
import { decodeGhost, encodeGhost, loadGhosts, saveGhosts, withGhost, type Ghost, type GhostBook } from './ghost';
import { formatDelta, formatLapTime, type LapTimerEvent } from './lapTimer';
import type { RaceSnapshot } from './RaceDriver';
import { loadRecords, recordKey, saveRecords, withLap, type RecordBook } from './records';

const NOTICE_MS = 3_500;

interface SessionState {
  /** Circuit × véhicule auquel ces valeurs se rapportent : changer de l'un ou de l'autre repart de zéro. */
  key: string;
  snapshot: RaceSnapshot | null;
  lastS: number | null;
  lastInvalidReason: string | null;
  notice: RaceNotice | null;
}

const emptySession = (key: string): SessionState => ({ key, snapshot: null, lastS: null, lastInvalidReason: null, notice: null });

/**
 * État de course d'un circuit : alimenté par RaceDriver, il tient le tableau de chrono, les messages et le carnet de records
 * (relu et réécrit dans localStorage). `circuitId` null = pas de course (route, piste d'essai).
 */
export function useRaceSession(circuitId: string | null, carId: string) {
  const key = circuitId ? recordKey(circuitId, carId) : '';
  const [records, setRecords] = useState<RecordBook>(loadRecords);
  const recordsRef = useRef(records);
  const [ghosts, setGhosts] = useState<GhostBook>(loadGhosts);
  const ghostsRef = useRef(ghosts);
  const pendingGhost = useRef<Ghost | null>(null);
  const [session, setSession] = useState<SessionState>(() => emptySession(key));
  const noticeSeq = useRef(0);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(key);
  useLayoutEffect(() => { keyRef.current = key; }, [key]);

  const current = session.key === key ? session : emptySession(key);
  const reference = key ? records[key] ?? null : null;
  const storedGhost = key ? ghosts[key] : undefined;
  const ghost = useMemo(() => (storedGhost ? decodeGhost(storedGhost) : null), [storedGhost]);

  const onLapGhost = useCallback((lapGhost: Ghost) => { pendingGhost.current = lapGhost; }, []);

  const showNotice = useCallback((kind: RaceNotice['kind'], text: string) => {
    noticeSeq.current += 1;
    const notice: RaceNotice = { id: noticeSeq.current, kind, text };
    setSession((s) => ({ ...(s.key === keyRef.current ? s : emptySession(keyRef.current)), notice }));
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => {
      setSession((s) => (s.notice?.id === notice.id ? { ...s, notice: null } : s));
    }, NOTICE_MS);
  }, []);

  const onSnapshot = useCallback((snapshot: RaceSnapshot) => {
    setSession((s) => ({ ...(s.key === keyRef.current ? s : emptySession(keyRef.current)), snapshot }));
  }, []);

  const onEvent = useCallback((event: LapTimerEvent) => {
    const activeKey = keyRef.current;
    if (!activeKey) return;
    if (event.type === 'invalid') {
      showNotice('warning', event.reason === 'repositionnée' ? 'Voiture repositionnée : tour perdu' : `Tour invalide : ${event.reason}`);
      return;
    }
    if (event.type === 'sector') {
      const best = recordsRef.current[activeKey];
      const split = best ? event.cumulativeS - best.profileS[Math.round(((event.index + 1) / 3) * (best.profileS.length - 1))] : null;
      showNotice('info', `Secteur ${event.index + 1} · ${formatLapTime(event.sectorS)}${split !== null && Number.isFinite(split) ? ` · ${formatDelta(split)}` : ''}`);
      return;
    }
    if (event.type !== 'lap') return;
    if (!event.valid) {
      setSession((s) => ({ ...(s.key === activeKey ? s : emptySession(activeKey)), lastS: null, lastInvalidReason: event.reason }));
      return;
    }
    const result = withLap(recordsRef.current, activeKey, { bestS: event.lapS, sectorS: event.sectorS, profileS: event.profileS }, Date.now());
    if (result.improved) {
      recordsRef.current = result.book;
      setRecords(result.book);
      saveRecords(result.book);
      if (pendingGhost.current) {
        const book = withGhost(ghostsRef.current, activeKey, encodeGhost(pendingGhost.current, Date.now()));
        ghostsRef.current = book;
        setGhosts(book);
        saveGhosts(book);
      }
    }
    setSession((s) => ({ ...(s.key === activeKey ? s : emptySession(activeKey)), lastS: event.lapS, lastInvalidReason: null }));
    showNotice(result.improved ? 'record' : 'info', result.improved ? `Nouveau record · ${formatLapTime(event.lapS)}` : `Tour ${event.lapNumber} · ${formatLapTime(event.lapS)}`);
  }, [showNotice]);

  const hud: LapHudState = useMemo(() => {
    const s = current.snapshot;
    return {
      lapNumber: s?.lapNumber ?? 0,
      started: s?.started ?? false,
      currentS: s?.currentS ?? 0,
      valid: s?.valid ?? true,
      invalidReason: s?.invalidReason ?? null,
      deltaS: s?.deltaS ?? null,
      bestS: reference?.bestS ?? null,
      lastS: current.lastS,
      lastInvalidReason: current.lastInvalidReason,
    };
  }, [current.snapshot, current.lastS, current.lastInvalidReason, reference]);

  return { hud, notice: current.notice, records, referenceProfileS: reference?.profileS ?? null, ghost, onLapGhost, onSnapshot, onEvent };
}
