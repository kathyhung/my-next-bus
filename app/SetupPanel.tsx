"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchRouteVariants, fetchStopsForVariant } from "./bus-api";
import type {
  FavouriteJourney,
  JourneyLeg,
  Language,
  Operator,
  RouteVariant,
  StopOption,
} from "./types";

interface JointRouteDraft {
  primary: FavouriteJourney;
  alternativeVariant: RouteVariant;
  stops: StopOption[];
  selectedStopId: string;
  suggestedStopId: string;
}

interface SetupPanelProps {
  favourites: FavouriteJourney[];
  language: Language;
  sheetName: string;
  onAdd: (journey: FavouriteJourney) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

function readableError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong while loading bus data";
}

function journeyDestination(journey: RouteVariant, language: Language) {
  if (language === "tc") {
    return journey.destinationTc || journey.destinationEn;
  }
  return journey.destinationEn || journey.destinationTc;
}

function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]/g, "");
}

function textSimilarity(left: string, right: string) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return Math.min(1, Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.25);
  }

  const aPairs = new Map<string, number>();
  for (let index = 0; index < a.length - 1; index += 1) {
    const pair = a.slice(index, index + 2);
    aPairs.set(pair, (aPairs.get(pair) ?? 0) + 1);
  }
  let overlap = 0;
  for (let index = 0; index < b.length - 1; index += 1) {
    const pair = b.slice(index, index + 2);
    const count = aPairs.get(pair) ?? 0;
    if (count > 0) {
      overlap += 1;
      aPairs.set(pair, count - 1);
    }
  }
  return (2 * overlap) / Math.max(1, a.length + b.length - 2);
}

function placeSimilarity(
  left: Pick<RouteVariant, "originEn" | "originTc">,
  right: Pick<RouteVariant, "originEn" | "originTc">,
) {
  return Math.max(
    textSimilarity(left.originEn, right.originEn),
    textSimilarity(left.originTc, right.originTc),
  );
}

function findJointVariant(primary: RouteVariant, routes: RouteVariant[]) {
  return routes
    .filter((route) => route.route === primary.route)
    .map((candidate) => {
      const destination = placeSimilarity(
        { originEn: primary.destinationEn, originTc: primary.destinationTc },
        { originEn: candidate.destinationEn, originTc: candidate.destinationTc },
      );
      const origin = placeSimilarity(primary, candidate);
      return {
        candidate,
        destination,
        origin,
        score: destination * 2 + origin + (candidate.serviceType === 1 ? 0.05 : 0),
      };
    })
    .filter((match) => match.destination >= 0.55 && match.origin >= 0.55)
    .sort((a, b) => b.score - a.score)[0]?.candidate;
}

