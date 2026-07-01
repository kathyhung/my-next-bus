"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchJourneyEtas } from "./bus-api";
import SetupPanel from "./SetupPanel";
import type {
  FavouriteJourney,
  JourneyEtaState,
  Language,
} from "./types";

const FAVOURITES_KEY = "hk-bus-board:favourites:v1";
const ETA_CACHE_KEY = "hk-bus-board:eta-cache:v1";
const LANGUAGE_KEY = "hk-bus-board:language:v1";
const WAKE_KEY = "hk-bus-board:keep-awake:v1";
const STALE_AFTER_MS = 7 * 60_000;
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

interface WakeLockHandle {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request(type: "screen"): Promise<WakeLockHandle>;
  };
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type EtaMap = Record<string, JourneyEtaState>;

function parseStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function formatClock(timestamp: number, language: Language) {
  if (timestamp <= 0) return "--:--";
  return new Intl.DateTimeFormat(language === "tc" ? "zh-HK" : "en-GB", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatUpdated(timestamp: number, language: Language) {
  if (timestamp <= 0) return "--:--:--";
  return new Intl.DateTimeFormat(language === "tc" ? "zh-HK" : "en-GB", {
    timeZone: "Asia/Hong_Kong",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function destination(journey: FavouriteJourney, language: Language) {
  return language === "tc"
    ? journey.destinationTc || journey.destinationEn
    : journey.destinationEn || journey.destinationTc;
}

function stopName(journey: FavouriteJourney, language: Language) {
  return language === "tc"
    ? journey.nameTc || journey.nameEn
    : journey.nameEn || journey.nameTc;
}

function etaLabel(timestamp: number, now: number, language: Language) {
  const minutes = Math.ceil((timestamp - now) / 60_000);
  if (minutes < -1) return null;
  if (minutes <= 1) return language === "tc" ? "即將抵達" : "Arriving";
  return language === "tc" ? `${minutes} 分鐘` : `${minutes} min`;
}

export default function BusBoard() {
  const [hydrated, setHydrated] = useState(false);
  const [favourites, setFavourites] = useState<FavouriteJourney[]>([]);
  const [etaByJourney, setEtaByJourney] = useState<EtaMap>({});
  const [language, setLanguage] = useState<Language>("en");
  const [setupOpen, setSetupOpen] = useState(false);
  const [now, setNow] = useState(0);
  const [online, setOnline] = useState(true);
  const [wakeWanted, setWakeWanted] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<InstallPromptEvent | null>(null);
  const [notice, setNotice] = useState("");
  const wakeLockRef = useRef<WakeLockHandle | null>(null);

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      const savedFavourites = parseStored<FavouriteJourney[]>(FAVOURITES_KEY, []);
      const savedEtas = parseStored<EtaMap>(ETA_CACHE_KEY, {});
      const savedLanguage = window.localStorage.getItem(LANGUAGE_KEY);
      const savedWake = window.localStorage.getItem(WAKE_KEY) === "true";

      setFavourites(savedFavourites);
      setEtaByJourney(
        Object.fromEntries(
          Object.entries(savedEtas).map(([id, value]) => [
            id,
            { ...value, loading: false },
          ]),
        ),
      );
      if (savedLanguage === "tc" || savedLanguage === "en") {
        setLanguage(savedLanguage);
      }
      setWakeWanted(savedWake);
      setOnline(navigator.onLine);
      setSetupOpen(savedFavourites.length === 0);
      setNow(Date.now());
      setHydrated(true);
    }, 0);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` })
        .catch(() => undefined);
    }

    return () => window.clearTimeout(hydrationTimer);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(FAVOURITES_KEY, JSON.stringify(favourites));
  }, [favourites, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(ETA_CACHE_KEY, JSON.stringify(etaByJourney));
  }, [etaByJourney, hydrated]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const becameOnline = () => setOnline(true);
    const becameOffline = () => setOnline(false);
    window.addEventListener("online", becameOnline);
    window.addEventListener("offline", becameOffline);
    return () => {
      window.removeEventListener("online", becameOnline);
      window.removeEventListener("offline", becameOffline);
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const refreshAll = useCallback(async () => {
    if (favourites.length === 0) return;

    setEtaByJourney((current) => {
      const next = { ...current };
      for (const journey of favourites) {
        next[journey.id] = {
          records: current[journey.id]?.records ?? [],
          fetchedAt: current[journey.id]?.fetchedAt ?? 0,
          generatedAt: current[journey.id]?.generatedAt,
          loading: true,
          error: undefined,
        };
      }
      return next;
    });

    const outcomes = await Promise.all(
      favourites.map(async (journey) => {
        try {
          const result = await fetchJourneyEtas(journey);
          return { id: journey.id, ok: true as const, result };
        } catch (error) {
          return {
            id: journey.id,
            ok: false as const,
            error:
              error instanceof Error
                ? error.message
                : "The official feed is unavailable",
          };
        }
      }),
    );

    const fetchedAt = Date.now();
    setNow(fetchedAt);
    setEtaByJourney((current) => {
      const next = { ...current };
      for (const outcome of outcomes) {
        if (outcome.ok) {
          next[outcome.id] = {
            records: outcome.result.records,
            generatedAt: outcome.result.generatedAt,
            fetchedAt,
            loading: false,
          };
        } else {
          next[outcome.id] = {
            records: current[outcome.id]?.records ?? [],
            generatedAt: current[outcome.id]?.generatedAt,
            fetchedAt: current[outcome.id]?.fetchedAt ?? 0,
            loading: false,
            error: outcome.error,
          };
        }
      }
      return next;
    });
  }, [favourites]);

  useEffect(() => {
    if (!hydrated || favourites.length === 0) return;
    const firstRefresh = window.setTimeout(refreshAll, 0);
    const timer = window.setInterval(refreshAll, 60_000);
    return () => {
      window.clearTimeout(firstRefresh);
      window.clearInterval(timer);
    };
  }, [favourites.length, hydrated, refreshAll]);

  const requestWakeLock = useCallback(async () => {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock || document.visibilityState !== "visible") return false;
    try {
      const sentinel = await wakeLock.request("screen");
      wakeLockRef.current = sentinel;
      setWakeActive(true);
      sentinel.addEventListener("release", () => {
        wakeLockRef.current = null;
        setWakeActive(false);
      });
      return true;
    } catch {
      setWakeActive(false);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!hydrated || !wakeWanted || wakeLockRef.current) return;
    requestWakeLock();
  }, [hydrated, requestWakeLock, wakeWanted]);

  useEffect(() => {
    const resume = () => {
      if (
        document.visibilityState === "visible" &&
        wakeWanted &&
        !wakeLockRef.current
      ) {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", resume);
    return () => document.removeEventListener("visibilitychange", resume);
  }, [requestWakeLock, wakeWanted]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const lastUpdated = useMemo(
    () =>
      Math.max(
        0,
        ...favourites.map((journey) => etaByJourney[journey.id]?.fetchedAt ?? 0),
      ),
    [etaByJourney, favourites],
  );

  const refreshing = favourites.some(
    (journey) => etaByJourney[journey.id]?.loading,
  );
  const anyError = favourites.some(
    (journey) => etaByJourney[journey.id]?.error,
  );
  const stale = lastUpdated > 0 && now - lastUpdated > STALE_AFTER_MS;

  async function toggleWakeLock() {
    if (wakeWanted) {
      setWakeWanted(false);
      window.localStorage.setItem(WAKE_KEY, "false");
      await wakeLockRef.current?.release();
      wakeLockRef.current = null;
      setWakeActive(false);
      return;
    }

    setWakeWanted(true);
    window.localStorage.setItem(WAKE_KEY, "true");
    const granted = await requestWakeLock();
    if (!granted) {
      setNotice(
        "Wake lock was blocked. Keep this app visible and disable battery saver, or set Android screen timeout manually.",
      );
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setNotice("Fullscreen is unavailable in this browser. Install the web app for the cleanest display.");
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  function addFavourite(journey: FavouriteJourney) {
    setFavourites((current) => [...current, journey]);
  }

  function removeFavourite(id: string) {
    setFavourites((current) => current.filter((item) => item.id !== id));
    setEtaByJourney((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function changeLanguage(nextLanguage: Language) {
    setLanguage(nextLanguage);
    window.localStorage.setItem(LANGUAGE_KEY, nextLanguage);
  }

  const statusKind = !online
    ? "offline"
    : stale
      ? "stale"
      : anyError
        ? "warning"
        : "live";
  const statusText = !online
    ? language === "tc"
      ? "離線"
      : "Offline"
    : refreshing
      ? language === "tc"
        ? "更新中"
        : "Updating"
      : stale
        ? language === "tc"
          ? "資料過時"
          : "Data stale"
        : anyError
          ? language === "tc"
            ? "部分資料中斷"
            : "Some feeds unavailable"
          : language === "tc"
            ? "即時"
            : "Live";

  return (
    <main className="board-shell">
      <header className="board-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <p className="eyebrow">Hong Kong</p>
            <h1>{language === "tc" ? "巴士到站時間" : "Next buses"}</h1>
          </div>
        </div>

        <div className="header-clock" aria-label="Hong Kong time">
          <strong>{formatClock(now, language)}</strong>
          <span>HKT</span>
        </div>

        <div className="board-actions">
          <div className="segmented language-toggle" aria-label="Display language">
            <button
              className={language === "en" ? "active" : ""}
              type="button"
              onClick={() => changeLanguage("en")}
            >
              EN
            </button>
            <button
              className={language === "tc" ? "active" : ""}
              type="button"
              onClick={() => changeLanguage("tc")}
            >
              中文
            </button>
          </div>
          {installPrompt && (
            <button
              className="action-button install"
              type="button"
              aria-label="Install app"
              title="Install app"
              onClick={installApp}
            >
              <span className="action-symbol" aria-hidden="true">↓</span>
              <span className="action-label">Install</span>
            </button>
          )}
          <button
            className={`action-button ${wakeActive ? "active" : ""}`}
            type="button"
            aria-pressed={wakeWanted}
            aria-label={wakeActive ? "Keep-awake mode is on" : "Turn on keep-awake mode"}
            title={wakeActive ? "Keep-awake mode is on" : "Turn on keep-awake mode"}
            onClick={toggleWakeLock}
          >
            <span className="action-symbol" aria-hidden="true">☀</span>
            <span className="action-label">{wakeActive ? "Awake" : "Keep awake"}</span>
          </button>
          <button
            className="icon-button header-icon"
            type="button"
            title="Refresh arrival times"
            onClick={refreshAll}
          >
            <span className={refreshing ? "spin" : ""} aria-hidden="true">↻</span>
            <span className="sr-only">Refresh arrival times</span>
          </button>
          <button
            className="icon-button header-icon"
            type="button"
            title="Toggle fullscreen"
            onClick={toggleFullscreen}
          >
            <span aria-hidden="true">⛶</span>
            <span className="sr-only">Toggle fullscreen</span>
          </button>
          <button
            className="primary-button"
            type="button"
            aria-label={language === "tc" ? "管理路線" : "Manage routes"}
            title={language === "tc" ? "管理路線" : "Manage routes"}
            onClick={() => setSetupOpen(true)}
          >
            <span className="action-symbol" aria-hidden="true">＋</span>
            <span className="action-label">{language === "tc" ? "路線" : "Route"}</span>
          </button>
        </div>
      </header>

      <section className="status-strip" aria-live="polite">
        <div className={`live-status ${statusKind}`}>
          <span className="status-dot" />
          <strong>{statusText}</strong>
        </div>
        <span className="updated-copy">
          {lastUpdated
            ? `${language === "tc" ? "上次更新" : "Updated"} ${formatUpdated(lastUpdated, language)}`
            : language === "tc"
              ? "等待首次更新"
              : "Waiting for first update"}
        </span>
        <span className="refresh-note">
          {language === "tc" ? "每 60 秒自動更新" : "Auto-refreshes every 60 seconds"}
        </span>
      </section>

      <section className="arrival-board" aria-label="Saved bus arrivals">
        {hydrated && favourites.length === 0 ? (
          <div className="empty-board">
            <div className="empty-route-sign" aria-hidden="true">＋</div>
            <p className="eyebrow">First-time setup</p>
            <h2>{language === "tc" ? "加入你常搭的巴士" : "Add your family’s usual buses"}</h2>
            <p>
              {language === "tc"
                ? "選擇營辦商、方向和實際上車站。設定只會儲存在這部裝置。"
                : "Choose the operator, direction and exact boarding stop. Your choices stay on this device."}
            </p>
            <button className="primary-button large" type="button" onClick={() => setSetupOpen(true)}>
              {language === "tc" ? "加入第一條路線" : "Add first route"}
            </button>
          </div>
        ) : (
          <div className="journey-list">
            {favourites.map((journey) => {
              const state = etaByJourney[journey.id];
              const visibleRecords = (state?.records ?? []).filter(
                (record) => record.timestamp >= now - 60_000,
              );
              const rowStale =
                Boolean(state?.fetchedAt) && now - state.fetchedAt > STALE_AFTER_MS;
              return (
                <article className="journey-row" key={journey.id}>
                  <div className={`route-badge ${journey.operator.toLowerCase()}`}>
                    <span>{journey.operator === "KMB" ? "KMB" : "CTB"}</span>
                    <strong
                      className={journey.route.length > 3 ? "long-route-number" : undefined}
                    >
                      {journey.route}
                    </strong>
                  </div>

                  <div className="journey-copy">
                    <p className="destination-prefix">
                      {language === "tc" ? "往" : "TO"}
                    </p>
                    <h2>{destination(journey, language)}</h2>
                    <p className="stop-name">
                      <span aria-hidden="true">●</span> {stopName(journey, language)}
                    </p>
                  </div>

                  <div className="etas" aria-label={`Arrivals for route ${journey.route}`}>
                    {state?.loading && visibleRecords.length === 0 ? (
                      <>
                        <div className="eta-skeleton" />
                        <div className="eta-skeleton small" />
                      </>
                    ) : visibleRecords.length > 0 ? (
                      visibleRecords.map((record, index) => {
                        const label = etaLabel(record.timestamp, now, language);
                        if (!label) return null;
                        const remarks = `${record.remarkEn} ${record.remarkTc}`
                          .trim()
                          .toLocaleLowerCase();
                        const scheduled =
                          remarks.includes("scheduled") || remarks.includes("預定");
                        return (
                          <div className={`eta ${index === 0 ? "next" : ""}`} key={`${record.timestamp}-${index}`}>
                            <strong>{label}</strong>
                            <span className="eta-time">
                              {formatClock(record.timestamp, language)}
                              {scheduled && (
                                <em>({language === "tc" ? "預定班次" : "SCHEDULED"})</em>
                              )}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="no-arrivals">
                        <strong>{language === "tc" ? "未有班次" : "No upcoming buses"}</strong>
                        <span>{language === "tc" ? "稍後再試" : "Check again shortly"}</span>
                      </div>
                    )}
                  </div>

                  {(state?.error || rowStale) && (
                    <div className="row-warning" title={state?.error}>
                      <span aria-hidden="true">!</span>
                      {rowStale
                        ? language === "tc"
                          ? "舊資料"
                          : "stale"
                        : language === "tc"
                          ? "連線問題"
                          : "feed issue"}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <footer className="board-footer">
        <span>ETA is advisory and may change with traffic.</span>
        <span>
          Data: KMB/LWB, Citybus &amp; DATA.GOV.HK
        </span>
        <button className="text-button" type="button" onClick={() => setSetupOpen(true)}>
          Manage routes
        </button>
      </footer>

      {notice && <div className="toast" role="status">{notice}</div>}

      {setupOpen && (
        <SetupPanel
          favourites={favourites}
          language={language}
          onAdd={addFavourite}
          onRemove={removeFavourite}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </main>
  );
}
