"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hasGeolocation } from "@/lib/geolocation";
import { locateMe, rememberLocateRefused, wasLocateRefused } from "@/lib/locate-me";
import { loadLocation } from "@/lib/location-loader";
import { readStoredNear, subscribeStoredNear, writeStoredNear } from "@/lib/near-storage";
import { placeName } from "@/lib/place";
import type { Coordinates } from "@/lib/types";

/**
 * A request to centre the map and zoom in (lib/map-layout.ts MAP_NEAR_ZOOM). `id` tells a new
 * request from one the map has already applied. `smooth`: fly there (unless the visitor prefers
 * reduced motion) rather than jump. The coordinates live only in component state, until applied.
 */
export interface MapFocus extends Coordinates {
  id: number;
  smooth: boolean;
}

const noSubscribe = () => () => {};
const serverFalse = () => false;

export const LOCATE_FAILED = "Couldn’t find your location.";
const CENTRE_FAILED = "Couldn’t centre the map on that suburb.";
const STATUS_MS = 6000;

type Status = { tone: "info" | "danger"; text: string } | null;

/**
 * /map following the visitor's location (docs/architecture.md, "Location (near you)"):
 *  - on open, with no suburb saved, no refusal this session and nothing in the address that
 *    should win (`promptOnOpen`), asks the browser once;
 *  - `locate` does the same on demand ("Near me");
 *  - either way a position becomes a centre request and the suburb it's in is saved (name and
 *    state only, as the search bar's "Use my current location" does); the position is dropped
 *    once the map has used it;
 *  - the saved suburb changing while on the map (the search bar, another tab) centres on it too;
 *  - `centreOn` centres on any place (the location filter).
 */
export function useMapLocate(promptOnOpen: boolean) {
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const canLocate = useSyncExternalStore(noSubscribe, hasGeolocation, serverFalse);
  const nextId = useRef(0);
  const busy = useRef(false);
  const prompted = useRef(false);
  // The suburb this hook is saving itself, so its own write isn't taken for a change to follow.
  const saving = useRef<string | null>(null);

  const centreOn = useCallback((place: Coordinates, smooth = true) => {
    nextId.current += 1;
    setFocus({ id: nextId.current, lat: place.lat, lng: place.lng, smooth });
  }, []);

  /** The map has applied request `id`: drop its coordinates. */
  const focused = useCallback((id: number) => setFocus((current) => (current?.id === id ? null : current)), []);
  const clearFocus = useCallback(() => setFocus(null), []);

  const locate = useCallback(
    async (onOpen: boolean) => {
      if (busy.current) return;
      busy.current = true;
      setLocating(true);
      setStatus(null);
      const result = await locateMe();
      busy.current = false;
      setLocating(false);
      if (result.kind !== "found") {
        // Silent on open (the default view stays); the visitor can press Near me later.
        if (onOpen) rememberLocateRefused();
        else setStatus({ tone: "danger", text: LOCATE_FAILED });
        return;
      }
      saving.current = result.suburb;
      writeStoredNear(result.suburb, result.state);
      saving.current = null;
      centreOn(result.position);
      setStatus({ tone: "info", text: `Map centred on ${placeName(result.suburb, result.state)}.` });
    },
    [centreOn],
  );

  useEffect(() => {
    if (!promptOnOpen || prompted.current) return;
    prompted.current = true;
    if (!hasGeolocation() || readStoredNear() !== "" || wasLocateRefused()) return;
    // Deferred, so the effect body itself never calls setState (as LiveEventFeed.tsx does).
    queueMicrotask(() => void locate(true));
  }, [promptOnOpen, locate]);

  useEffect(
    () =>
      subscribeStoredNear(() => {
        const suburb = readStoredNear();
        if (!suburb || suburb === saving.current) return;
        loadLocation()
          .then((table) => {
            const place = table.findLocality(suburb);
            if (place) centreOn(place);
          })
          .catch(() => setStatus({ tone: "danger", text: CENTRE_FAILED }));
      }),
    [centreOn],
  );

  // A message is brief: it goes after a few seconds.
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  return { focus, focused, clearFocus, centreOn, canLocate, locating, status, locate: () => locate(false) };
}
