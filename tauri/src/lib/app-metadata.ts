import { getName, getTauriVersion, getVersion } from "@tauri-apps/api/app";
import {
  arch,
  platform,
  version as osVersion,
} from "@tauri-apps/plugin-os";
import packageJson from "../../package.json";

export type AppMetadata = {
  appName: string;
  appVersion: string;
  tauriVersion: string;
  osPlatform: string;
  osVersion: string;
  osArch: string;
  runtime: "desktop" | "browser-preview";
};

export function createFallbackAppMetadata(): AppMetadata {
  return {
    appName: "PII GUI",
    appVersion: packageJson.version,
    tauriVersion: "unavailable",
    osPlatform: "browser-preview",
    osVersion: "unknown",
    osArch: "unknown",
    runtime: "browser-preview",
  };
}

export async function loadAppMetadata(): Promise<AppMetadata> {
  if (!canUseTauriRuntime()) {
    return createFallbackAppMetadata();
  }

  const [appName, appVersion, tauriVersion] = await Promise.all([
    getName(),
    getVersion(),
    getTauriVersion(),
  ]);

  return {
    appName,
    appVersion,
    tauriVersion,
    osPlatform: platform(),
    osVersion: osVersion(),
    osArch: arch(),
    runtime: "desktop",
  };
}

function canUseTauriRuntime() {
  return Boolean(window.__TAURI_INTERNALS__);
}
