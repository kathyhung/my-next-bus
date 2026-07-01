import type {
  Bound,
  EtaRecord,
  FavouriteJourney,
  Operator,
  RouteVariant,
  StopOption,
} from "./types";

const KMB_BASE = "https://data.etabus.gov.hk/v1/transport/kmb";
const CTB_BASE = "https://rt.data.gov.hk/v2/transport/citybus";

interface ApiEnvelope<T> {
  data: T;
  generated_timestamp?: string;
}

interface KmbRouteRow {
  route: string;
  bound: Bound;
  service_type: string | number;
  orig_en: string;
  orig_tc: string;
  dest_en: string;
  dest_tc: string;
}

interface CitybusRouteRow {
  route: string;
  orig_en: string;
  orig_tc: string;
  dest_en: string;
  dest_tc: string;
}

interface RouteStopRow {
  stop: string;
  seq: string | number;
  bound?: Bound;
  dir?: Bound;
}

interface StopRow {
  stop: string;
  name_en: string;
  name_tc: string;
}

interface EtaRow {
  route: string;
  dir: Bound;
  service_type?: string | number;
  seq: string | number;
  eta_seq: string | number;
  eta: string | null;
  rmk_en?: string;
  rmk_tc?: string;
}

const routeCache = new Map<Operator, Promise<RouteVariant[]>>();
let kmbStopMapPromise: Promise<Map<string, StopRow>> | null = null;

function compareRoute(a: string, b: string) {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

function uniqueVariants(variants: RouteVariant[]) {
  const seen = new Set<string>();
  return variants.filter((variant) => {
    const key = [
      variant.operator,
      variant.route,
      variant.bound,
      variant.serviceType,
      variant.originEn,
      variant.destinationEn,
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchJson<T>(url: string, fresh = false): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      cache: fresh ? "no-store" : "default",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`The data service returned ${response.status}`);
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The data service took too long to respond");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function fetchRouteVariants(operator: Operator) {
  const cached = routeCache.get(operator);
  if (cached) return cached;

  const request = (async () => {
    if (operator === "KMB") {
      const payload = await fetchJson<ApiEnvelope<KmbRouteRow[]>>(
        `${KMB_BASE}/route/`,
      );
      return uniqueVariants(
        payload.data.map((row) => ({
          operator,
          route: row.route.toUpperCase(),
          bound: row.bound,
          serviceType: Number(row.service_type),
          originEn: row.orig_en,
          originTc: row.orig_tc,
          destinationEn: row.dest_en,
          destinationTc: row.dest_tc,
        })),
      ).sort((a, b) => compareRoute(a.route, b.route));
    }

    const payload = await fetchJson<ApiEnvelope<CitybusRouteRow[]>>(
      `${CTB_BASE}/route/CTB`,
    );
    const variants = payload.data.flatMap<RouteVariant>((row) => [
      {
        operator,
        route: row.route.toUpperCase(),
        bound: "O",
        serviceType: 1,
        originEn: row.orig_en,
        originTc: row.orig_tc,
        destinationEn: row.dest_en,
        destinationTc: row.dest_tc,
      },
      {
        operator,
        route: row.route.toUpperCase(),
        bound: "I",
        serviceType: 1,
        originEn: row.dest_en,
        originTc: row.dest_tc,
        destinationEn: row.orig_en,
        destinationTc: row.orig_tc,
      },
    ]);
    return uniqueVariants(variants).sort((a, b) => compareRoute(a.route, b.route));
  })();

  routeCache.set(operator, request);
  request.catch(() => routeCache.delete(operator));
  return request;
}

async function getKmbStopMap() {
  if (!kmbStopMapPromise) {
    kmbStopMapPromise = fetchJson<ApiEnvelope<StopRow[]>>(`${KMB_BASE}/stop`)
      .then(
        (payload) =>
          new Map(payload.data.map((stop) => [stop.stop, stop] as const)),
      )
      .catch((error) => {
        kmbStopMapPromise = null;
        throw error;
      });
  }
  return kmbStopMapPromise;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return output;
}

function directionPath(bound: Bound) {
  return bound === "I" ? "inbound" : "outbound";
}

export async function fetchStopsForVariant(variant: RouteVariant) {
  const direction = directionPath(variant.bound);

  if (variant.operator === "KMB") {
    const [routeStops, stopMap] = await Promise.all([
      fetchJson<ApiEnvelope<RouteStopRow[]>>(
        `${KMB_BASE}/route-stop/${encodeURIComponent(variant.route)}/${direction}/${variant.serviceType}`,
      ),
      getKmbStopMap(),
    ]);

    return routeStops.data
      .filter((row) => (row.bound ?? row.dir) === variant.bound)
      .map<StopOption>((row) => {
        const stop = stopMap.get(row.stop);
        return {
          stopId: row.stop,
          seq: Number(row.seq),
          nameEn: stop?.name_en ?? `Stop ${row.stop}`,
          nameTc: stop?.name_tc ?? stop?.name_en ?? `站點 ${row.stop}`,
        };
      })
      .sort((a, b) => a.seq - b.seq);
  }

  const routeStops = await fetchJson<ApiEnvelope<RouteStopRow[]>>(
    `${CTB_BASE}/route-stop/CTB/${encodeURIComponent(variant.route)}/${direction}`,
  );
  const selectedRows = routeStops.data
    .filter((row) => (row.dir ?? row.bound) === variant.bound)
    .sort((a, b) => Number(a.seq) - Number(b.seq));

  return mapWithConcurrency(selectedRows, 5, async (row) => {
    try {
      const payload = await fetchJson<ApiEnvelope<StopRow>>(
        `${CTB_BASE}/stop/${row.stop}`,
      );
      return {
        stopId: row.stop,
        seq: Number(row.seq),
        nameEn: payload.data.name_en,
        nameTc: payload.data.name_tc,
      };
    } catch {
      return {
        stopId: row.stop,
        seq: Number(row.seq),
        nameEn: `Stop ${row.stop}`,
        nameTc: `站點 ${row.stop}`,
      };
    }
  });
}

export async function fetchJourneyEtas(journey: FavouriteJourney) {
  const url =
    journey.operator === "KMB"
      ? `${KMB_BASE}/eta/${journey.stopId}/${encodeURIComponent(journey.route)}/${journey.serviceType}`
      : `${CTB_BASE}/eta/CTB/${journey.stopId}/${encodeURIComponent(journey.route)}`;

  const payload = await fetchJson<ApiEnvelope<EtaRow[]>>(url, true);
  const records = payload.data
    .filter(
      (row) =>
        row.route.toUpperCase() === journey.route.toUpperCase() &&
        row.dir === journey.bound &&
        // Citybus ETA responses are already scoped to the requested stop and
        // route. Their live trip sequence can differ from the canonical
        // route-stop sequence, so only KMB should require an exact match.
        (journey.operator === "CTB" || Number(row.seq) === journey.seq) &&
        row.eta,
    )
    .map<EtaRecord>((row) => ({
      timestamp: Date.parse(row.eta as string),
      etaSequence: Number(row.eta_seq),
      remarkEn: row.rmk_en ?? "",
      remarkTc: row.rmk_tc ?? "",
    }))
    .filter((record) => Number.isFinite(record.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 3);

  return {
    records,
    generatedAt: payload.generated_timestamp,
  };
}