function suggestAlternativeStop(primary: StopOption, stops: StopOption[]) {
  const ranked = stops
    .map((stop) => ({
      stop,
      score:
        Math.max(
          textSimilarity(primary.nameEn, stop.nameEn),
          textSimilarity(primary.nameTc, stop.nameTc),
        ) - Math.min(0.12, Math.abs(primary.seq - stop.seq) * 0.002),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= 0.48 ? ranked[0].stop : null;
}

export default function SetupPanel({
  favourites,
  language,
  sheetName,
  onAdd,
  onRemove,
  onClose,
}: SetupPanelProps) {
  const [operator, setOperator] = useState<Operator>("KMB");
  const [routes, setRoutes] = useState<RouteVariant[]>([]);
  const [routeQuery, setRouteQuery] = useState("");
  const [selectedRoute, setSelectedRoute] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<RouteVariant | null>(
    null,
  );
  const [stops, setStops] = useState<StopOption[]>([]);
  const [stopQuery, setStopQuery] = useState("");
  const [loadingRoutes, setLoadingRoutes] = useState(true);
  const [loadingStops, setLoadingStops] = useState(false);
  const [checkingJointRoute, setCheckingJointRoute] = useState(false);
  const [jointDraft, setJointDraft] = useState<JointRouteDraft | null>(null);
  const [alternativeStopQuery, setAlternativeStopQuery] = useState("");
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchRouteVariants(operator)
      .then((loadedRoutes) => {
        if (!cancelled) setRoutes(loadedRoutes);
      })
      .catch((caught) => {
        if (!cancelled) setError(readableError(caught));
      })
      .finally(() => {
        if (!cancelled) setLoadingRoutes(false);
      });

    return () => {
      cancelled = true;
    };
  }, [operator, reloadToken]);

  function chooseOperator(nextOperator: Operator) {
    if (nextOperator === operator) return;
    setOperator(nextOperator);
    setLoadingRoutes(true);
    setError("");
    setRoutes([]);
    setSelectedRoute("");
    setSelectedVariant(null);
    setStops([]);
    setRouteQuery("");
    setStopQuery("");
    setJointDraft(null);
    setAlternativeStopQuery("");
  }

  const routeNames = useMemo(
    () => Array.from(new Set(routes.map((route) => route.route))),
    [routes],
  );

  const matchingRouteNames = useMemo(() => {
    const query = routeQuery.trim().toUpperCase();
    const filtered = query
      ? routeNames.filter((route) => route.includes(query))
      : routeNames;
    return filtered.slice(0, query ? 60 : 36);
  }, [routeNames, routeQuery]);

  const variants = useMemo(
    () => routes.filter((route) => route.route === selectedRoute),
    [routes, selectedRoute],
  );

  const matchingStops = useMemo(() => {
    const query = stopQuery.trim().toLocaleLowerCase();
    if (!query) return stops;
    return stops.filter(
      (stop) =>
        stop.nameEn.toLocaleLowerCase().includes(query) ||
        stop.nameTc.includes(stopQuery.trim()) ||
        String(stop.seq) === query,
    );
  }, [stops, stopQuery]);

  const matchingAlternativeStops = useMemo(() => {
    if (!jointDraft) return [];
    const query = alternativeStopQuery.trim().toLocaleLowerCase();
    if (!query) return jointDraft.stops;
    return jointDraft.stops.filter(
      (stop) =>
        stop.nameEn.toLocaleLowerCase().includes(query) ||
        stop.nameTc.includes(alternativeStopQuery.trim()) ||
        String(stop.seq) === query,
    );
  }, [alternativeStopQuery, jointDraft]);

  async function selectVariant(variant: RouteVariant) {
    setSelectedVariant(variant);
    setStops([]);
    setStopQuery("");
    setError("");
    setJointDraft(null);
    setAlternativeStopQuery("");
    setLoadingStops(true);
    try {
      setStops(await fetchStopsForVariant(variant));
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setLoadingStops(false);
    }
  }

  async function addStop(stop: StopOption) {
    if (!selectedVariant) return;
    const duplicate = favourites.some(
      (item) =>
        item.operator === selectedVariant.operator &&
        item.route === selectedVariant.route &&
        item.bound === selectedVariant.bound &&
        item.serviceType === selectedVariant.serviceType &&
        item.stopId === stop.stopId &&
        item.seq === stop.seq,
    );
    if (duplicate) return;

    const primary: FavouriteJourney = {
      ...selectedVariant,
      ...stop,
      id: [
        selectedVariant.operator,
        selectedVariant.route,
        selectedVariant.bound,
        selectedVariant.serviceType,
        stop.stopId,
        stop.seq,
      ].join("-"),
    };

    setCheckingJointRoute(true);
    setError("");
    try {
      const alternativeOperator: Operator =
        selectedVariant.operator === "KMB" ? "CTB" : "KMB";
      const alternativeRoutes = await fetchRouteVariants(alternativeOperator);
      const alternativeVariant = findJointVariant(
        selectedVariant,
        alternativeRoutes,
      );

      if (!alternativeVariant) {
        onAdd(primary);
        onClose();
        return;
      }

      const alternativeStops = await fetchStopsForVariant(alternativeVariant);
      const suggestedStop = suggestAlternativeStop(stop, alternativeStops);
      setAlternativeStopQuery("");
      setJointDraft({
        primary,
        alternativeVariant,
        stops: alternativeStops,
        selectedStopId: suggestedStop?.stopId ?? "",
        suggestedStopId: suggestedStop?.stopId ?? "",
      });
    } catch (caught) {
      setError(
        `Couldn’t check the alternative operator: ${readableError(caught)}. Tap the boarding stop to try again.`,
      );
    } finally {
      setCheckingJointRoute(false);
    }
  }

  function confirmJointRoute() {
    if (!jointDraft) return;
    const alternativeStop = jointDraft.stops.find(
      (stop) => stop.stopId === jointDraft.selectedStopId,
    );
    if (!alternativeStop) return;

    const alternative: JourneyLeg = {
      ...jointDraft.alternativeVariant,
      ...alternativeStop,
    };
    onAdd({
      ...jointDraft.primary,
      alternatives: [alternative],
    });
    onClose();
  }

  return (
    <div className="setup-backdrop" role="presentation">
      <section
        className="setup-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        <header className="setup-header">
          <div>
            <p className="eyebrow">Device setup</p>
            <h2 id="setup-title">Choose a journey</h2>
            <p className="setup-intro">
              Pick the exact direction and boarding stop. This is saved only on
              this device.
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onClose}>
            <span aria-hidden="true">×</span>
            <span className="sr-only">Close setup</span>
          </button>
        </header>

        {favourites.length > 0 && (
          <section className="saved-section" aria-labelledby="saved-title">
            <div className="section-heading-row">
              <h3 id="saved-title">On {sheetName}</h3>
              <span>{favourites.length} saved</span>
            </div>
            <div className="saved-list">
              {favourites.map((journey) => (
                <div className="saved-item" key={journey.id}>
                  <span
                    className={`mini-route-badge ${journey.operator.toLowerCase()}`}
                  >
                    {journey.route}
                  </span>
                  <span className="saved-copy">
                    <strong>{journeyDestination(journey, language)}</strong>
                    <small>
                      {language === "tc"
                        ? journey.nameTc || journey.nameEn
                        : journey.nameEn || journey.nameTc}
                    </small>
                    {journey.alternatives?.length ? (
                      <em className="linked-operators">
                        {[journey.operator, ...journey.alternatives.map((item) => item.operator)].join(" + ")}
                      </em>
                    ) : null}
                  </span>
                  <button
                    className="text-button danger"
                    type="button"
                    onClick={() => onRemove(journey.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="setup-grid">
          <section className="setup-step">
            <div className="step-title">
              <span>1</span>
              <div>
                <h3>Operator and route</h3>
                <p>Search by route number.</p>
              </div>
            </div>

            <div className="segmented operator-toggle" aria-label="Bus operator">
              <button
                className={operator === "KMB" ? "active" : ""}
                type="button"
                onClick={() => chooseOperator("KMB")}
              >
                KMB / LWB
              </button>
              <button
                className={operator === "CTB" ? "active" : ""}
                type="button"
                onClick={() => chooseOperator("CTB")}
              >
                Citybus
              </button>
            </div>

            <label className="field-label" htmlFor="route-search">
              Route number
            </label>
            <input
              id="route-search"
              className="search-input"
              type="search"
              inputMode="text"
              autoComplete="off"
              placeholder={loadingRoutes ? "Loading routes…" : "Try 1, 970, A21…"}
              value={routeQuery}
              disabled={loadingRoutes}
              onChange={(event) => {
                setRouteQuery(event.target.value.toUpperCase());
                setSelectedRoute("");
                setSelectedVariant(null);
                setStops([]);
                setJointDraft(null);
                setAlternativeStopQuery("");
              }}
            />

            {loadingRoutes ? (
              <div className="inline-loading"><span /> Loading route list…</div>
            ) : (
              <div className="route-picker" aria-label="Matching bus routes">
                {matchingRouteNames.map((route) => (
                  <button
                    className={selectedRoute === route ? "selected" : ""}
                    type="button"
                    key={route}
                    onClick={() => {
                      setSelectedRoute(route);
                      setRouteQuery(route);
                      setSelectedVariant(null);
                      setStops([]);
                      setJointDraft(null);
                      setAlternativeStopQuery("");
                    }}
                  >
                    {route}
                  </button>
                ))}
                {matchingRouteNames.length === 0 && (
                  <p className="empty-inline">No route matches “{routeQuery}”.</p>
                )}
              </div>
            )}
          </section>

          <section className={`setup-step ${selectedRoute ? "" : "muted-step"}`}>
            <div className="step-title">
              <span>2</span>
              <div>
                <h3>Direction</h3>
                <p>Choose the destination you travel towards.</p>
              </div>
            </div>

            {selectedRoute ? (
              <div className="direction-list">
                {variants.map((variant) => {
                  const key = `${variant.bound}-${variant.serviceType}-${variant.destinationEn}`;
                  const selected =
                    selectedVariant?.bound === variant.bound &&
                    selectedVariant?.serviceType === variant.serviceType &&
                    selectedVariant?.destinationEn === variant.destinationEn;
                  return (
                    <button
                      className={selected ? "selected" : ""}
                      type="button"
                      key={key}
                      onClick={() => selectVariant(variant)}
                    >
                      <span className="direction-arrow" aria-hidden="true">→</span>
                      <span>
                        <small>TO</small>
                        <strong>{variant.destinationEn}</strong>
                        <em>{variant.destinationTc}</em>
                      </span>
                      {variant.serviceType !== 1 && (
                        <span className="variant-tag">Variant {variant.serviceType}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="step-placeholder">Select a route first.</p>
            )}
          </section>

          <section className={`setup-step stop-step ${selectedVariant ? "" : "muted-step"}`}>
            <div className="step-title">
              <span>3</span>
              <div>
                <h3>Boarding stop</h3>
                <p>Tap the stop where your family boards.</p>
              </div>
            </div>

            {selectedVariant && (
              <>
                <label className="field-label" htmlFor="stop-search">
                  Filter stops
                </label>
                <input
                  id="stop-search"
                  className="search-input"
                  type="search"
                  autoComplete="off"
                  placeholder="English or 中文 stop name"
                  value={stopQuery}
                  disabled={loadingStops}
                  onChange={(event) => setStopQuery(event.target.value)}
                />
              </>
            )}

            {loadingStops ? (
              <div className="inline-loading"><span /> Loading stops…</div>
            ) : selectedVariant ? (
              <div className="stop-list">
                {matchingStops.map((stop) => {
                  const duplicate = favourites.some(
                    (item) =>
                      item.operator === selectedVariant.operator &&
                      item.route === selectedVariant.route &&
                      item.bound === selectedVariant.bound &&
                      item.stopId === stop.stopId &&
                      item.seq === stop.seq,
                  );
                  return (
                    <button
                      type="button"
                      key={`${stop.stopId}-${stop.seq}`}
                      disabled={duplicate || checkingJointRoute}
                      onClick={() => addStop(stop)}
                    >
                      <span className="stop-sequence">{stop.seq}</span>
                      <span>
                        <strong>{stop.nameEn}</strong>
                        <small>{stop.nameTc}</small>
                      </span>
                      <span className="add-mark" aria-hidden="true">
                        {duplicate ? "✓" : "+"}
                      </span>
                    </button>
                  );
                })}
                {matchingStops.length === 0 && (
                  <p className="empty-inline">No matching stops.</p>
                )}
              </div>
            ) : (
              <p className="step-placeholder">Choose a direction first.</p>
            )}
          </section>
        </div>

        {checkingJointRoute && (
          <div className="joint-route-backdrop" role="status" aria-live="polite">
            <div className="joint-route-loading">
              <span aria-hidden="true" />
              <strong>Checking for another operator…</strong>
              <small>Joint routes need one confirmed stop for each company.</small>
            </div>
          </div>
        )}

        {jointDraft && (
          <div className="joint-route-backdrop" role="presentation">
            <section
              className="joint-route-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="joint-route-title"
            >
              <header className="joint-route-header">
                <div>
                  <p className="eyebrow">Jointly operated route</p>
                  <h3 id="joint-route-title">Confirm the {jointDraft.alternativeVariant.operator} stop</h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Return to primary stop selection"
                  onClick={() => setJointDraft(null)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </header>

              <div className="joint-route-body">
                <p className="joint-route-intro">
                  Route {jointDraft.primary.route} also runs under {jointDraft.alternativeVariant.operator}.
                  Stop names and locations can differ between company feeds, so please confirm the suggested stop or choose another one.
                </p>

                <div className="joint-route-summary">
                  <div>
                    <span>{jointDraft.primary.operator}</span>
                    <strong>{jointDraft.primary.nameEn}</strong>
                    <small>{jointDraft.primary.nameTc}</small>
                  </div>
                  <span className="joint-route-link" aria-hidden="true">↔</span>
                  <div>
                    <span>{jointDraft.alternativeVariant.operator}</span>
                    <strong>
                      {jointDraft.stops.find((stop) => stop.stopId === jointDraft.selectedStopId)?.nameEn ??
                        "Choose a stop below"}
                    </strong>
                    <small>
                      {jointDraft.stops.find((stop) => stop.stopId === jointDraft.selectedStopId)?.nameTc ??
                        "請選擇車站"}
                    </small>
                  </div>
                </div>

                <label className="field-label" htmlFor="alternative-stop-search">
                  Search {jointDraft.alternativeVariant.operator} stops
                </label>
                <input
                  id="alternative-stop-search"
                  className="search-input"
                  type="search"
                  autoComplete="off"
                  placeholder="English or 中文 stop name"
                  value={alternativeStopQuery}
                  onChange={(event) => setAlternativeStopQuery(event.target.value)}
                />

                <div className="alternative-stop-list" role="radiogroup" aria-label="Alternative operator stops">
                  {matchingAlternativeStops.map((stop) => {
                    const selected = stop.stopId === jointDraft.selectedStopId;
                    const suggested = stop.stopId === jointDraft.suggestedStopId;
                    return (
                      <button
                        className={selected ? "selected" : ""}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        key={`${stop.stopId}-${stop.seq}`}
                        onClick={() =>
                          setJointDraft((current) =>
                            current ? { ...current, selectedStopId: stop.stopId } : current,
                          )
                        }
                      >
                        <span className="stop-sequence">{stop.seq}</span>
                        <span>
                          <strong>{stop.nameEn}</strong>
                          <small>{stop.nameTc}</small>
                        </span>
                        <span className="alternative-stop-state">
                          {suggested ? "Suggested" : selected ? "Selected" : ""}
                        </span>
                      </button>
                    );
                  })}
                  {matchingAlternativeStops.length === 0 && (
                    <p className="empty-inline">No matching stops.</p>
                  )}
                </div>
              </div>

              <footer className="joint-route-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setJointDraft(null)}
                >
                  Back
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={!jointDraft.selectedStopId}
                  onClick={confirmJointRoute}
                >
                  Confirm and add both
                </button>
              </footer>
            </section>
          </div>
        )}

        {error && (
          <div className="setup-error" role="alert">
            <div>
              <strong>Couldn’t load the official bus data</strong>
              <span>{error}</span>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                if (selectedVariant) selectVariant(selectedVariant);
                else {
                  setLoadingRoutes(true);
                  setError("");
                  setReloadToken((value) => value + 1);
                }
              }}
            >
              Try again
            </button>
          </div>
        )}

        <footer className="setup-footer">
          <span>Routes are saved in {sheetName} on this device.</span>
          <button className="secondary-button" type="button" onClick={onClose}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
