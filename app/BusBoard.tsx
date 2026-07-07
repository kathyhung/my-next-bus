"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { fetchJourneyEtas } from "./bus-api";
import SetupPanel from "./SetupPanel";
import type {
  FavouriteJourney,
  JourneyEtaState,
  Language,
  RouteSheet,
} from "./types";

const LEGACY_FAVOURITES_KEY = "my-next-bus:favourites:v1";
const SHEETS_KEY = "my-next-bus:sheets:v1";
const ACTIVE_SHEET_KEY = "my-next-bus:active-sheet:v1";
const ETA_CACHE_KEY = "my-next-bus:eta-cache:v1";
const LANGUAGE_KEY = "my-next-bus:language:v1";
const WAKE_KEY = "my-next-bus:keep-awake:v1";
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

interface NavigatorWithStandalone extends Navigator {
  standalone?: boolean;
}

type InstallPlatform = "ios" | "android" | "other";
type EtaMap = Record<string, JourneyEtaState>;
const EMPTY_JOURNEYS: FavouriteJourney[] = [];

function normalizeSheets(value: RouteSheet[]) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (sheet) =>
        sheet &&
        typeof sheet.id === "string" &&
        typeof sheet.name === "string" &&
        Array.isArray(sheet.journeys),
    )
    .map((sheet) => ({
      ...sheet,
      name: sheet.name.trim().toUpperCase().slice(0, 6) || "SHEET",
    }));
}

function createSheetId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function detectInstallPlatform(): InstallPlatform {
  const userAgent = navigator.userAgent;
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/i.test(userAgent) || iPadOs) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

function isInstalledApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as NavigatorWithStandalone).standalone)
  );
}

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
  const [sheets, setSheets] = useState<RouteSheet[]>([]);
  const [activeSheetId, setActiveSheetId] = useState("");
  const [sheetCreatorOpen, setSheetCreatorOpen] = useState(false);
  const [newSheetName, setNewSheetName] = useState("");
  const [sheetNameError, setSheetNameError] = useState("");
  const [etaByJourney, setEtaByJourney] = useState<EtaMap>({});
  const [language, setLanguage] = useState<Language>("en");
  const [setupOpen, setSetupOpen] = useState(false);
  const [now, setNow] = useState(0);
  const [online, setOnline] = useState(true);
  const [wakeWanted, setWakeWanted] = useState(false);
  const [wakeActive, setWakeActive] = useState(false);
  const [installPrompt, setInstallPrompt] =
    useState<InstallPromptEvent | null>(null);
  const [installHelp, setInstallHelp] = useState<InstallPlatform | null>(null);
  const [appInstalled, setAppInstalled] = useState(false);
  const [notice, setNotice] = useState("");
  const wakeLockRef = useRef<WakeLockHandle | null>(null);

  const activeSheet = useMemo(
    () => sheets.find((sheet) => sheet.id === activeSheetId) ?? sheets[0],
    [activeSheetId, sheets],
  );
  const favourites = activeSheet?.journeys ?? EMPTY_JOURNEYS;

  useEffect(() => {
    const hydrationTimer = window.setTimeout(() => {
      const storedSheets = normalizeSheets(parseStored<RouteSheet[]>(SHEETS_KEY, []));
      const savedFavourites = parseStored<FavouriteJourney[]>(
        LEGACY_FAVOURITES_KEY,
        [],
      );
      const initialSheets =
        storedSheets.length > 0
          ? storedSheets
          : [{ id: "grp1", name: "GRP1", journeys: savedFavourites }];
      const storedActiveSheetId = window.localStorage.getItem(ACTIVE_SHEET_KEY);
      const initialActiveSheet =
        initialSheets.find((sheet) => sheet.id === storedActiveSheetId) ??
        initialSheets[0];
      const savedEtas = parseStored<EtaMap>(ETA_CACHE_KEY, {});
      const savedLanguage = window.localStorage.getItem(LANGUAGE_KEY);
      const savedWake = window.localStorage.getItem(WAKE_KEY) === "true";

      setSheets(initialSheets);
      setActiveSheetId(initialActiveSheet.id);
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
      setSetupOpen(initialActiveSheet.journeys.length === 0);
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
    window.localStorage.setItem(SHEETS_KEY, JSON.stringify(sheets));
    window.localStorage.removeItem(LEGACY_FAVOURITES_KEY);
  }, [hydrated, sheets]);

  useEffect(() => {
    if (!hydrated || !activeSheetId) return;
    window.localStorage.setItem(ACTIVE_SHEET_KEY, activeSheetId);
  }, [activeSheetId, hydrated]);

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
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const updateInstalledState = () => setAppInstalled(isInstalledApp());
    const installed = () => {
      setInstallPrompt(null);
      setInstallHelp(null);
      setAppInstalled(true);
      setNotice("My Next Bus is installed.");
    };

    updateInstalledState();
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);
    displayMode.addEventListener("change", updateInstalledState);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
      displayMode.removeEventListener("change", updateInstalledState);
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
    if (appInstalled) {
      setNotice("My Next Bus is already installed on this device.");
      return;
    }

    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "dismissed") {
        setNotice("Installation was cancelled. Tap Install whenever you are ready.");
      }
      return;
    }

    setInstallHelp(detectInstallPlatform());
  }

  function addFavourite(journey: FavouriteJourney) {
    setSheets((current) =>
      current.map((sheet) =>
        sheet.id === activeSheetId
          ? { ...sheet, journeys: [...sheet.journeys, journey] }
          : sheet,
      ),
    );
  }

  function removeFavourite(id: string) {
    const usedOnAnotherSheet = sheets.some(
      (sheet) =>
        sheet.id !== activeSheetId &&
        sheet.journeys.some((journey) => journey.id === id),
    );
    setSheets((current) =>
      current.map((sheet) =>
        sheet.id === activeSheetId
          ? {
              ...sheet,
              journeys: sheet.journeys.filter((journey) => journey.id !== id),
            }
          : sheet,
      ),
    );
    if (!usedOnAnotherSheet) {
      setEtaByJourney((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
  }

  function switchSheet(sheetId: string) {
    setActiveSheetId(sheetId);
    setSetupOpen(false);
  }

  function openSheetCreator() {
    setNewSheetName("");
    setSheetNameError("");
    setSheetCreatorOpen(true);
  }

  function createSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newSheetName.trim().toUpperCase();

    if (!name) {
      setSheetNameError("Enter a sheet name.");
      return;
    }
    if (name.length > 6) {
      setSheetNameError("Use no more than 6 characters.");
      return;
    }
    if (sheets.some((sheet) => sheet.name.toUpperCase() === name)) {
      setSheetNameError("That sheet name already exists.");
      return;
    }

    const sheet: RouteSheet = { id: createSheetId(), name, journeys: [] };
    setSheets((current) => [...current, sheet]);
    setActiveSheetId(sheet.id);
    setSheetCreatorOpen(false);
    setSetupOpen(false);
    setNotice(`${name} sheet created.`);
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
            <h1>{language === "tc" ? "我的下一班巴士" : "My Next Bus"}</h1>
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
          <button
            className={`action-button install ${appInstalled ? "active" : ""}`}
            type="button"
            aria-label={appInstalled ? "My Next Bus is installed" : "Install My Next Bus"}
            title={appInstalled ? "My Next Bus is installed" : "Install My Next Bus"}
            aria-pressed={appInstalled}
            onClick={installApp}
          >
            <span className="action-symbol" aria-hidden="true">
              {appInstalled ? "✓" : "↓"}
            </span>
            <span className="action-label">{appInstalled ? "Installed" : "Install"}</span>
          </button>
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

      <section
        className="arrival-board"
        id="arrival-board"
        role="tabpanel"
        aria-label={`${activeSheet?.name ?? "GRP1"} bus arrivals`}
      >
        {hydrated && favourites.length === 0 ? (
          <div className="empty-board">
            <div className="empty-route-sign" aria-hidden="true">＋</div>
            <p className="eyebrow">{activeSheet?.name ?? "GRP1"} sheet</p>
            <h2>
              {language === "tc"
                ? `加入巴士到 ${activeSheet?.name ?? "GRP1"}`
                : `Add buses to ${activeSheet?.name ?? "GRP1"}`}
            </h2>
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

      <nav className="sheet-bar" aria-label="Bus route sheets">
        <div className="sheet-tabs" role="tablist" aria-label="Bus route sheets">
          {sheets.map((sheet) => (
            <button
              className={`sheet-tab ${sheet.id === activeSheet?.id ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={sheet.id === activeSheet?.id}
              aria-controls="arrival-board"
              key={sheet.id}
              onClick={() => switchSheet(sheet.id)}
            >
              {sheet.name}
            </button>
          ))}
        </div>
        <button
          className="sheet-add"
          type="button"
          aria-label="Add a new sheet"
          title="Add a new sheet"
          onClick={openSheetCreator}
        >
          <span aria-hidden="true">＋</span>
        </button>
      </nav>

      {notice && <div className="toast" role="status">{notice}</div>}

      {sheetCreatorOpen && (
        <div
          className="sheet-dialog-backdrop"
          role="presentation"
          onClick={() => setSheetCreatorOpen(false)}
        >
          <section
            className="sheet-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <form onSubmit={createSheet}>
              <header className="sheet-dialog-header">
                <div>
                  <p className="eyebrow">New route group</p>
                  <h2 id="sheet-dialog-title">Add a sheet</h2>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Close new sheet dialog"
                  onClick={() => setSheetCreatorOpen(false)}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </header>

              <div className="sheet-dialog-body">
                <label className="field-label" htmlFor="sheet-name">
                  Short name
                </label>
                <input
                  id="sheet-name"
                  className="search-input sheet-name-input"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoFocus
                  maxLength={6}
                  placeholder="HOME"
                  value={newSheetName}
                  onChange={(event) => {
                    setNewSheetName(event.target.value.toUpperCase().slice(0, 6));
                    setSheetNameError("");
                  }}
                />
                <div className="sheet-name-meta">
                  <span>Use 1–6 characters, for example OFFICE.</span>
                  <span>{newSheetName.length}/6</span>
                </div>
                {sheetNameError && (
                  <p className="sheet-name-error" role="alert">
                    {sheetNameError}
                  </p>
                )}
              </div>

              <footer className="sheet-dialog-actions">
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setSheetCreatorOpen(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" type="submit">
                  Create sheet
                </button>
              </footer>
            </form>
          </section>
        </div>
      )}

      {installHelp && (
        <div
          className="install-backdrop"
          role="presentation"
          onClick={() => setInstallHelp(null)}
        >
          <section
            className="install-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="install-sheet-header">
              <div>
                <p className="eyebrow">Add to your phone</p>
                <h2 id="install-title">
                  {installHelp === "ios"
                    ? "Install on iPhone"
                    : installHelp === "android"
                      ? "Install on Android"
                      : "Install My Next Bus"}
                </h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close install instructions"
                onClick={() => setInstallHelp(null)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>

            <p className="install-sheet-copy">
              {installHelp === "ios"
                ? "iPhone installs web apps from the browser Share menu."
                : installHelp === "android"
                  ? "If Chrome's automatic prompt is unavailable, install from its menu."
                  : "Use your browser menu to add this app to your home screen."}
            </p>

            <ol className="install-steps">
              {installHelp === "ios" ? (
                <>
                  <li>
                    <span>1</span>
                    <div><strong>Open this page in Safari</strong><small>Use Safari rather than an in-app browser.</small></div>
                  </li>
                  <li>
                    <span>2</span>
                    <div><strong>Tap the Share button</strong><small>It looks like a square with an upward arrow.</small></div>
                  </li>
                  <li>
                    <span>3</span>
                    <div><strong>Choose Add to Home Screen</strong><small>Scroll down if the option is not immediately visible.</small></div>
                  </li>
                  <li>
                    <span>4</span>
                    <div><strong>Tap Add</strong><small>My Next Bus will appear on your home screen.</small></div>
                  </li>
                </>
              ) : installHelp === "android" ? (
                <>
                  <li>
                    <span>1</span>
                    <div><strong>Open this page in Chrome</strong><small>Avoid opening it inside a messaging or social app.</small></div>
                  </li>
                  <li>
                    <span>2</span>
                    <div><strong>Tap Chrome’s ⋮ menu</strong><small>The menu is usually at the top-right.</small></div>
                  </li>
                  <li>
                    <span>3</span>
                    <div><strong>Choose Install app</strong><small>It may instead say Add to Home screen.</small></div>
                  </li>
                  <li>
                    <span>4</span>
                    <div><strong>Confirm Install</strong><small>Launch My Next Bus from its new icon.</small></div>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <span>1</span>
                    <div><strong>Open your browser menu</strong><small>Look for an install or app option.</small></div>
                  </li>
                  <li>
                    <span>2</span>
                    <div><strong>Choose Install app</strong><small>The wording may be Add to Home screen.</small></div>
                  </li>
                </>
              )}
            </ol>

            <footer className="install-sheet-footer">
              <button
                className="primary-button"
                type="button"
                onClick={() => setInstallHelp(null)}
              >
                Got it
              </button>
            </footer>
          </section>
        </div>
      )}

      {setupOpen && (
        <SetupPanel
          favourites={favourites}
          language={language}
          sheetName={activeSheet?.name ?? "GRP1"}
          onAdd={addFavourite}
          onRemove={removeFavourite}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </main>
  );
}
