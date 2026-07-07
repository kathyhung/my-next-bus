"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchRouteVariants, fetchStopsForVariant } from "./bus-api";
import type {
  FavouriteJourney,
  Language,
  Operator,
  RouteVariant,
  StopOption,
} from "./types";

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

  async function selectVariant(variant: RouteVariant) {
    setSelectedVariant(variant);
    setStops([]);
    setStopQuery("");
    setError("");
    setLoadingStops(true);
    try {
      setStops(await fetchStopsForVariant(variant));
    } catch (caught) {
      setError(readableError(caught));
    } finally {
      setLoadingStops(false);
    }
  }

  function addStop(stop: StopOption) {
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

    onAdd({
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
                      disabled={duplicate}
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
