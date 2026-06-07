import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useEffect, useRef, useState } from "react";

export type AppUpdateStatus =
  | "unavailable"
  | "not-checked"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "error";

type UpdateProgress = {
  downloaded: number;
  total: number | null;
};

export function useAutoUpdater() {
  const hasCheckedRef = useRef(false);
  const [status, setStatus] = useState<AppUpdateStatus>(() =>
    canUseTauriRuntime() ? "not-checked" : "unavailable",
  );
  const [updateAvailable, setUpdateAvailable] = useState<Update | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useEffect(() => {
    if (
      hasCheckedRef.current ||
      typeof window === "undefined" ||
      !canUseTauriRuntime()
    ) {
      return;
    }
    hasCheckedRef.current = true;

    const timer = window.setTimeout(() => {
      void checkForUpdates();
    }, 3000);

    return () => window.clearTimeout(timer);
  }, []);

  async function checkForUpdates() {
    if (!canUseTauriRuntime()) {
      setStatus("unavailable");
      return;
    }

    try {
      setStatus("checking");
      setErrorMessage(undefined);
      const update = await check();

      if (!update) {
        setUpdateAvailable(null);
        setStatus("current");
        return;
      }

      setUpdateAvailable(update);
      setStatus("available");
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
      console.error("Failed to check for updates:", error);
    }
  }

  async function downloadAndInstall(update = updateAvailable) {
    if (!update) return;

    try {
      setStatus("downloading");
      setErrorMessage(undefined);
      setProgress({ downloaded: 0, total: null });

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setProgress({
              downloaded: 0,
              total: event.data.contentLength ?? null,
            });
            break;
          case "Progress":
            setProgress((currentProgress) => ({
              downloaded:
                (currentProgress?.downloaded ?? 0) + event.data.chunkLength,
              total: currentProgress?.total ?? null,
            }));
            break;
          case "Finished":
            break;
        }
      });

      await relaunch();
    } catch (error) {
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : String(error));
      console.error("Failed to download and install update:", error);
    } finally {
      setProgress(null);
    }
  }

  return {
    status,
    isChecking: status === "checking",
    isDownloading: status === "downloading",
    updateAvailable,
    progress,
    errorMessage,
    checkForUpdates,
    downloadAndInstall,
  };
}

function canUseTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}
