"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hasGeolocation } from "@/lib/geolocation";
import { currentInAppLocationHelp } from "@/lib/in-app-browser";
import { locateMe, rememberLocateRefused, wasLocateRefused } from "@/lib/locate-me";
import { loadLocation, loadedLocation, type LocationModule } from "@/lib/location-loader";
import { readStoredNear, subscribeStoredNear, writeStoredNear } from "@/lib/near-storage";
import { placeName } from "@/lib/place";
import type { Coordinates } from "@/lib/types";

/**
 * A request to centre the map and zoom in (lib/map-layout.ts MAP_NEAR_ZOOM). `id` tells a new
 * request from one the map has already applied. `smooth`: fly there (unless the visitor prefers
 * reduced motion) rather than jump. `nearby`: frame the nearest events with the place too
 * (lib/map-near.ts), not just centre on it. The coordinates live only in component state.
 */
export interface MapFocus extends Coordinates {
  id: number;
  smooth: boolean;
  nearby: boolean;
}

/**
 * Where the visitor is for "nearest first": their position from this page's last Near me (or the
 * ask on open), or the centre of the suburb saved since. Component state only, for as long as the
 * page is open: never stored, put in an address or sent anywhere. `precise`: a real position
 * (the map marks it), not a suburb's centre.
 */
export interface MapOrigin extends Coordinates {
  precise: boolean;
}

/**
 * Called when a position is found, before the map moves to it. `byRequest`: the visitor pressed Near
 * me (rather than the browser being asked on open). It may return what to announce instead of
 * "Map centred on …" (the event it opened, say).
 */
export type LocatedHandler = (position: Coordinates, byRequest: boolean) => string | null;

const noSubscribe = () => () => {};
const serverFalse = () => false;

export const LOCATE_FAILED = "Couldn’t find your location.";
const CENTRE_FAILED = "Couldn’t centre the map on that suburb.";
const STATUS_MS = 6000;
// A message with a link in it stays longer (WCAG 2.2.1): long enough to read it and press the link.
const STATUS_LINK_MS = 20_000;

/** `link`: a way out to the device's own browser (lib/in-app-browser.ts). */
export type MapLocateStatus = { tone: "info" | "danger"; text: string; link?: { label: string; href: string } } | null;
type Status = MapLocateStatus;

/**
 * /map following the visitor's location (docs/architecture.md, "Location (near you)"):
 *  - on open, with no suburb saved, no refusal this session and nothing in the address that
 *    should win (`promptOnOpen`), asks the browser once;
 *  - `locate` does the same on demand ("Near me"), and tells `onLocated` it was asked for, so the
 *    page can open the nearest event (only for a press, not for the ask on open);
 *  - either way a position becomes a centre request that frames the nearest events with it, and
 *    the suburb it's in is saved (name and state only, as the search bar's "Use my current
 *    location" does); the request's coordinates are dropped once the map has used it, while
 *    `origin` keeps them in this page's memory for "nearest first" (never stored or sent);
 *  - the saved suburb changing while on the map (the search bar, another tab) does the same for
 *    that suburb's centre;
 *  - `centreOn` centres on a place already in hand; `centreOnSuburb` finds a suburb by its name
 *    first (the location filter), loading the suburb table if nothing has yet.
 */
export function useMapLocate(promptOnOpen: boolean, onLocated?: LocatedHandler) {
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [origin, setOrigin] = useState<MapOrigin | null>(null);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const canLocate = useSyncExternalStore(noSubscribe, hasGeolocation, serverFalse);
  const nextId = useRef(0);
  const busy = useRef(false);
  const prompted = useRef(false);
  // The suburb this hook is saving itself, so its own write isn't taken for a change to follow.
  const saving = useRef<string | null>(null);
  // The latest suburb asked for by name: a slow table load for an earlier pick mustn't win over a later one.
  const suburbAsk = useRef(0);
  // Latest `onLocated` for the async locate below.
  const onLocatedRef = useRef(onLocated);
  useEffect(() => {
    onLocatedRef.current = onLocated;
  });

  const centreOn = useCallback((place: Coordinates, smooth = true, nearby = false) => {
    nextId.current += 1;
    setFocus({ id: nextId.current, lat: place.lat, lng: place.lng, smooth, nearby });
  }, []);

  /**
   * Centres on the suburb `query` finds (lib/place.ts placeQuery), once the suburb table has loaded.
   * `asOrigin`: the suburb is where the visitor is now (the saved suburb changed), so the list goes
   * nearest first from there and the map frames the events near it; a suburb picked in the location
   * filter just centres.
   */
  const centreOnSuburb = useCallback(
    (query: string, asOrigin = false) => {
      suburbAsk.current += 1;
      const ask = suburbAsk.current;
      const centreIn = (table: LocationModule) => {
        const place = table.findLocality(query);
        if (!place) return;
        if (asOrigin) setOrigin({ lat: place.lat, lng: place.lng, precise: false });
        centreOn(place, true, asOrigin);
      };
      // Already loaded: centre in this very update, with the filter change that asked for it.
      const loaded = loadedLocation();
      if (loaded) {
        centreIn(loaded);
        return;
      }
      loadLocation()
        .then((table) => {
          if (ask === suburbAsk.current) centreIn(table);
        })
        .catch(() => {
          if (ask === suburbAsk.current) setStatus({ tone: "danger", text: CENTRE_FAILED });
        });
    },
    [centreOn],
  );

  /** The map has applied request `id`: drop its coordinates. */
  const focused = useCallback((id: number) => setFocus((current) => (current?.id === id ? null : current)), []);
  const clearFocus = useCallback(() => {
    suburbAsk.current += 1;
    setFocus(null);
  }, []);

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
        else if (result.kind === "outside") setStatus({ tone: "danger", text: LOCATE_FAILED });
        else {
          // In an in-app browser (Instagram, Facebook…) location usually can't work: say so, offer the real browser.
          const inApp = currentInAppLocationHelp();
          setStatus(
            inApp
              ? { tone: "danger", text: inApp.text, link: inApp.link ?? undefined }
              : { tone: "danger", text: LOCATE_FAILED },
          );
        }
        return;
      }
      saving.current = result.suburb;
      writeStoredNear(result.suburb, result.state);
      saving.current = null;
      const announcement = onLocatedRef.current?.(result.position, !onOpen) ?? null;
      setOrigin({ lat: result.position.lat, lng: result.position.lng, precise: true });
      centreOn(result.position, true, true);
      setStatus({ tone: "info", text: announcement ?? `Map centred on ${placeName(result.suburb, result.state)}.` });
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
        centreOnSuburb(suburb, true);
      }),
    [centreOnSuburb],
  );

  // A message is brief: it goes after a few seconds.
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), status.link ? STATUS_LINK_MS : STATUS_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  return { focus, focused, clearFocus, origin, centreOn, centreOnSuburb, canLocate, locating, status, locate: () => locate(false) };
}
