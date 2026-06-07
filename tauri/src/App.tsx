import "./App.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FolderTree,
  GripVertical,
  List,
  Pencil,
  ListChecks,
  LoaderCircle,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type UIEvent,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PdfPreview } from "@/components/pdf-preview";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTauriFileDrop } from "@/hooks/use-tauri-file-drop";
import {
  useAutoUpdater,
  type AppUpdateStatus,
} from "@/hooks/use-auto-updater";
import {
  matchAppShortcut,
  shortcutLabel,
  tabShortcutLabel,
} from "@/lib/app-shortcuts";
import {
  createFallbackAppMetadata,
  loadAppMetadata,
  type AppMetadata,
} from "@/lib/app-metadata";
import {
  initAppPersistence,
  persistCustomRules,
  persistPiiTaskResult,
  persistTabs,
  writePiiFilterResultFile,
  type PiiFilterResultPayload,
} from "@/lib/app-persistence";
import { cn } from "@/lib/utils";
import {
  activeTaskCount,
  completePiiTask,
  createPiiTask,
  failPiiTask,
  paginateTaskHistory,
  type PiiBackend,
  type PiiTaskRecord,
  startNextQueuedTask,
} from "@/lib/pii-task-queue";
import {
  applyCustomRules,
  createMatchSelection,
  createInputTextSegments,
  createRedactedTextSegments,
  createRestoredTextSegments,
  formatRedactedText,
  mergePiiMatches,
  replacementLabel,
  restorePiiText,
  selectedPiiMatches,
  type PiiCustomRule,
  type PiiIndexFormat,
  type PiiMatch,
  type PiiMatchSelection,
  type PiiTextSegment,
  type PiiWorkflowMode,
} from "@/lib/redaction-policy";
import {
  arrayBufferToBase64,
  createPdfDocumentData,
  isPdfFileName,
  type PdfDocumentData,
} from "@/lib/pdf-document";
import {
  bytesToBase64,
  createRedactedPdfBytes,
} from "@/lib/pdf-redacted-export";
import {
  markdownPiiTextChunks,
  pdfPiiTextChunks,
  type PiiTextChunk,
} from "@/lib/pii-text-chunks";
import { uiCopy, type AppLanguage, type UiCopy } from "@/lib/i18n";

type WorkTab = {
  id: string;
  title: string;
  documentKind: DocumentKind;
  input: string;
  output: string;
  matches: PiiMatch[];
  matchSelection: PiiMatchSelection;
  indexFormat: PiiIndexFormat;
  mode: PiiWorkflowMode;
  restoreInput: string;
  restoreOutput: string;
  pdfDocument?: PdfDocumentData;
};

type RedactResult = {
  backend: PiiBackend;
  redactedText: string;
  matches: PiiMatch[];
};

type TauriImportedFile = {
  path: string;
  fileName: string;
  kind: "markdown" | "pdf";
  contents?: string;
  dataBase64?: string;
};

type DocumentKind = "text" | "markdown" | "pdf";

type ImportedDocument = {
  path?: string;
  fileName: string;
  kind: Exclude<DocumentKind, "text">;
  contents: string;
  pdfDocument?: PdfDocumentData;
};

type DocumentImportMode = "current" | "new";
type CopyTarget = "input" | "output";
type ResizeDivider = "input-actions" | "actions-output";
type AppRoute = "/" | "/onboarding" | "/settings";
type FilteredItemsViewMode = "list" | "category";
type AppTheme = "light" | "dark";
type PdfRedactionStyle = "black-box" | "remove-text" | "both";
type PdfRedactionOption = Exclude<PdfRedactionStyle, "both">;
type PiiModelId = "regex" | "openai-privacy-filter" | "bardsai-eu-pii";

type ModelDownloadStatus = {
  modelId: string;
  downloaded: boolean;
  targetPath: string;
  missingFiles: string[];
  totalBytes: number;
};

type ModelDownloadResult = {
  modelId: string;
  targetPath: string;
  filesDownloaded: number;
  bytesWritten: number;
};

type ModelDownloadProgressPhase = "started" | "downloading" | "completed";

type ModelDownloadProgress = {
  modelId: string;
  phase: ModelDownloadProgressPhase;
  filePath?: string;
  fileIndex: number;
  fileCount: number;
  filesDownloaded: number;
  bytesWritten: number;
  expectedBytes: number;
  totalBytes: number;
};

type ModelLifecyclePhase =
  | "missing"
  | "downloaded"
  | "downloading"
  | "deleting"
  | "loading"
  | "inferencing"
  | "ready"
  | "error";

type ModelLifecycleStatus = {
  phase: ModelLifecyclePhase;
  message?: string;
  updatedAt: number;
};

type ColumnSizes = {
  input: number;
  actions: number;
  output: number;
};

const exampleInput = `Subject: Account access review

Hi Support,

Please contact Jordan Lee at jordan.lee@example.com or +1 (123) 456-7890 about the billing update for next week.

For the audit trail, keep billing-audit@example.com in the message after filtering by excluding that detected email from the output. The case note is at https://support.example.com/cases/PII-1234.

The affected user id is 8f14e45f-ea09-4f7a-9c04-2f5d3b12a8c9. The next review date is 2026-07-15.

The temporary service key is sk_live_abcdefg0123456. Rotate it after the support note is processed.

Thanks,
Operations`;

const defaultCustomRules: PiiCustomRule[] = [
  {
    id: "default-uuid",
    name: "UserId",
    mode: "regex",
    pattern:
      "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b",
  },
];

const defaultColumnSizes: ColumnSizes = {
  input: 40,
  actions: 20,
  output: 40,
};

const minimumColumnWidths = {
  input: 180,
  actions: 160,
  output: 180,
};

const modelIds: PiiModelId[] = [
  "regex",
  "openai-privacy-filter",
  "bardsai-eu-pii",
];
const expectedModelDownloadBytes: Record<Exclude<PiiModelId, "regex">, number> = {
  "openai-privacy-filter": 837_099_555,
  "bardsai-eu-pii": 295_523_237,
};

/**
 * `highlight` is the filled text→pii style; `restoreHighlight` is the
 * pii→text variant — same hue family, but a lighter fill with an inset
 * ring (plus a dashed underline added in piiHighlightClass) so the two
 * workflow directions read differently at a glance.
 */
const piiKindStyles = {
  privateemail: {
    badge: "border-sky-300 bg-sky-100 text-sky-900",
    highlight: "bg-sky-200/70 text-sky-950 decoration-sky-600",
    restoreHighlight:
      "bg-sky-100/60 text-sky-950 decoration-sky-500 ring-1 ring-inset ring-sky-400/70",
  },
  email: {
    badge: "border-sky-300 bg-sky-100 text-sky-900",
    highlight: "bg-sky-200/70 text-sky-950 decoration-sky-600",
    restoreHighlight:
      "bg-sky-100/60 text-sky-950 decoration-sky-500 ring-1 ring-inset ring-sky-400/70",
  },
  privatephone: {
    badge: "border-emerald-300 bg-emerald-100 text-emerald-900",
    highlight: "bg-emerald-200/70 text-emerald-950 decoration-emerald-600",
    restoreHighlight:
      "bg-emerald-100/60 text-emerald-950 decoration-emerald-500 ring-1 ring-inset ring-emerald-400/70",
  },
  phone: {
    badge: "border-emerald-300 bg-emerald-100 text-emerald-900",
    highlight: "bg-emerald-200/70 text-emerald-950 decoration-emerald-600",
    restoreHighlight:
      "bg-emerald-100/60 text-emerald-950 decoration-emerald-500 ring-1 ring-inset ring-emerald-400/70",
  },
  privateurl: {
    badge: "border-indigo-300 bg-indigo-100 text-indigo-900",
    highlight: "bg-indigo-200/75 text-indigo-950 decoration-indigo-700",
    restoreHighlight:
      "bg-indigo-100/60 text-indigo-950 decoration-indigo-500 ring-1 ring-inset ring-indigo-400/70",
  },
  privatedate: {
    badge: "border-teal-300 bg-teal-100 text-teal-900",
    highlight: "bg-teal-200/75 text-teal-950 decoration-teal-700",
    restoreHighlight:
      "bg-teal-100/60 text-teal-950 decoration-teal-500 ring-1 ring-inset ring-teal-400/70",
  },
  secret: {
    badge: "border-rose-300 bg-rose-100 text-rose-900",
    highlight: "bg-rose-200/75 text-rose-950 decoration-rose-700",
    restoreHighlight:
      "bg-rose-100/60 text-rose-950 decoration-rose-500 ring-1 ring-inset ring-rose-400/70",
  },
  userid: {
    badge: "border-amber-300 bg-amber-100 text-amber-950",
    highlight: "bg-amber-200/75 text-amber-950 decoration-amber-700",
    restoreHighlight:
      "bg-amber-100/60 text-amber-950 decoration-amber-500 ring-1 ring-inset ring-amber-400/70",
  },
  apikey: {
    badge: "border-rose-300 bg-rose-100 text-rose-900",
    highlight: "bg-rose-200/75 text-rose-950 decoration-rose-700",
    restoreHighlight:
      "bg-rose-100/60 text-rose-950 decoration-rose-500 ring-1 ring-inset ring-rose-400/70",
  },
  custom: {
    badge: "border-violet-300 bg-violet-100 text-violet-900",
    highlight: "bg-violet-200/75 text-violet-950 decoration-violet-700",
    restoreHighlight:
      "bg-violet-100/60 text-violet-950 decoration-violet-500 ring-1 ring-inset ring-violet-400/70",
  },
};

type HighlightedTextareaProps = {
  value: string;
  matches: PiiMatch[];
  selection: PiiMatchSelection;
  indexFormat: PiiIndexFormat;
  view: "input" | "output";
  workflow?: PiiWorkflowMode;
  sourceText?: string;
  readOnly?: boolean;
  placeholder: string;
  className?: string;
  onChange?: ChangeEventHandler<HTMLTextAreaElement>;
  copy: UiCopy;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function emailPattern() {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
}

function phonePattern() {
  return /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g;
}

function urlPattern() {
  return /\b(?:https?:\/\/|www\.)[A-Z0-9._~:/?#[\]@!$&'()*+,;=%-]*[A-Z0-9/#]/gi;
}

function datePattern() {
  return /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/gi;
}

function secretPattern() {
  return /\bsk_[A-Za-z0-9_]{12,}\b/g;
}

function createEntityId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}-${randomId}`;
}

function initialTab(
  id = createEntityId("tab"),
  title = "Doc 1",
  input = title === "Doc 1" ? exampleInput : "",
): WorkTab {
  return {
    id,
    title,
    documentKind: "text",
    input,
    output: "",
    matches: [],
    matchSelection: {},
    indexFormat: "number",
    mode: "text-to-pii",
    restoreInput: "",
    restoreOutput: "",
  };
}

function importedTab(file: ImportedDocument, id: string): WorkTab {
  return {
    id,
    title: file.fileName,
    documentKind: file.kind,
    input: file.contents,
    output: "",
    matches: [],
    matchSelection: {},
    indexFormat: "number",
    mode: "text-to-pii",
    restoreInput: "",
    restoreOutput: "",
    pdfDocument: file.pdfDocument,
  };
}

function piiTextChunksForTab(tab: WorkTab): PiiTextChunk[] | undefined {
  if (tab.documentKind === "markdown") {
    return markdownPiiTextChunks(tab.input);
  }

  if (tab.documentKind === "pdf" && tab.pdfDocument) {
    return pdfPiiTextChunks(tab.pdfDocument);
  }

  return undefined;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function isMarkdownFileName(fileName: string) {
  return /\.(md|markdown)$/i.test(fileName);
}

function isSupportedImportFileName(fileName: string) {
  return isMarkdownFileName(fileName) || isPdfFileName(fileName);
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function textStats(text: string, matches: PiiMatch[], copy: UiCopy) {
  return `${text.length} ${copy.workbench.chars} · ${wordCount(text)} ${
    copy.workbench.words
  }${matches.length > 0 ? ` · ${matches.length} ${copy.workbench.pii}` : ""}`;
}

function filteredWordCount(matches: PiiMatch[]) {
  return matches.reduce((count, match) => {
    const words = match.value.trim().split(/\s+/).filter(Boolean);
    return count + Math.max(words.length, match.value.trim() ? 1 : 0);
  }, 0);
}

function groupMatchesByCategory(matches: PiiMatch[]) {
  const groups = new Map<string, PiiMatch[]>();

  matches.forEach((match) => {
    const key = match.kind;
    groups.set(key, [...(groups.get(key) ?? []), match]);
  });

  return Array.from(groups, ([category, categoryMatches]) => ({
    category,
    matches: categoryMatches,
    wordCount: filteredWordCount(categoryMatches),
  }));
}

function customRuleSourceLabel(rule: PiiCustomRule, copy: UiCopy) {
  return rule.id.startsWith("default-")
    ? copy.settings.builtIn
    : copy.settings.user;
}

function piiKindDisplayLabel(kind: string) {
  const formatted = kind
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return formatted || kind;
}

function piiMatchBadgeLabel(match: PiiMatch) {
  if (match.id.startsWith("custom-")) return `custom:${match.kind}`;

  return piiKindDisplayLabel(match.kind);
}

function routePathFromLocation(): AppRoute {
  if (typeof window === "undefined") return "/";

  if (window.location.pathname === "/settings") return "/settings";
  if (window.location.pathname === "/onboarding") return "/onboarding";

  return "/";
}

const onboardingCompleteStorageKey = "pii-gui-onboarding-complete";

function isOnboardingComplete() {
  if (typeof window === "undefined") return true;

  return window.localStorage.getItem(onboardingCompleteStorageKey) === "true";
}

function initialRoutePath(): AppRoute {
  if (!isOnboardingComplete()) return "/onboarding";

  return routePathFromLocation();
}

function initialAppTheme(): AppTheme {
  if (typeof window === "undefined") return "light";

  return window.localStorage.getItem("pii-gui-theme") === "dark"
    ? "dark"
    : "light";
}

function initialAppLanguage(): AppLanguage {
  if (typeof window === "undefined") return "en";

  const storedLanguage = window.localStorage.getItem("pii-gui-language");
  if (isAppLanguage(storedLanguage)) return storedLanguage;

  const browserLanguage = navigator.language.toLowerCase();
  if (browserLanguage.startsWith("ko")) return "ko";
  if (browserLanguage.startsWith("ja")) return "ja";

  return "en";
}

function initialPdfRedactionStyle(): PdfRedactionStyle {
  if (typeof window === "undefined") return "black-box";

  const stored = window.localStorage.getItem("pii-gui-pdf-redaction-style");
  return stored === "remove-text" || stored === "both" ? stored : "black-box";
}

function pdfRedactionStyleHas(
  style: PdfRedactionStyle,
  option: PdfRedactionOption,
) {
  return style === "both" || style === option;
}

function togglePdfRedactionStyle(
  style: PdfRedactionStyle,
  option: PdfRedactionOption,
): PdfRedactionStyle {
  const blackBox =
    pdfRedactionStyleHas(style, "black-box") !== (option === "black-box");
  const removeText =
    pdfRedactionStyleHas(style, "remove-text") !== (option === "remove-text");

  // Keep at least one option active so exports always redact.
  if (!blackBox && !removeText) return style;
  if (blackBox && removeText) return "both";

  return blackBox ? "black-box" : "remove-text";
}

function initialPiiModel(): PiiModelId {
  if (typeof window === "undefined") return "openai-privacy-filter";

  const storedModel = window.localStorage.getItem("pii-gui-default-model");
  return isPiiModelId(storedModel) ? storedModel : "openai-privacy-filter";
}

function isAppLanguage(language: unknown): language is AppLanguage {
  return language === "en" || language === "ko" || language === "ja";
}

function isPiiModelId(value: unknown): value is PiiModelId {
  return typeof value === "string" && modelIds.includes(value as PiiModelId);
}

function isDownloadModelId(
  value: unknown,
): value is Exclude<PiiModelId, "regex"> {
  return value === "openai-privacy-filter" || value === "bardsai-eu-pii";
}

function modelIdToBackend(modelId: PiiModelId): PiiBackend {
  if (modelId === "openai-privacy-filter") return "onnx";
  if (modelId === "bardsai-eu-pii") return "bardsai";
  return "regex";
}

function backendToModelId(backend: PiiBackend): PiiModelId {
  if (backend === "onnx") return "openai-privacy-filter";
  if (backend === "bardsai") return "bardsai-eu-pii";
  return "regex";
}

function downloadModelIds(): Exclude<PiiModelId, "regex">[] {
  return ["openai-privacy-filter", "bardsai-eu-pii"];
}

function modelName(modelId: PiiModelId, copy: UiCopy) {
  if (modelId === "openai-privacy-filter") {
    return copy.onboarding.openAiPrivacyFilter;
  }
  if (modelId === "bardsai-eu-pii") return copy.onboarding.bardsAiEuPii;

  return copy.onboarding.regex;
}

function modelDescription(modelId: PiiModelId, copy: UiCopy) {
  if (modelId === "openai-privacy-filter") {
    return copy.onboarding.openAiPrivacyFilterDescription;
  }
  if (modelId === "bardsai-eu-pii") {
    return copy.onboarding.bardsAiEuPiiDescription;
  }

  return copy.onboarding.regexDescription;
}

function formatFileSize(bytes: number) {
  if (bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1000 && unitIndex < units.length - 1) {
    size /= 1000;
    unitIndex += 1;
  }

  const fractionDigits = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

function modelDownloadProgressPercent(
  modelId: Exclude<PiiModelId, "regex">,
  progress?: ModelDownloadProgress,
) {
  if (!progress) return 0;

  const expectedBytes = Math.max(
    progress.expectedBytes,
    expectedModelDownloadBytes[modelId],
  );
  if (expectedBytes <= 0) return 0;

  return clamp((progress.bytesWritten / expectedBytes) * 100, 0, 100);
}

function modelDownloadProgressLabel(
  modelId: Exclude<PiiModelId, "regex">,
  progress: ModelDownloadProgress,
  copy: UiCopy,
) {
  const expectedBytes = Math.max(
    progress.expectedBytes,
    expectedModelDownloadBytes[modelId],
  );
  const fileLabel =
    progress.fileCount > 0
      ? copy.settings.fileProgress
          .replace("{current}", String(Math.max(progress.fileIndex, 1)))
          .replace("{total}", String(progress.fileCount))
      : copy.settings.phaseDownloading;
  const percent = Math.round(
    modelDownloadProgressPercent(modelId, progress),
  );
  const currentFileName = progress.filePath?.split("/").pop();

  const label = `${percent}% · ${fileLabel} · ${formatFileSize(
    progress.bytesWritten,
  )} / ${formatFileSize(expectedBytes)}`;

  return currentFileName ? `${label} · ${currentFileName}` : label;
}

function modelLifecycleLabel(phase: ModelLifecyclePhase, copy: UiCopy) {
  switch (phase) {
    case "downloaded":
      return copy.settings.phaseDownloaded;
    case "downloading":
      return copy.settings.phaseDownloading;
    case "deleting":
      return copy.settings.phaseDeleting;
    case "loading":
      return copy.settings.phaseLoading;
    case "inferencing":
      return copy.settings.phaseInferencing;
    case "ready":
      return copy.settings.phaseReady;
    case "error":
      return copy.settings.phaseError;
    case "missing":
    default:
      return copy.settings.phaseMissing;
  }
}

function appUpdateStatusLabel(status: AppUpdateStatus, copy: UiCopy) {
  switch (status) {
    case "available":
      return copy.settings.updateAvailable;
    case "current":
      return copy.settings.upToDate;
    case "checking":
      return copy.settings.checkingUpdates;
    case "downloading":
      return copy.settings.updatingApp;
    case "error":
      return copy.settings.updateError;
    case "unavailable":
      return copy.settings.updateUnavailable;
    case "not-checked":
      return copy.settings.notChecked;
  }
}

function appUpdateDescription(
  status: AppUpdateStatus,
  version: string | undefined,
  error: string | undefined,
  copy: UiCopy,
) {
  switch (status) {
    case "available":
      return version
        ? copy.settings.updateAvailableDescription.replace("{version}", version)
        : copy.settings.updateAvailable;
    case "current":
      return copy.settings.upToDateDescription;
    case "checking":
      return copy.settings.checkingUpdatesDescription;
    case "downloading":
      return copy.settings.updatingAppDescription;
    case "error":
      return error ?? copy.settings.updateErrorDescription;
    case "unavailable":
      return copy.settings.updateUnavailableDescription;
    case "not-checked":
      return copy.settings.notCheckedDescription;
  }
}

function offsetPiiMatches(
  matches: PiiMatch[],
  offset: number,
  idPrefix: string,
) {
  return matches.map((match) => {
    const start = offset + match.start;
    const end = offset + match.end;

    return {
      ...match,
      id: `${idPrefix}-${match.id}`,
      start,
      end,
    };
  });
}

function matchOverlapsRange(match: PiiMatch, range: PiiTextChunk) {
  return match.start < range.end && match.end > range.start;
}

function ShortcutTooltipContent({
  children,
  shortcut,
}: {
  children: ReactNode;
  shortcut?: string;
}) {
  return (
    <TooltipContent>
      <span className="flex items-center gap-2">
        <span>{children}</span>
        {shortcut ? (
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
            {shortcut}
          </kbd>
        ) : null}
      </span>
    </TooltipContent>
  );
}

function SettingsPage({
  appMetadata,
  appUpdateError,
  appUpdateProgressLabel,
  appUpdateStatus,
  appUpdateVersion,
  copy,
  customRules,
  deletingModelId,
  downloadingModelId,
  downloadProgresses,
  downloadStatuses,
  modelLifecycleStatuses,
  onAddRule,
  onBack,
  onCheckAppUpdate,
  onDeleteModel,
  onDownloadModel,
  onInstallAppUpdate,
  onOpenOnboarding,
  onRefreshModelStatus,
  theme,
  onThemeChange,
  language,
  onLanguageChange,
  pdfRedactionStyle,
  onPdfRedactionStyleChange,
}: {
  appMetadata: AppMetadata;
  appUpdateError?: string;
  appUpdateProgressLabel?: string;
  appUpdateStatus: AppUpdateStatus;
  appUpdateVersion?: string;
  copy: UiCopy;
  customRules: PiiCustomRule[];
  deletingModelId?: Exclude<PiiModelId, "regex">;
  downloadingModelId?: Exclude<PiiModelId, "regex">;
  downloadProgresses: Partial<
    Record<Exclude<PiiModelId, "regex">, ModelDownloadProgress>
  >;
  downloadStatuses: Partial<Record<PiiModelId, ModelDownloadStatus>>;
  modelLifecycleStatuses: Partial<
    Record<Exclude<PiiModelId, "regex">, ModelLifecycleStatus>
  >;
  onAddRule: () => void;
  onBack: () => void;
  onCheckAppUpdate: () => void;
  onDeleteModel: (modelId: Exclude<PiiModelId, "regex">) => void;
  onDownloadModel: (modelId: Exclude<PiiModelId, "regex">) => void;
  onInstallAppUpdate: () => void;
  onOpenOnboarding: () => void;
  onRefreshModelStatus: (modelId: Exclude<PiiModelId, "regex">) => void;
  theme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  pdfRedactionStyle: PdfRedactionStyle;
  onPdfRedactionStyleChange: (style: PdfRedactionStyle) => void;
}) {
  const metadataRows: Array<[string, string]> = [
    [copy.settings.appVersion, appMetadata.appVersion],
    [copy.settings.osPlatform, appMetadata.osPlatform],
    [copy.settings.osVersion, appMetadata.osVersion],
    [copy.settings.osArch, appMetadata.osArch],
  ];
  const canCheckAppUpdate =
    appUpdateStatus !== "checking" &&
    appUpdateStatus !== "downloading" &&
    appUpdateStatus !== "unavailable";
  const canInstallAppUpdate = appUpdateStatus === "available";
  const updaterDescription = appUpdateDescription(
    appUpdateStatus,
    appUpdateVersion,
    appUpdateError,
    copy,
  );
  const modelOptions: Array<{
    id: Exclude<PiiModelId, "regex">;
    name: string;
    expectedBytes: number;
  }> = [
    {
      id: "openai-privacy-filter",
      name: copy.onboarding.openAiPrivacyFilter,
      expectedBytes: expectedModelDownloadBytes["openai-privacy-filter"],
    },
    {
      id: "bardsai-eu-pii",
      name: copy.onboarding.bardsAiEuPii,
      expectedBytes: expectedModelDownloadBytes["bardsai-eu-pii"],
    },
  ];

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="flex items-start gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-0.5"
            onClick={onBack}
          >
            <ChevronLeft aria-hidden="true" />
            {copy.nav.back}
          </Button>
          <div>
            <h2 className="text-lg font-semibold">{copy.settings.title}</h2>
            <p className="text-sm text-muted-foreground">
              {copy.settings.description}
            </p>
          </div>
        </div>

        <section className="space-y-3 rounded-md border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">
                {copy.settings.appearance}
              </h3>
              <p className="text-xs text-muted-foreground">
                {copy.settings.appearanceDescription}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex rounded-md border bg-muted p-0.5">
                <Button
                  type="button"
                  variant={theme === "light" ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-8 px-3 text-xs",
                    theme === "light" &&
                      "border border-border bg-background text-foreground shadow-sm ring-1 ring-ring/20 hover:bg-background",
                  )}
                  onClick={() => onThemeChange("light")}
                >
                  {copy.settings.light}
                </Button>
                <Button
                  type="button"
                  variant={theme === "dark" ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "h-8 px-3 text-xs",
                    theme === "dark" &&
                      "border border-border bg-background text-foreground shadow-sm ring-1 ring-ring/20 hover:bg-background",
                  )}
                  onClick={() => onThemeChange("dark")}
                >
                  {copy.settings.dark}
                </Button>
              </div>
              <Select
                value={language}
                onValueChange={(value) => {
                  if (isAppLanguage(value)) onLanguageChange(value);
                }}
              >
                <SelectTrigger className="h-9 w-36">
                  <SelectValue aria-label={copy.settings.language} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{copy.settings.english}</SelectItem>
                  <SelectItem value="ko">{copy.settings.korean}</SelectItem>
                  <SelectItem value="ja">{copy.settings.japanese}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-md border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">
                {copy.settings.pdfExport}
              </h3>
              <p className="text-xs text-muted-foreground">
                {copy.settings.pdfExportDescription}
              </p>
            </div>
            <div
              className="flex rounded-md border bg-muted p-0.5"
              role="group"
              aria-label={copy.settings.redactionStyle}
            >
              {(
                [
                  ["black-box", copy.settings.redactionBlackBox],
                  ["remove-text", copy.settings.redactionRemoveText],
                ] as Array<[PdfRedactionOption, string]>
              ).map(([option, label]) => {
                const active = pdfRedactionStyleHas(pdfRedactionStyle, option);

                return (
                  <Button
                    key={option}
                    type="button"
                    variant={active ? "secondary" : "ghost"}
                    size="sm"
                    aria-pressed={active}
                    className={cn(
                      "h-8 px-3 text-xs",
                      active &&
                        "border border-border bg-background text-foreground shadow-sm ring-1 ring-ring/20 hover:bg-background",
                    )}
                    onClick={() =>
                      onPdfRedactionStyleChange(
                        togglePdfRedactionStyle(pdfRedactionStyle, option),
                      )
                    }
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="space-y-3 rounded-md border bg-card p-4">
          <div>
            <h3 className="text-sm font-medium">
              {copy.settings.modelStatus}
            </h3>
            <p className="text-xs text-muted-foreground">
              {copy.settings.modelStatusDescription}
            </p>
          </div>
          <div className="grid gap-3">
            {modelOptions.map((model) => {
              const status = downloadStatuses[model.id];
              const lifecycleStatus = modelLifecycleStatuses[model.id];
              const downloadProgress = downloadProgresses[model.id];
              const isDownloaded = Boolean(status?.downloaded);
              const isDownloading = downloadingModelId === model.id;
              const isDeleting = deletingModelId === model.id;
              const hasCheckpoint = Boolean(
                isDownloaded || (status?.totalBytes ?? 0) > 0,
              );
              const sizeBytes =
                status && status.totalBytes > 0
                  ? status.totalBytes
                  : model.expectedBytes;

              return (
                <div key={model.id} className="rounded-md border p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-medium">{model.name}</h4>
                        <Badge variant={isDownloaded ? "secondary" : "outline"}>
                          {isDownloaded
                            ? copy.settings.installed
                            : copy.settings.notInstalled}
                        </Badge>
                        <Badge variant="outline">
                          {copy.settings.modelPhase}:{" "}
                          {modelLifecycleLabel(
                            lifecycleStatus?.phase ??
                              (status?.downloaded ? "downloaded" : "missing"),
                            copy,
                          )}
                        </Badge>
                      </div>
                      {lifecycleStatus?.message ? (
                        <p className="text-xs text-muted-foreground">
                          {lifecycleStatus.message}
                        </p>
                      ) : null}
                      {isDownloading && downloadProgress ? (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{copy.settings.downloadProgress}</span>
                            <span>
                              {modelDownloadProgressLabel(
                                model.id,
                                downloadProgress,
                                copy,
                              )}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{
                                width: `${modelDownloadProgressPercent(
                                  model.id,
                                  downloadProgress,
                                )}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {status && status.totalBytes > 0
                          ? copy.settings.checkpointSize
                          : copy.settings.expectedDownloadSize}
                        : {formatFileSize(sizeBytes)}
                      </p>
                      {status && status.missingFiles.length > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {copy.settings.missingFiles}:{" "}
                          {status.missingFiles.length}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {isDownloaded ? null : (
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={isDownloading || isDeleting}
                          onClick={() => onDownloadModel(model.id)}
                        >
                          {isDownloading ? (
                            <LoaderCircle className="animate-spin" aria-hidden="true" />
                          ) : (
                            <Download aria-hidden="true" />
                          )}
                          {copy.onboarding.download}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8"
                        aria-label={copy.settings.refreshStatus}
                        title={copy.settings.refreshStatus}
                        onClick={() => onRefreshModelStatus(model.id)}
                      >
                        <RotateCcw aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="size-8"
                        aria-label={copy.settings.deleteModel}
                        title={copy.settings.deleteModel}
                        disabled={!hasCheckpoint || isDeleting}
                        onClick={() => onDeleteModel(model.id)}
                      >
                        {isDeleting ? (
                          <LoaderCircle className="animate-spin" aria-hidden="true" />
                        ) : (
                          <Trash2 aria-hidden="true" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="space-y-3 rounded-md border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">
                {copy.settings.customRules}
              </h3>
              <p className="text-xs text-muted-foreground">
                {copy.settings.customRulesDescription}
              </p>
            </div>
            <Button type="button" size="sm" onClick={onAddRule}>
              <Plus aria-hidden="true" />
              {copy.settings.addRule}
            </Button>
          </div>

          {customRules.length > 0 ? (
            <ScrollArea className="max-h-[32rem] rounded-md border">
              <ul className="divide-y">
                {customRules.map((rule) => (
                  <li key={rule.id} className="space-y-2 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {rule.name || copy.settings.custom}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {customRuleSourceLabel(rule, copy)}
                        </div>
                      </div>
                      <Badge variant="secondary">{rule.mode}</Badge>
                    </div>
                    <code className="block overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                      {rule.pattern}
                    </code>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          ) : (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              {copy.settings.noCustomRules}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-md border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">
                {copy.settings.onboarding}
              </h3>
              <p className="text-xs text-muted-foreground">
                {copy.settings.onboardingDescription}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenOnboarding}
            >
              {copy.settings.openOnboarding}
            </Button>
          </div>
        </section>

        <section className="space-y-3 rounded-md border bg-card p-4">
          <div>
            <h3 className="text-sm font-medium">
              {copy.settings.systemInfo}
            </h3>
            <p className="text-xs text-muted-foreground">
              {copy.settings.systemInfoDescription}
            </p>
          </div>
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            {metadataRows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 truncate font-medium" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="rounded-md border bg-background px-3 py-2 text-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{copy.settings.appUpdates}</p>
                  <Badge variant="outline">
                    {appUpdateStatusLabel(appUpdateStatus, copy)}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {updaterDescription}
                </p>
                {appUpdateProgressLabel ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {appUpdateProgressLabel}
                  </p>
                ) : null}
              </div>
              {canInstallAppUpdate ? (
                <Button type="button" size="sm" onClick={onInstallAppUpdate}>
                  {copy.settings.updateApp}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canCheckAppUpdate}
                  onClick={onCheckAppUpdate}
                >
                  {appUpdateStatus === "checking"
                    ? copy.settings.checkingUpdates
                    : appUpdateStatus === "downloading"
                      ? copy.settings.updatingApp
                      : copy.settings.checkUpdates}
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function OnboardingPage({
  copy,
  defaultModel,
  downloadProgresses,
  downloadStatuses,
  downloadingModelId,
  language,
  onBack,
  onDownloadModel,
  onLanguageChange,
  onModelChange,
  onOpenWorkbench,
  onOpenSettings,
}: {
  copy: UiCopy;
  defaultModel: PiiModelId;
  downloadProgresses: Partial<
    Record<Exclude<PiiModelId, "regex">, ModelDownloadProgress>
  >;
  downloadStatuses: Partial<Record<PiiModelId, ModelDownloadStatus>>;
  downloadingModelId?: PiiModelId;
  language: AppLanguage;
  onBack: () => void;
  onDownloadModel: (modelId: Exclude<PiiModelId, "regex">) => void;
  onLanguageChange: (language: AppLanguage) => void;
  onModelChange: (modelId: PiiModelId) => void;
  onOpenWorkbench: () => void;
  onOpenSettings: () => void;
}) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const modelOptions: Array<{
    id: PiiModelId;
    name: string;
    description: string;
    downloadable: boolean;
    expectedBytes?: number;
  }> = [
    {
      id: "regex",
      name: copy.onboarding.regex,
      description: copy.onboarding.regexDescription,
      downloadable: false,
    },
    {
      id: "openai-privacy-filter",
      name: copy.onboarding.localAiPrivacyFilter,
      description: copy.onboarding.openAiPrivacyFilterDescription,
      downloadable: true,
      expectedBytes: expectedModelDownloadBytes["openai-privacy-filter"],
    },
    {
      id: "bardsai-eu-pii",
      name: copy.onboarding.localAiEuPii,
      description: copy.onboarding.bardsAiEuPiiDescription,
      downloadable: true,
      expectedBytes: expectedModelDownloadBytes["bardsai-eu-pii"],
    },
  ];
  const onboardingSteps = [
    { id: "intro", label: copy.onboarding.stepIntro },
    { id: "models", label: copy.onboarding.stepModels },
  ] as const;
  const activeStep = onboardingSteps[activeStepIndex]?.id ?? "intro";
  const isLastStep = activeStepIndex === onboardingSteps.length - 1;
  const goToPreviousStep = () => {
    setActiveStepIndex((current) => Math.max(current - 1, 0));
  };
  const goToNextStep = () => {
    setActiveStepIndex((current) =>
      Math.min(current + 1, onboardingSteps.length - 1),
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div className="flex items-start gap-3">
          {activeStepIndex > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-0.5"
              onClick={onBack}
            >
              <ChevronLeft aria-hidden="true" />
              {copy.nav.back}
            </Button>
          ) : null}
          <div>
            <h2 className="text-lg font-semibold">{copy.onboarding.title}</h2>
            <p className="text-sm text-muted-foreground">
              {copy.onboarding.description}
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-md border bg-card p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  {copy.onboarding.stepCounter
                    .replace("{current}", String(activeStepIndex + 1))
                    .replace("{total}", String(onboardingSteps.length))}
                </div>
                <h3 className="text-base font-semibold">
                  {onboardingSteps[activeStepIndex]?.label}
                </h3>
              </div>
              <div className="flex gap-2">
                {onboardingSteps.map((step, index) => (
                  <button
                    key={step.id}
                    type="button"
                    className={cn(
                      "h-2.5 w-8 rounded-full bg-muted transition-colors",
                      index <= activeStepIndex && "bg-primary",
                    )}
                    aria-label={step.label}
                    aria-current={index === activeStepIndex ? "step" : undefined}
                    onClick={() => setActiveStepIndex(index)}
                  />
                ))}
              </div>
            </div>

            {activeStep === "intro" ? (
              <div className="space-y-4">
                <section className="space-y-3">
                  <h3 className="text-sm font-medium">
                    {copy.onboarding.features}
                  </h3>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-md border p-4">
                      <ShieldCheck className="mb-3 size-5 text-primary" aria-hidden="true" />
                      <h4 className="text-sm font-medium">
                        {copy.onboarding.localFirstTitle}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {copy.onboarding.localFirstDescription}
                      </p>
                    </div>
                    <div className="rounded-md border p-4">
                      <Check className="mb-3 size-5 text-primary" aria-hidden="true" />
                      <h4 className="text-sm font-medium">
                        {copy.onboarding.builtInTitle}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {copy.onboarding.builtInDescription}
                      </p>
                    </div>
                    <div className="rounded-md border p-4">
                      <Download className="mb-3 size-5 text-primary" aria-hidden="true" />
                      <h4 className="text-sm font-medium">
                        {copy.onboarding.modelFilesTitle}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {copy.onboarding.modelFilesDescription}
                      </p>
                    </div>
                  </div>
                </section>
                <section className="space-y-3 rounded-md border p-4">
                  <h3 className="text-sm font-medium">
                    {copy.onboarding.appLanguage}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {copy.onboarding.languageDescription}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        { id: "en", label: copy.onboarding.english },
                        { id: "ko", label: copy.onboarding.korean },
                        { id: "ja", label: copy.onboarding.japanese },
                      ] as const
                    ).map((option) => (
                      <Button
                        key={option.id}
                        type="button"
                        variant={language === option.id ? "default" : "outline"}
                        size="sm"
                        onClick={() => onLanguageChange(option.id)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}

            {activeStep === "models" ? (
              <section className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium">{copy.onboarding.model}</h3>
                  <p className="text-xs text-muted-foreground">
                    {copy.onboarding.modelDescription}
                  </p>
                </div>
                <div className="grid gap-3">
                  {modelOptions.map((model) => {
                    const status = downloadStatuses[model.id];
                    const isSelected = defaultModel === model.id;
                    const isDownloading = downloadingModelId === model.id;
                    const downloadProgress = isDownloadModelId(model.id)
                      ? downloadProgresses[model.id]
                      : undefined;
                    const fileSizeLabel = model.downloadable
                      ? status?.downloaded && status.totalBytes > 0
                        ? `${copy.onboarding.downloadedSize}: ${formatFileSize(
                            status.totalBytes,
                          )}`
                        : `${copy.onboarding.estimatedSize}: ${formatFileSize(
                            model.expectedBytes ?? 0,
                          )}`
                      : null;

                    return (
                      <div
                        key={model.id}
                        className={cn(
                          "flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between",
                          isSelected && "border-primary bg-primary/5",
                        )}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-sm font-medium">{model.name}</h4>
                            {isSelected ? (
                              <Badge>{copy.onboarding.defaultModel}</Badge>
                            ) : null}
                            {model.downloadable ? (
                              <Badge
                                variant={status?.downloaded ? "secondary" : "outline"}
                              >
                                {status?.downloaded
                                  ? copy.onboarding.downloaded
                                  : copy.onboarding.notDownloaded}
                              </Badge>
                            ) : (
                              <Badge variant="secondary">
                                {copy.onboarding.builtIn}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {model.description}
                          </p>
                          {fileSizeLabel ? (
                            <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                              <span className="rounded-md bg-muted px-2 py-1">
                                {fileSizeLabel}
                              </span>
                            </div>
                          ) : null}
                          {isDownloading &&
                          downloadProgress &&
                          isDownloadModelId(model.id) ? (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>{copy.settings.downloadProgress}</span>
                                <span>
                                  {modelDownloadProgressLabel(
                                    model.id,
                                    downloadProgress,
                                    copy,
                                  )}
                                </span>
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                                <div
                                  className="h-full rounded-full bg-primary transition-all"
                                  style={{
                                    width: `${modelDownloadProgressPercent(
                                      model.id,
                                      downloadProgress,
                                    )}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button
                            type="button"
                            variant={isSelected ? "default" : "outline"}
                            size="sm"
                            onClick={() => onModelChange(model.id)}
                          >
                            <Check aria-hidden="true" />
                            {copy.onboarding.useAsDefault}
                          </Button>
                          {model.downloadable ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={isDownloading}
                              onClick={() =>
                                onDownloadModel(
                                  model.id as Exclude<PiiModelId, "regex">,
                                )
                              }
                            >
                              {isDownloading ? (
                                <LoaderCircle
                                  className="animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <Download aria-hidden="true" />
                              )}
                              {status?.downloaded
                                ? copy.onboarding.redownload
                                : copy.onboarding.download}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={activeStepIndex === 0}
                onClick={goToPreviousStep}
              >
                <ChevronLeft aria-hidden="true" />
                {copy.onboarding.previous}
              </Button>
              <div className="flex flex-wrap gap-2">
                {isLastStep ? (
                  <>
                    <Button type="button" variant="outline" onClick={onOpenSettings}>
                      {copy.onboarding.reviewSettings}
                    </Button>
                    <Button type="button" onClick={onOpenWorkbench}>
                      {copy.onboarding.startFiltering}
                    </Button>
                  </>
                ) : (
                  <Button type="button" onClick={goToNextStep}>
                    {copy.onboarding.next}
                    <ChevronRight aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

function minColumnPercent(width: number, containerWidth: number) {
  return (width / containerWidth) * 100;
}

function styleForPiiKind(kind: string) {
  const normalizedKind = kind.toLowerCase().replace(/[^a-z0-9]/g, "");

  return (
    piiKindStyles[normalizedKind as keyof typeof piiKindStyles] ??
    piiKindStyles.custom
  );
}

function piiBadgeClass(kind: string) {
  return styleForPiiKind(kind).badge;
}

function piiHighlightClass(
  matches: PiiMatch[],
  workflow: PiiWorkflowMode = "text-to-pii",
) {
  const primaryMatch = matches[0];
  if (!primaryMatch) return "";

  const style = styleForPiiKind(primaryMatch.kind);

  return cn(
    "rounded-[3px] px-0.5 underline decoration-2 underline-offset-2",
    workflow === "pii-to-text"
      ? cn("decoration-dashed", style.restoreHighlight)
      : style.highlight,
    matches.length > 1 && "ring-1 ring-inset ring-fuchsia-500/70",
  );
}

function piiExecutionSummary(
  matches: PiiMatch[],
  selection: PiiMatchSelection,
  copy: UiCopy,
) {
  return matches
    .map((match) => {
      const status =
        selection[match.id] === false
          ? copy.status.excluded
          : copy.status.included;

      return `${match.kind}: ${match.value}\n${copy.status.status}: ${status}\n${copy.status.range}: ${match.start}-${match.end}`;
    })
    .join("\n\n");
}

function piiTaskCategorySummary(matches: PiiMatch[]) {
  const counts = new Map<string, number>();

  matches.forEach((match) => {
    counts.set(match.kind, (counts.get(match.kind) ?? 0) + 1);
  });

  return Array.from(counts, ([kind, count]) => ({ kind, count })).sort(
    (left, right) => right.count - left.count || left.kind.localeCompare(right.kind),
  );
}

function renderHighlightedSegments(
  segments: PiiTextSegment[],
  selection: PiiMatchSelection,
  copy: UiCopy,
  workflow: PiiWorkflowMode = "text-to-pii",
) {
  return segments.map((segment, index) => {
    if (segment.matches.length === 0) {
      return <span key={index}>{segment.text}</span>;
    }

    return (
      <span
        key={index}
        className={cn(
          "pointer-events-auto",
          piiHighlightClass(segment.matches, workflow),
        )}
        title={piiExecutionSummary(segment.matches, selection, copy)}
      >
        {segment.text}
      </span>
    );
  });
}

function highlightedSegmentsFor({
  value,
  matches,
  selection,
  indexFormat,
  sourceText,
  view,
  workflow,
}: {
  value: string;
  matches: PiiMatch[];
  selection: PiiMatchSelection;
  indexFormat: PiiIndexFormat;
  sourceText?: string;
  view: "input" | "output";
  workflow: PiiWorkflowMode;
}) {
  if (workflow === "pii-to-text") {
    // Restore direction: the input pane highlights the replacement tokens,
    // and the output pane highlights the recovered values.
    const segments = createRestoredTextSegments({
      input: view === "output" ? (sourceText ?? "") : value,
      matches,
      selection,
      indexFormat,
      emit: view === "output" ? "values" : "tokens",
    });
    // The overlay must mirror the textarea text exactly; fall back to plain
    // text if the segments drift from it (e.g. a stale restore output).
    if (segments.map((segment) => segment.text).join("") === value) {
      return segments;
    }

    return createInputTextSegments(value, []);
  }

  if (view === "output" && sourceText && value) {
    return createRedactedTextSegments({
      input: sourceText,
      matches,
      selection,
      indexFormat,
    });
  }

  return createInputTextSegments(value, matches);
}

function HighlightedTextarea({
  value,
  matches,
  selection,
  indexFormat,
  view,
  workflow = "text-to-pii",
  sourceText,
  readOnly,
  placeholder,
  className,
  onChange,
  copy,
}: HighlightedTextareaProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const segments = highlightedSegmentsFor({
    value,
    matches,
    selection,
    indexFormat,
    sourceText,
    view,
    workflow,
  });

  function syncOverlayScroll(event: UIEvent<HTMLTextAreaElement>) {
    if (!overlayRef.current) return;

    overlayRef.current.scrollTop = event.currentTarget.scrollTop;
    overlayRef.current.scrollLeft = event.currentTarget.scrollLeft;
  }

  return (
    <div
      className={cn(
        "relative min-h-0 w-full flex-1 overflow-hidden rounded-md bg-card",
        className,
      )}
    >
      <div
        ref={overlayRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2 font-mono text-sm leading-6 whitespace-pre-wrap text-foreground",
          readOnly || !isFocused ? "z-20" : "z-0",
        )}
      >
        <div className="min-h-full break-words">
          {renderHighlightedSegments(segments, selection, copy, workflow)}
        </div>
      </div>
      <Textarea
        value={value}
        readOnly={readOnly}
        spellCheck={false}
        placeholder={placeholder}
        onChange={onChange}
        onScroll={syncOverlayScroll}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        className="relative z-10 h-full min-h-0 w-full resize-none overflow-auto bg-transparent font-mono leading-6 text-transparent caret-foreground selection:bg-primary/20 [field-sizing:fixed]"
      />
    </div>
  );
}

function ColumnResizeHandle({
  label,
  onKeyDown,
  onPointerDown,
}: {
  label: string;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      className="focus-visible:ring-ring group relative flex w-3 shrink-0 cursor-col-resize touch-none items-center justify-center outline-none focus-visible:ring-1 focus-visible:ring-offset-1"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      <div className="z-10 flex h-6 w-3 items-center justify-center rounded-xs border border-border bg-card opacity-0 shadow-xs transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <GripVertical className="size-2.5 text-muted-foreground" aria-hidden="true" />
      </div>
    </div>
  );
}

function filterPii(input: string) {
  const matches: PiiMatch[] = [
    ...Array.from(input.matchAll(emailPattern()), (match, index) => {
      const start = match.index ?? index;

      return {
        id: `private-email-${start}-${index}`,
        kind: "private_email" as const,
        value: match[0],
        start,
        end: start + match[0].length,
      };
    }),
    ...Array.from(input.matchAll(phonePattern()), (match, index) => {
      const start = match.index ?? index;

      return {
        id: `private-phone-${start}-${index}`,
        kind: "private_phone" as const,
        value: match[0],
        start,
        end: start + match[0].length,
      };
    }),
    ...Array.from(input.matchAll(urlPattern()), (match, index) => {
      const start = match.index ?? index;

      return {
        id: `private-url-${start}-${index}`,
        kind: "private_url" as const,
        value: match[0],
        start,
        end: start + match[0].length,
      };
    }),
    ...Array.from(input.matchAll(datePattern()), (match, index) => {
      const start = match.index ?? index;

      return {
        id: `private-date-${start}-${index}`,
        kind: "private_date" as const,
        value: match[0],
        start,
        end: start + match[0].length,
      };
    }),
    ...Array.from(input.matchAll(secretPattern()), (match, index) => {
      const start = match.index ?? index;

      return {
        id: `secret-${start}-${index}`,
        kind: "secret" as const,
        value: match[0],
        start,
        end: start + match[0].length,
      };
    }),
  ].sort((a, b) => a.start - b.start);

  const redactedText = input
    .replace(emailPattern(), "[PRIVATE_EMAIL]")
    .replace(phonePattern(), "[PRIVATE_PHONE]")
    .replace(urlPattern(), "[PRIVATE_URL]")
    .replace(datePattern(), "[PRIVATE_DATE]")
    .replace(secretPattern(), "[SECRET]");

  return { backend: "regex" as const, matches, redactedText };
}

async function redactText(
  input: string,
  backend: PiiBackend = "regex",
): Promise<RedactResult> {
  if (window.__TAURI_INTERNALS__) {
    return invoke<RedactResult>("redact_text", {
      input,
      backend,
    });
  }

  return filterPii(input);
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

function buildAiRulePrompt(purpose: string, examples: string) {
  const exampleLines = examples
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return [
    "You are a regular expression expert helping configure a PII redaction tool.",
    "Write one JavaScript-compatible regular expression for the filter described below.",
    "",
    `Filter purpose: ${purpose}`,
    ...(exampleLines.length > 0
      ? [
          "",
          "Examples the pattern must match:",
          ...exampleLines.map((line) => `- ${line}`),
        ]
      : []),
    "",
    "Requirements:",
    '- The pattern is compiled with `new RegExp(pattern, "gi")`, so do not include slashes, flags, or inline flag groups.',
    "- Match only the sensitive value itself, not the surrounding text.",
    "- Keep the pattern specific enough to avoid false positives and avoid catastrophic backtracking.",
    "- Reply with only the regex pattern on a single line inside a fenced ```regex code block, without quotes or explanation, so it can be copied directly.",
  ].join("\n");
}

function safeFileStem(value: string) {
  return (
    value
      .trim()
      .replace(/\.[A-Za-z0-9]+$/, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pii-output"
  );
}

function defaultOutputFileName(tab: WorkTab) {
  return `${safeFileStem(tab.title)}-redacted.txt`;
}

function defaultRedactedPdfFileName(tab: WorkTab) {
  return `${safeFileStem(tab.title)}-redacted.pdf`;
}

function defaultInputFileName(tab: WorkTab) {
  return `${safeFileStem(tab.title)}-input.txt`;
}

function defaultPanelFileName(target: CopyTarget, tab: WorkTab) {
  return target === "input" ? defaultInputFileName(tab) : defaultOutputFileName(tab);
}

function panelText(target: CopyTarget, tab: WorkTab) {
  if (tab.mode === "pii-to-text") {
    return target === "input" ? tab.restoreInput : tab.restoreOutput;
  }

  return target === "input" ? tab.input : tab.output;
}

function panelDownloadTitle(target: CopyTarget, copy: UiCopy) {
  return target === "input"
    ? copy.workbench.saveInput
    : copy.workbench.saveOutput;
}

function downloadTextInBrowser(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function downloadBytesInBrowser(fileName: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function App() {
  const appUpdater = useAutoUpdater();

  const initialTabId = useRef(createEntityId("tab"));
  const nextTabNumber = useRef(2);
  const nextTaskNumber = useRef(1);
  const runningTaskId = useRef<string | undefined>(undefined);
  const copiedResetTimer = useRef<number | undefined>(undefined);
  const primaryActionPressTimer = useRef<number | undefined>(undefined);
  const [tabs, setTabs] = useState<WorkTab[]>(() => [
    initialTab(initialTabId.current),
  ]);
  const [closedTabs, setClosedTabs] = useState<WorkTab[]>([]);
  const [activeTabId, setActiveTabId] = useState(initialTabId.current);
  const [editingTabId, setEditingTabId] = useState<string | undefined>();
  const [editingTabTitle, setEditingTabTitle] = useState("");
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | undefined>();
  const [primaryActionPressKey, setPrimaryActionPressKey] = useState(0);
  const [columnSizes, setColumnSizes] =
    useState<ColumnSizes>(defaultColumnSizes);
  const [piiTasks, setPiiTasks] = useState<PiiTaskRecord[]>([]);
  const [isTaskHistoryOpen, setIsTaskHistoryOpen] = useState(false);
  const [missingFilterModelId, setMissingFilterModelId] = useState<
    Exclude<PiiModelId, "regex"> | undefined
  >();
  const [taskHistoryPage, setTaskHistoryPage] = useState(1);
  const [filteredItemsViewMode, setFilteredItemsViewMode] =
    useState<FilteredItemsViewMode>("list");
  const [customRules, setCustomRules] =
    useState<PiiCustomRule[]>(defaultCustomRules);
  const [isRuleDialogOpen, setIsRuleDialogOpen] = useState(false);
  const [customRuleMode, setCustomRuleMode] =
    useState<PiiCustomRule["mode"]>("exact");
  const [customRuleName, setCustomRuleName] = useState("Custom");
  const [customRulePattern, setCustomRulePattern] = useState("");
  const [ruleDialogView, setRuleDialogView] = useState<
    "manual" | "aiPurpose" | "aiPrompt"
  >("manual");
  const [aiRulePurpose, setAiRulePurpose] = useState("");
  const [aiRuleExamples, setAiRuleExamples] = useState("");
  const [pendingDocuments, setPendingDocuments] = useState<ImportedDocument[]>(
    [],
  );
  const [theme, setTheme] = useState<AppTheme>(() => initialAppTheme());
  const [language, setLanguage] = useState<AppLanguage>(() =>
    initialAppLanguage(),
  );
  const [defaultModel, setDefaultModel] = useState<PiiModelId>(() =>
    initialPiiModel(),
  );
  const [pdfRedactionStyle, setPdfRedactionStyle] =
    useState<PdfRedactionStyle>(() => initialPdfRedactionStyle());
  const [routePath, setRoutePath] = useState<AppRoute>(() =>
    initialRoutePath(),
  );
  const [isPersistenceReady, setIsPersistenceReady] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [modelDownloadStatuses, setModelDownloadStatuses] = useState<
    Partial<Record<PiiModelId, ModelDownloadStatus>>
  >({});
  const [downloadingModelId, setDownloadingModelId] = useState<
    Exclude<PiiModelId, "regex"> | undefined
  >();
  const [deletingModelId, setDeletingModelId] = useState<
    Exclude<PiiModelId, "regex"> | undefined
  >();
  const [modelLifecycleStatuses, setModelLifecycleStatuses] = useState<
    Partial<Record<Exclude<PiiModelId, "regex">, ModelLifecycleStatus>>
  >({});
  const [modelDownloadProgresses, setModelDownloadProgresses] = useState<
    Partial<Record<Exclude<PiiModelId, "regex">, ModelDownloadProgress>>
  >({});
  const [appMetadata, setAppMetadata] = useState<AppMetadata>(() =>
    createFallbackAppMetadata(),
  );
  const loadedModelIds = useRef(new Set<Exclude<PiiModelId, "regex">>());

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const copy = uiCopy[language];
  const piiBackend = modelIdToBackend(defaultModel);
  const appUpdateProgressLabel = appUpdater.progress
    ? appUpdater.progress.total
      ? `${formatFileSize(appUpdater.progress.downloaded)} / ${formatFileSize(
          appUpdater.progress.total,
        )}`
      : formatFileSize(appUpdater.progress.downloaded)
    : undefined;

  function setPersistenceNotice(action: string, error: unknown) {
    setNotice(
      `${action}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  function navigate(route: AppRoute) {
    window.history.pushState({}, "", route);
    setRoutePath(route);
  }

  function completeOnboarding(route: AppRoute) {
    window.localStorage.setItem(onboardingCompleteStorageKey, "true");
    navigate(route);
  }

  function setModelLifecycleStatus(
    modelId: Exclude<PiiModelId, "regex">,
    phase: ModelLifecyclePhase,
    message?: string,
  ) {
    setModelLifecycleStatuses((currentStatuses) => ({
      ...currentStatuses,
      [modelId]: {
        phase,
        message,
        updatedAt: Date.now(),
      },
    }));
  }

  async function refreshModelStatus(modelId: Exclude<PiiModelId, "regex">) {
    if (!window.__TAURI_INTERNALS__) {
      setModelDownloadStatuses((currentStatuses) => ({
        ...currentStatuses,
        [modelId]: {
          modelId,
          downloaded: false,
          targetPath: "",
          missingFiles: [],
          totalBytes: 0,
        },
      }));
      setModelLifecycleStatus(modelId, "missing");
      return;
    }

    const status = await invoke<ModelDownloadStatus>("model_download_status", {
      modelId,
    });
    setModelDownloadStatuses((currentStatuses) => ({
      ...currentStatuses,
      [modelId]: status,
    }));
    if (downloadingModelId === modelId) return;
    setModelLifecycleStatus(
      modelId,
      status.downloaded ? "downloaded" : "missing",
    );
  }

  async function downloadPiiModel(modelId: Exclude<PiiModelId, "regex">) {
    if (!window.__TAURI_INTERNALS__) {
      setNotice(copy.onboarding.downloadRequiresApp);
      return;
    }
    if (downloadingModelId === modelId) return;

    setDownloadingModelId(modelId);
    setModelLifecycleStatus(modelId, "downloading");
    setModelDownloadProgresses((currentProgresses) => ({
      ...currentProgresses,
      [modelId]: {
        modelId,
        phase: "started",
        fileIndex: 0,
        fileCount: 0,
        filesDownloaded: 0,
        bytesWritten: 0,
        expectedBytes: expectedModelDownloadBytes[modelId],
        totalBytes: 0,
      },
    }));
    try {
      const result = await invoke<ModelDownloadResult>("download_model", {
        modelId,
      });
      await refreshModelStatus(modelId);
      setModelLifecycleStatus(modelId, "downloaded");
      setModelDownloadProgresses((currentProgresses) => {
        const currentProgress = currentProgresses[modelId];
        const fileCount = currentProgress?.fileCount ?? 0;
        return {
          ...currentProgresses,
          [modelId]: {
            ...currentProgress,
            modelId,
            phase: "completed",
            fileIndex: fileCount,
            fileCount,
            filesDownloaded: result.filesDownloaded,
            bytesWritten: result.bytesWritten,
            expectedBytes: expectedModelDownloadBytes[modelId],
            totalBytes: result.bytesWritten,
          },
        };
      });
      setNotice(
        `${copy.onboarding.downloadComplete}: ${result.filesDownloaded} ${copy.onboarding.files}`,
      );
    } catch (error) {
      setModelLifecycleStatus(
        modelId,
        "error",
        error instanceof Error ? error.message : String(error),
      );
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDownloadingModelId(undefined);
    }
  }

  async function deletePiiModel(modelId: Exclude<PiiModelId, "regex">) {
    if (!window.__TAURI_INTERNALS__) {
      setNotice(copy.settings.deleteRequiresApp);
      return;
    }

    setDeletingModelId(modelId);
    setModelLifecycleStatus(modelId, "deleting");
    try {
      const status = await invoke<ModelDownloadStatus>("delete_model", {
        modelId,
      });
      setModelDownloadStatuses((currentStatuses) => ({
        ...currentStatuses,
        [modelId]: status,
      }));
      setModelDownloadProgresses((currentProgresses) => {
        const nextProgresses = { ...currentProgresses };
        delete nextProgresses[modelId];
        return nextProgresses;
      });
      if (defaultModel === modelId) {
        setDefaultModel("regex");
      }
      loadedModelIds.current.delete(modelId);
      setModelLifecycleStatus(modelId, "missing");
      setNotice(`${copy.settings.modelDeleted}: ${status.targetPath}`);
    } catch (error) {
      setModelLifecycleStatus(
        modelId,
        "error",
        error instanceof Error ? error.message : String(error),
      );
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setDeletingModelId(undefined);
    }
  }

  function updateActiveTab(update: Partial<WorkTab>) {
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === activeTab.id ? { ...tab, ...update } : tab,
      ),
    );
  }

  function updateActiveTabWithRedaction(update: Partial<WorkTab>) {
    setTabs((currentTabs) =>
      currentTabs.map((tab) => {
        if (tab.id !== activeTab.id) return tab;

        const nextTab = { ...tab, ...update };
        return {
          ...nextTab,
          output: formatRedactedText({
            input: nextTab.input,
            matches: nextTab.matches,
            selection: nextTab.matchSelection,
            indexFormat: nextTab.indexFormat,
          }),
          restoreOutput: restorePiiText({
            input: nextTab.restoreInput,
            matches: nextTab.matches,
            selection: nextTab.matchSelection,
            indexFormat: nextTab.indexFormat,
          }),
        };
      }),
    );
  }

  function addTab() {
    if (tabs.length === 0) {
      const tab = initialTab(createEntityId("tab"));

      nextTabNumber.current = 2;
      setTabs([tab]);
      setActiveTabId(tab.id);
      return;
    }

    const tabNumber = nextTabNumber.current;
    nextTabNumber.current += 1;
    const tab = initialTab(createEntityId("tab"), `Doc ${tabNumber}`);

    setTabs((currentTabs) => [...currentTabs, tab]);
    setActiveTabId(tab.id);
  }

  function selectShortcutTab(tabNumber: number) {
    setActiveTabId((currentTabId) => {
      const targetIndex = tabNumber === 9 ? tabs.length - 1 : tabNumber - 1;
      return tabs[targetIndex]?.id ?? currentTabId;
    });
  }

  function selectAdjacentTab(direction: -1 | 1) {
    setActiveTabId((currentTabId) => {
      const currentIndex = tabs.findIndex((tab) => tab.id === currentTabId);
      if (currentIndex < 0) return tabs[0]?.id ?? currentTabId;

      const targetIndex = (currentIndex + direction + tabs.length) % tabs.length;
      return tabs[targetIndex]?.id ?? currentTabId;
    });
  }

  function openTaskHistoryTab(task: PiiTaskRecord) {
    const openTab = tabs.find((tab) => tab.id === task.tabId);
    if (openTab) {
      setActiveTabId(openTab.id);
      setIsTaskHistoryOpen(false);
      if (routePath !== "/") navigate("/");
      return;
    }

    const closedTab = closedTabs.find((tab) => tab.id === task.tabId);
    if (!closedTab) return;

    setTabs((currentTabs) =>
      currentTabs.some((tab) => tab.id === closedTab.id)
        ? currentTabs
        : currentTabs.concat(closedTab),
    );
    setClosedTabs((currentTabs) =>
      currentTabs.filter((tab) => tab.id !== closedTab.id),
    );
    setActiveTabId(closedTab.id);
    setIsTaskHistoryOpen(false);
    if (routePath !== "/") navigate("/");
  }

  function closeTab(tabId: string) {
    const closingTab = tabs.find((tab) => tab.id === tabId);
    if (!closingTab) return;

    setEditingTabId((currentEditingTabId) =>
      currentEditingTabId === tabId ? undefined : currentEditingTabId,
    );
    setClosedTabs((currentTabs) => [
      closingTab,
      ...currentTabs.filter((tab) => tab.id !== tabId),
    ]);
    setTabs((currentTabs) => {
      if (!currentTabs.some((tab) => tab.id === tabId)) return currentTabs;

      if (currentTabs.length === 1) {
        const replacementTab = initialTab(createEntityId("tab"));

        nextTabNumber.current = 2;
        setActiveTabId(replacementTab.id);
        return [replacementTab];
      }

      const closingIndex = currentTabs.findIndex((tab) => tab.id === tabId);
      const nextTabs = currentTabs.filter((tab) => tab.id !== tabId);

      if (activeTabId === tabId) {
        const nextActiveTab =
          nextTabs[Math.min(closingIndex, nextTabs.length - 1)];
        setActiveTabId(nextActiveTab.id);
      }

      return nextTabs;
    });
  }

  function setTabMode(mode: PiiWorkflowMode) {
    // Entering pii→text defaults the restore input to the latest redacted
    // output for text/markdown tabs, so the round trip needs no manual copy.
    if (
      mode === "pii-to-text" &&
      (activeTab.documentKind === "text" ||
        activeTab.documentKind === "markdown") &&
      !activeTab.restoreInput &&
      activeTab.output
    ) {
      updateActiveTab({
        mode,
        restoreInput: activeTab.output,
        restoreOutput: "",
      });
      return;
    }

    updateActiveTab({ mode });
  }

  function switchTabMode() {
    setTabMode(activeTab.mode === "text-to-pii" ? "pii-to-text" : "text-to-pii");
  }

  function startEditingTab(tab: WorkTab) {
    setEditingTabId(tab.id);
    setEditingTabTitle(tab.title);
  }

  function saveEditingTab(title = editingTabTitle) {
    if (!editingTabId) return;

    const nextTitle = title.trim();
    if (nextTitle) {
      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.id === editingTabId ? { ...tab, title: nextTitle } : tab,
        ),
      );
    }

    setEditingTabId(undefined);
    setEditingTabTitle("");
  }

  function cancelEditingTab() {
    setEditingTabId(undefined);
    setEditingTabTitle("");
  }

  function nextImportedTab(file: ImportedDocument) {
    nextTabNumber.current += 1;

    return importedTab(file, createEntityId("tab"));
  }

  function queueFilterTasks(tabsToFilter: WorkTab[]) {
    const filterableTabs = tabsToFilter.filter((tab) => tab.input.trim());
    if (filterableTabs.length === 0) return;

    const filterableTabIds = new Set(filterableTabs.map((tab) => tab.id));
    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        filterableTabIds.has(tab.id)
          ? {
              ...tab,
              output: "",
              matches: [],
              matchSelection: {},
            }
          : tab,
      ),
    );

    const tasks = filterableTabs.flatMap((tab) => {
      const chunks = piiTextChunksForTab(tab);
      const taskChunks =
        chunks && chunks.length > 0
          ? chunks
          : [{ start: 0, end: tab.input.length }];

      return taskChunks.map((chunk, chunkIndex) => {
        const taskNumber = nextTaskNumber.current;
        nextTaskNumber.current += 1;

        return createPiiTask({
          id: `${createEntityId("pii-task")}-${taskNumber}`,
          tabId: tab.id,
          tabTitle: tab.title,
          backend: piiBackend,
          customRules,
          indexFormat: tab.indexFormat,
          input: tab.input.slice(chunk.start, chunk.end),
          chunk: {
            ...chunk,
            index: chunkIndex,
            total: taskChunks.length,
          },
        });
      });
    });

    setPiiTasks((currentTasks) => currentTasks.concat(tasks));
    setTaskHistoryPage(1);
  }

  function queueImportedPdfFilters(tabsToFilter: WorkTab[]) {
    queueFilterTasks(tabsToFilter.filter((tab) => tab.documentKind === "pdf"));
  }

  function queueDocuments(documents: ImportedDocument[]) {
    if (documents.length === 0) return;

    setPendingDocuments(documents);
  }

  function openRuleDialog() {
    setCustomRuleName(copy.settings.custom);
    setRuleDialogView("manual");
    setAiRulePurpose("");
    setAiRuleExamples("");
    setIsRuleDialogOpen(true);
  }

  async function handleDroppedPaths(paths: string[]) {
    const supportedPaths = paths.filter((path) =>
      isSupportedImportFileName(fileNameFromPath(path)),
    );
    const unsupportedCount = paths.length - supportedPaths.length;

    if (unsupportedCount > 0) {
      setNotice(`${unsupportedCount} ${copy.notices.unsupportedIgnored}`);
    }

    if (supportedPaths.length === 0) return;

    const documents: ImportedDocument[] = [];
    for (const path of supportedPaths) {
      try {
        documents.push(await readImportedPath(path));
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }
    }

    queueDocuments(documents);
  }

  async function handleBrowserFileDrop(files: FileList | null) {
    if (!files || files.length === 0) return;

    const allFiles = Array.from(files);
    const supportedFiles = allFiles.filter((file) =>
      isSupportedImportFileName(file.name),
    );
    const unsupportedCount = allFiles.length - supportedFiles.length;

    if (unsupportedCount > 0) {
      setNotice(`${unsupportedCount} ${copy.notices.unsupportedIgnored}`);
    }

    queueDocuments(
      await Promise.all(
        supportedFiles.map((file) => readBrowserImportFile(file)),
      ),
    );
  }

  async function openDocumentImportDialog() {
    if (window.__TAURI_INTERNALS__) {
      try {
        const selectedPaths = await open({
          title: copy.dialogs.importDocument,
          multiple: true,
          filters: [
            {
              name: "Markdown",
              extensions: ["md", "markdown"],
            },
            {
              name: "PDF",
              extensions: ["pdf"],
            },
          ],
        });

        const paths = Array.isArray(selectedPaths)
          ? selectedPaths
          : selectedPaths
            ? [selectedPaths]
            : [];

        await handleDroppedPaths(paths);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      }

      return;
    }

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".md,.markdown,text/markdown,.pdf,application/pdf";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    fileInput.addEventListener(
      "change",
      () => {
        void handleBrowserFileDrop(fileInput.files).finally(() => {
          fileInput.remove();
        });
      },
      { once: true },
    );

    document.body.appendChild(fileInput);
    fileInput.click();
  }

  async function readImportedPath(path: string): Promise<ImportedDocument> {
    const importedFile = await invoke<TauriImportedFile>("read_import_file", {
      path,
    });

    if (importedFile.kind === "pdf") {
      const dataBase64 = importedFile.dataBase64 ?? "";
      const pdfDocument = await createPdfDocumentData({
        fileName: importedFile.fileName,
        dataBase64,
      });

      return {
        path: importedFile.path,
        fileName: importedFile.fileName,
        kind: "pdf",
        contents: pdfDocument.text,
        pdfDocument,
      };
    }

    return {
      path: importedFile.path,
      fileName: importedFile.fileName,
      kind: "markdown",
      contents: importedFile.contents ?? "",
    };
  }

  async function readBrowserImportFile(file: File): Promise<ImportedDocument> {
    if (isPdfFileName(file.name)) {
      const dataBase64 = arrayBufferToBase64(await file.arrayBuffer());
      const pdfDocument = await createPdfDocumentData({
        fileName: file.name,
        dataBase64,
      });

      return {
        fileName: file.name,
        kind: "pdf",
        contents: pdfDocument.text,
        pdfDocument,
      };
    }

    return {
      fileName: file.name,
      kind: "markdown",
      contents: await file.text(),
    };
  }

  function importDocuments(mode: DocumentImportMode) {
    if (pendingDocuments.length === 0) return;

    let importedTabs: WorkTab[] = [];

    if (mode === "current") {
      const [firstFile, ...remainingFiles] = pendingDocuments;
      const updatedActiveTab: WorkTab = {
        ...activeTab,
        title: firstFile.fileName,
        documentKind: firstFile.kind,
        input: firstFile.contents,
        output: "",
        matches: [],
        matchSelection: {},
        indexFormat: "number" as const,
        mode: "text-to-pii" as const,
        restoreInput: "",
        restoreOutput: "",
        pdfDocument: firstFile.pdfDocument,
      };
      const newTabs = remainingFiles.map((file) => nextImportedTab(file));
      importedTabs = [updatedActiveTab, ...newTabs];

      setTabs((currentTabs) =>
        currentTabs
          .map((tab) =>
            tab.id === activeTab.id ? updatedActiveTab : tab,
          )
          .concat(newTabs),
      );

      if (newTabs.length > 0) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
    } else {
      const newTabs = pendingDocuments.map((file) => nextImportedTab(file));
      importedTabs = newTabs;

      setTabs((currentTabs) => currentTabs.concat(newTabs));
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }

    queueImportedPdfFilters(importedTabs);
    setPendingDocuments([]);
  }

  function runFilter() {
    if (defaultModel !== "regex") {
      const status = modelDownloadStatuses[defaultModel];
      if (!status?.downloaded) {
        setMissingFilterModelId(defaultModel);
        return;
      }
    }

    queueFilterTasks([activeTab]);
  }

  function runConvert() {
    updateActiveTab({
      restoreOutput: restorePiiText({
        input: activeTab.restoreInput,
        matches: activeTab.matches,
        selection: activeTab.matchSelection,
        indexFormat: activeTab.indexFormat,
      }),
    });
  }

  function playPrimaryActionPressEffect() {
    setPrimaryActionPressKey((currentKey) => currentKey + 1);

    if (primaryActionPressTimer.current) {
      window.clearTimeout(primaryActionPressTimer.current);
    }

    primaryActionPressTimer.current = window.setTimeout(() => {
      setPrimaryActionPressKey(0);
    }, 220);
  }

  function runPrimaryAction() {
    playPrimaryActionPressEffect();

    if (activeTab.mode === "pii-to-text") {
      runConvert();
      return;
    }

    runFilter();
  }

  function clearInput() {
    if (activeTab.mode === "pii-to-text") {
      updateActiveTab({
        restoreInput: "",
        restoreOutput: "",
      });
      return;
    }

    updateActiveTab({
      documentKind: "text",
      input: "",
      output: "",
      matches: [],
      matchSelection: {},
      restoreInput: "",
      restoreOutput: "",
      pdfDocument: undefined,
    });
  }

  function clearOutput() {
    if (activeTab.mode === "pii-to-text") {
      updateActiveTab({
        restoreOutput: "",
      });
      return;
    }

    updateActiveTab({
      output: "",
      matches: [],
      matchSelection: {},
      restoreOutput: "",
    });
  }

  function setIndexFormat(indexFormat: PiiIndexFormat) {
    updateActiveTabWithRedaction({
      indexFormat: activeTab.indexFormat === indexFormat ? "none" : indexFormat,
    });
  }

  function togglePiiMatch(matchId: string) {
    updateActiveTabWithRedaction({
      matchSelection: {
        ...activeTab.matchSelection,
        [matchId]: activeTab.matchSelection[matchId] === false,
      },
    });
  }

  function selectAllMatches() {
    updateActiveTabWithRedaction({
      matchSelection: createMatchSelection(activeTab.matches),
    });
  }

  function deselectAllMatches() {
    updateActiveTabWithRedaction({
      matchSelection: activeTab.matches.reduce<PiiMatchSelection>(
        (selection, match) => {
          selection[match.id] = false;
          return selection;
        },
        {},
      ),
    });
  }

  function addCustomRule() {
    const pattern = customRulePattern.trim();
    const name = customRuleName.trim() || copy.settings.custom;
    if (!pattern) return;

    if (customRuleMode === "regex") {
      try {
        new RegExp(pattern);
      } catch {
        setNotice(copy.notices.customRegexInvalid);
        return;
      }
    }

    setCustomRules((currentRules) =>
      currentRules.concat({
        id: `rule-${Date.now()}-${currentRules.length + 1}`,
        name,
        mode: customRuleMode,
        pattern,
      }),
    );
    setCustomRuleName(copy.settings.custom);
    setCustomRulePattern("");
    setCustomRuleMode("exact");
    setIsRuleDialogOpen(false);
  }

  async function copyAiRulePrompt() {
    await copyText(buildAiRulePrompt(aiRulePurpose.trim(), aiRuleExamples));
    setNotice(copy.notices.aiPromptCopied);
  }

  function piiItemIndexLabel(tab: WorkTab, match: PiiMatch) {
    if (tab.indexFormat === "none") return undefined;
    if (tab.matchSelection[match.id] === false) return undefined;

    const index = selectedPiiMatches(tab.matches, tab.matchSelection).findIndex(
      (selectedMatch) => selectedMatch.id === match.id,
    );
    if (index === -1) return undefined;

    return replacementLabel(match.kind, index + 1, tab.indexFormat).slice(1, -1);
  }

  function renderFilteredItem(
    tab: WorkTab,
    match: PiiMatch,
    options: { showBadge?: boolean } = {},
  ) {
    const indexLabel = piiItemIndexLabel(tab, match);
    const showBadge = options.showBadge ?? true;

    return (
      <li
        key={match.id}
        className={cn(
          "cursor-pointer space-y-1 p-3 transition-colors hover:bg-accent/50",
          tab.matchSelection[match.id] === false && "opacity-50",
        )}
        onClick={() => togglePiiMatch(match.id)}
      >
        {showBadge ? (
          <Badge className={piiBadgeClass(match.kind)} variant="outline">
            {piiMatchBadgeLabel(match)}
          </Badge>
        ) : null}
        <p className="break-all font-mono text-xs leading-5">{match.value}</p>
        {indexLabel ? (
          <p className="font-mono text-[11px] text-muted-foreground">
            {indexLabel}
          </p>
        ) : null}
      </li>
    );
  }

  function piiResultPayload({
    task,
    matches,
    matchSelection,
    output,
    completedAt,
  }: {
    task: PiiTaskRecord;
    matches: PiiMatch[];
    matchSelection: PiiMatchSelection;
    output: string;
    completedAt: number;
  }): PiiFilterResultPayload {
    const selectedMatches = selectedPiiMatches(matches, matchSelection);
    const selectedIndexes = new Map(
      selectedMatches.map((match, index) => [match.id, index + 1]),
    );

    return {
      schemaVersion: 1,
      task: {
        id: task.id,
        tabId: task.tabId,
        tabTitle: task.tabTitle,
        backend: task.backend,
        indexFormat: task.indexFormat,
        queuedAt: task.queuedAt,
        startedAt: task.startedAt,
        completedAt,
        durationMs:
          task.startedAt === undefined
            ? undefined
            : Math.max(0, completedAt - task.startedAt),
        inputLength: task.inputLength,
        inputPreview: task.inputPreview,
        matchCount: matches.length,
      },
      filteredTexts: matches.map((match) => {
        const selectedIndex = selectedIndexes.get(match.id);

        return {
          id: match.id,
          kind: match.kind,
          value: match.value,
          start: match.start,
          end: match.end,
          selected: selectedIndex !== undefined,
          replacement:
            selectedIndex === undefined
              ? undefined
              : replacementLabel(match.kind, selectedIndex, task.indexFormat),
        };
      }),
      redactedText: output,
    };
  }

  async function copyPanelText(target: CopyTarget, text: string) {
    if (!text) return;

    await copyText(text);
    setCopiedTarget(target);

    if (copiedResetTimer.current) {
      window.clearTimeout(copiedResetTimer.current);
    }

    copiedResetTimer.current = window.setTimeout(() => {
      setCopiedTarget(undefined);
    }, 1200);
  }

  async function downloadPanelText(target: CopyTarget, tab: WorkTab) {
    const text = panelText(target, tab);
    if (!text) return;

    if (target === "output" && tab.mode === "text-to-pii" && tab.pdfDocument) {
      await downloadRedactedPdf(tab);
      return;
    }

    const defaultFileName = defaultPanelFileName(target, tab);

    if (!window.__TAURI_INTERNALS__) {
      downloadTextInBrowser(defaultFileName, text);
      setNotice(`${copy.notices.downloaded} ${defaultFileName}.`);
      return;
    }

    const targetPath = await save({
      title: panelDownloadTitle(target, copy),
      defaultPath: defaultFileName,
      filters: [
        {
          name: "Text",
          extensions: ["txt"],
        },
        {
          name: "Markdown",
          extensions: ["md"],
        },
      ],
    });

    if (!targetPath) return;

    try {
      await invoke("write_output_file_path", {
        targetPath,
        text,
      });
      setNotice(`${copy.notices.saved} ${fileNameFromPath(targetPath)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  async function downloadRedactedPdf(tab: WorkTab) {
    if (!tab.pdfDocument) return;

    try {
      const defaultFileName = defaultRedactedPdfFileName(tab);

      const redactionOptions = {
        removeText: pdfRedactionStyleHas(pdfRedactionStyle, "remove-text"),
        addBlackBox: pdfRedactionStyleHas(pdfRedactionStyle, "black-box"),
      };

      if (!window.__TAURI_INTERNALS__) {
        const bytes = await createRedactedPdfBytes({
          document: tab.pdfDocument,
          matches: tab.matches,
          selection: tab.matchSelection,
          ...redactionOptions,
        });

        downloadBytesInBrowser(defaultFileName, bytes, "application/pdf");
        setNotice(`${copy.notices.downloaded} ${defaultFileName}.`);
        return;
      }

      const targetPath = await save({
        title: copy.workbench.saveOutput,
        defaultPath: defaultFileName,
        filters: [
          {
            name: "PDF",
            extensions: ["pdf"],
          },
        ],
      });

      if (!targetPath) return;

      const bytes = await createRedactedPdfBytes({
        document: tab.pdfDocument,
        matches: tab.matches,
        selection: tab.matchSelection,
        ...redactionOptions,
      });

      await invoke("write_binary_file_path", {
        targetPath,
        dataBase64: bytesToBase64(bytes),
      });
      setNotice(`${copy.notices.saved} ${fileNameFromPath(targetPath)}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function beginColumnResize(
    divider: ResizeDivider,
    event: PointerEvent<HTMLDivElement>,
  ) {
    const containerWidth = event.currentTarget.parentElement?.clientWidth ?? 0;
    if (containerWidth <= 0) return;

    event.preventDefault();

    const startX = event.clientX;
    const startSizes = columnSizes;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const minInput = minColumnPercent(
      minimumColumnWidths.input,
      containerWidth,
    );
    const minActions = minColumnPercent(
      minimumColumnWidths.actions,
      containerWidth,
    );
    const minOutput = minColumnPercent(
      minimumColumnWidths.output,
      containerWidth,
    );

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const delta = ((moveEvent.clientX - startX) / containerWidth) * 100;

      setColumnSizes(() => {
        if (divider === "input-actions") {
          const pairTotal = startSizes.input + startSizes.actions;
          const input = clamp(
            startSizes.input + delta,
            minInput,
            pairTotal - minActions,
          );

          return {
            input,
            actions: pairTotal - input,
            output: startSizes.output,
          };
        }

        const pairTotal = startSizes.actions + startSizes.output;
        const actions = clamp(
          startSizes.actions + delta,
          minActions,
          pairTotal - minOutput,
        );

        return {
          input: startSizes.input,
          actions,
          output: pairTotal - actions,
        };
      });
    }

    function handlePointerUp() {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function nudgeColumnResize(
    divider: ResizeDivider,
    event: KeyboardEvent<HTMLDivElement>,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;

    const containerWidth = event.currentTarget.parentElement?.clientWidth ?? 0;
    if (containerWidth <= 0) return;

    event.preventDefault();

    const delta = event.key === "ArrowRight" ? 2 : -2;
    const minInput = minColumnPercent(
      minimumColumnWidths.input,
      containerWidth,
    );
    const minActions = minColumnPercent(
      minimumColumnWidths.actions,
      containerWidth,
    );
    const minOutput = minColumnPercent(
      minimumColumnWidths.output,
      containerWidth,
    );

    setColumnSizes((currentSizes) => {
      if (divider === "input-actions") {
        const pairTotal = currentSizes.input + currentSizes.actions;
        const input = clamp(
          currentSizes.input + delta,
          minInput,
          pairTotal - minActions,
        );

        return {
          input,
          actions: pairTotal - input,
          output: currentSizes.output,
        };
      }

      const pairTotal = currentSizes.actions + currentSizes.output;
      const actions = clamp(
        currentSizes.actions + delta,
        minActions,
        pairTotal - minOutput,
      );

      return {
        input: currentSizes.input,
        actions,
        output: pairTotal - actions,
      };
    });
  }

  const { isDraggingFiles } = useTauriFileDrop({
    onDrop: handleDroppedPaths,
  });

  const taskPage = useMemo(
    () => paginateTaskHistory(piiTasks, taskHistoryPage, 5),
    [piiTasks, taskHistoryPage],
  );
  const activeTasks = activeTaskCount(piiTasks);

  function tabHasActiveTask(tabId: string) {
    return piiTasks.some(
      (task) =>
        task.tabId === tabId &&
        (task.status === "queued" || task.status === "running"),
    );
  }

  const missingFilterModelStatus = missingFilterModelId
    ? modelDownloadStatuses[missingFilterModelId]
    : undefined;
  const missingFilterModelProgress = missingFilterModelId
    ? modelDownloadProgresses[missingFilterModelId]
    : undefined;
  const isMissingFilterModelDownloading =
    missingFilterModelId !== undefined && downloadingModelId === missingFilterModelId;
  const newTabShortcutLabel = shortcutLabel("new-tab");
  const filterShortcutLabel = shortcutLabel("filter");
  const switchModeShortcutLabel = shortcutLabel("switch-mode");
  const settingsShortcutLabel = shortcutLabel("open-settings");

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem("pii-gui-theme", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem("pii-gui-language", language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem("pii-gui-default-model", defaultModel);
  }, [defaultModel]);

  useEffect(() => {
    window.localStorage.setItem(
      "pii-gui-pdf-redaction-style",
      pdfRedactionStyle,
    );
  }, [pdfRedactionStyle]);

  useEffect(() => {
    let isDisposed = false;

    void loadAppMetadata()
      .then((metadata) => {
        if (!isDisposed) {
          setAppMetadata(metadata);
        }
      })
      .catch((error) => {
        if (!isDisposed) {
          setPersistenceNotice(copy.notices.failedLoadAppMetadata, error);
        }
      });

    return () => {
      isDisposed = true;
    };
  }, []);

  useEffect(() => {
    downloadModelIds().forEach((modelId) => {
      void refreshModelStatus(modelId).catch((error) =>
        setPersistenceNotice(copy.notices.failedLoadModelStatus, error),
      );
    });
  }, []);

  useEffect(() => {
    if (!window.__TAURI_INTERNALS__) return;

    let unlisten: (() => void) | undefined;
    let isDisposed = false;

    void listen<ModelDownloadProgress>("model-download-progress", (event) => {
      const progress = event.payload;
      if (!isDownloadModelId(progress.modelId)) return;
      const modelId = progress.modelId;

      setModelDownloadProgresses((currentProgresses) => ({
        ...currentProgresses,
        [modelId]: progress,
      }));
      setModelDownloadStatuses((currentStatuses) => {
        const currentStatus = currentStatuses[modelId];
        if (!currentStatus) return currentStatuses;

        return {
          ...currentStatuses,
          [modelId]: {
            ...currentStatus,
            downloaded: progress.phase === "completed" || currentStatus.downloaded,
            totalBytes: Math.max(currentStatus.totalBytes, progress.totalBytes),
          },
        };
      });
      setDownloadingModelId(
        progress.phase === "completed" ? undefined : modelId,
      );
      setModelLifecycleStatus(
        modelId,
        progress.phase === "completed" ? "downloaded" : "downloading",
      );
    })
      .then((unsubscribe) => {
        if (isDisposed) {
          unsubscribe();
          return;
        }
        unlisten = unsubscribe;
      })
      .catch((error) =>
        setPersistenceNotice(copy.notices.failedLoadModelStatus, error),
      );

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    downloadModelIds().forEach((modelId) => {
      if (downloadingModelId === modelId) return;
      void refreshModelStatus(modelId).catch((error) =>
        setPersistenceNotice(copy.notices.failedLoadModelStatus, error),
      );
    });
  }, [routePath]);

  useEffect(() => {
    function handlePopState() {
      setRoutePath(routePathFromLocation());
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Align the URL with the first-launch onboarding redirect.
  useEffect(() => {
    if (routePath === routePathFromLocation()) return;

    window.history.replaceState({}, "", routePath);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    void initAppPersistence({
      seedTabs: tabs,
      seedCustomRules: defaultCustomRules,
    })
      .then((snapshot) => {
        if (isCancelled) return;

        if (snapshot) {
          if (snapshot.tabs.length > 0) {
            setTabs(snapshot.tabs);
            setActiveTabId(snapshot.tabs[0].id);
            nextTabNumber.current =
              snapshot.tabs.length + snapshot.closedTabs.length + 1;
          }
          setClosedTabs(snapshot.closedTabs);
          setCustomRules(snapshot.customRules);
          setPiiTasks(snapshot.piiTasks);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setPersistenceNotice(copy.notices.failedLoadState, error);
        }
      })
      .finally(() => {
        if (!isCancelled) setIsPersistenceReady(true);
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isPersistenceReady) return undefined;

    const timer = window.setTimeout(() => {
      void persistTabs(tabs, closedTabs).catch((error) =>
        setPersistenceNotice(copy.notices.failedSaveTabs, error),
      );
    }, 300);

    return () => window.clearTimeout(timer);
  }, [closedTabs, isPersistenceReady, tabs]);

  useEffect(() => {
    if (!isPersistenceReady) return;

    void persistCustomRules(customRules).catch((error) =>
      setPersistenceNotice(copy.notices.failedSaveRules, error),
    );
  }, [customRules, isPersistenceReady]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      const action = matchAppShortcut(event);
      if (!action) return;
      if (action === "close-tab" && routePath !== "/") return;

      event.preventDefault();

      if (typeof action === "object") {
        selectShortcutTab(action.tabNumber);
        return;
      }

      if (action === "new-tab") {
        addTab();
        return;
      }

      if (action === "close-tab") {
        closeTab(activeTabId);
        return;
      }

      if (action === "previous-tab") {
        selectAdjacentTab(-1);
        return;
      }

      if (action === "next-tab") {
        selectAdjacentTab(1);
        return;
      }

      if (action === "switch-mode") {
        if (routePath !== "/") return;
        switchTabMode();
        return;
      }

      if (action === "filter") {
        if (routePath !== "/") return;
        runPrimaryAction();
        return;
      }

      if (action === "open-settings") {
        navigate("/settings");
        return;
      }

      void openDocumentImportDialog();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  useEffect(() => {
    const runningTask = piiTasks.find((task) => task.status === "running");

    if (!runningTask) {
      if (piiTasks.some((task) => task.status === "queued")) {
        setPiiTasks((currentTasks) => startNextQueuedTask(currentTasks));
      }
      return;
    }

    if (runningTaskId.current === runningTask.id) return;

    runningTaskId.current = runningTask.id;

    const taskModelId = backendToModelId(runningTask.backend);
    const downloadableTaskModelId =
      taskModelId === "regex" ? undefined : taskModelId;
    const chunkMessage = runningTask.chunk
      ? copy.settings.chunkProgress
          .replace("{current}", String(runningTask.chunk.index + 1))
          .replace("{total}", String(runningTask.chunk.total))
      : undefined;

    if (downloadableTaskModelId) {
      setModelLifecycleStatus(
        downloadableTaskModelId,
        loadedModelIds.current.has(downloadableTaskModelId)
          ? "inferencing"
          : "loading",
        chunkMessage,
      );
    }

    void redactText(runningTask.input, runningTask.backend)
      .then(async (result) => {
        const chunkOffset = runningTask.chunk?.start ?? 0;
        const chunkMatches = mergePiiMatches([
          ...offsetPiiMatches(
            result.matches,
            chunkOffset,
            `${runningTask.id}-model`,
          ),
          ...offsetPiiMatches(
            applyCustomRules(runningTask.input, runningTask.customRules),
            chunkOffset,
            `${runningTask.id}-custom`,
          ),
        ]);
        const completedAt = Date.now();
        const isFinalChunk =
          !runningTask.chunk ||
          runningTask.chunk.index === runningTask.chunk.total - 1;
        const sourceTab = tabs.find((tab) => tab.id === runningTask.tabId);
        const retainedMatches =
          sourceTab && runningTask.chunk
            ? sourceTab.matches.filter(
                (match) => !matchOverlapsRange(match, runningTask.chunk!),
              )
            : [];
        const completedMatches = mergePiiMatches([
          ...retainedMatches,
          ...chunkMatches,
        ]);
        const completedMatchSelection = createMatchSelection(
          completedMatches,
          sourceTab?.matchSelection,
        );
        const completedOutput = formatRedactedText({
          input: sourceTab?.input ?? runningTask.input,
          matches: completedMatches,
          selection: completedMatchSelection,
          indexFormat: runningTask.indexFormat,
        });

        setTabs((currentTabs) =>
          currentTabs.map((tab) => {
            if (tab.id !== runningTask.tabId) return tab;

            const retainedMatches = runningTask.chunk
              ? tab.matches.filter(
                  (match) => !matchOverlapsRange(match, runningTask.chunk!),
                )
              : [];
            const matches = mergePiiMatches([...retainedMatches, ...chunkMatches]);
            const matchSelection = createMatchSelection(
              matches,
              tab.matchSelection,
            );
            const output = formatRedactedText({
              input: tab.input,
              matches,
              selection: matchSelection,
              indexFormat: runningTask.indexFormat,
            });

            return {
              ...tab,
              output,
              matches,
              matchSelection,
            };
          }),
        );

        let resultPath: string | undefined;

        if (isFinalChunk) {
          const payload = piiResultPayload({
            task: runningTask,
            matches: completedMatches,
            matchSelection: completedMatchSelection,
            output: completedOutput,
            completedAt,
          });

          try {
            resultPath = await writePiiFilterResultFile({
              tabId: runningTask.tabId,
              completedAt,
              payload,
            });
          } catch (error) {
            setPersistenceNotice(copy.notices.failedSaveRawResult, error);
          }
        }

        if (downloadableTaskModelId) {
          loadedModelIds.current.add(downloadableTaskModelId);
          setModelLifecycleStatus(downloadableTaskModelId, "ready", chunkMessage);
        }

        const categorySummary = piiTaskCategorySummary(chunkMatches);
        const completedTask = completePiiTask({
          tasks: [runningTask],
          taskId: runningTask.id,
          matchCount: chunkMatches.length,
          categorySummary,
          resultPath,
          now: completedAt,
        })[0];

        await persistPiiTaskResult(completedTask).catch((error) =>
          setPersistenceNotice(copy.notices.failedSaveHistory, error),
        );

        setPiiTasks((currentTasks) =>
          completePiiTask({
            tasks: currentTasks,
            taskId: runningTask.id,
            matchCount: chunkMatches.length,
            categorySummary,
            resultPath,
            now: completedAt,
          }),
        );
      })
      .catch((error) => {
        const failedAt = Date.now();
        const failureMessage =
          error instanceof Error ? error.message : String(error);
        if (downloadableTaskModelId) {
          setModelLifecycleStatus(
            downloadableTaskModelId,
            "error",
            failureMessage,
          );
        }
        const failedTask = failPiiTask({
          tasks: [runningTask],
          taskId: runningTask.id,
          error: failureMessage,
          now: failedAt,
        })[0];
        setNotice(`${copy.notices.taskFailed}: ${failureMessage}`);

        void persistPiiTaskResult(failedTask).catch((persistenceError) =>
          setPersistenceNotice(
            copy.notices.failedSaveFailureHistory,
            persistenceError,
          ),
        );

        setPiiTasks((currentTasks) =>
          failPiiTask({
            tasks: currentTasks,
            taskId: runningTask.id,
            error: failureMessage,
            now: failedAt,
          }),
        );
      })
      .finally(() => {
        if (runningTaskId.current === runningTask.id) {
          runningTaskId.current = undefined;
        }
      });
  }, [piiTasks]);

  return (
    <TooltipProvider>
      <main
      className="flex h-screen min-h-screen flex-col overflow-hidden bg-background text-foreground"
      onDragOver={(event) => {
        if (window.__TAURI_INTERNALS__) return;
        event.preventDefault();
      }}
      onDrop={(event) => {
        if (window.__TAURI_INTERNALS__) return;
        event.preventDefault();
        void handleBrowserFileDrop(event.dataTransfer.files);
      }}
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" aria-hidden="true" />
          <h1 className="text-base font-semibold tracking-normal">PII GUI</h1>
          <span className="text-xs font-medium text-muted-foreground">
            {copy.tagline}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="relative size-8"
            aria-label={copy.nav.openTaskHistory}
            title={copy.nav.openTaskHistory}
            onClick={() => {
              setTaskHistoryPage(1);
              setIsTaskHistoryOpen(true);
            }}
          >
            {activeTasks > 0 ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <ListChecks aria-hidden="true" />
            )}
            {activeTasks > 0 ? (
              <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {activeTasks}
              </span>
            ) : null}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                aria-label={copy.nav.openSettings}
                onClick={() => navigate("/settings")}
              >
                <Settings aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <ShortcutTooltipContent shortcut={settingsShortcutLabel}>
              {copy.nav.settings}
            </ShortcutTooltipContent>
          </Tooltip>
        </div>
      </header>

      {routePath === "/settings" ? (
        <SettingsPage
          appMetadata={appMetadata}
          appUpdateError={appUpdater.errorMessage}
          appUpdateProgressLabel={appUpdateProgressLabel}
          appUpdateStatus={appUpdater.status}
          appUpdateVersion={appUpdater.updateAvailable?.version}
          copy={copy}
          customRules={customRules}
          deletingModelId={deletingModelId}
          downloadingModelId={downloadingModelId}
          downloadProgresses={modelDownloadProgresses}
          downloadStatuses={modelDownloadStatuses}
          modelLifecycleStatuses={modelLifecycleStatuses}
          onAddRule={openRuleDialog}
          onBack={() => navigate("/")}
          onCheckAppUpdate={() => {
            void appUpdater.checkForUpdates();
          }}
          onDeleteModel={deletePiiModel}
          onDownloadModel={downloadPiiModel}
          onInstallAppUpdate={() => {
            void appUpdater.downloadAndInstall();
          }}
          onOpenOnboarding={() => navigate("/onboarding")}
          onRefreshModelStatus={(modelId) => {
            void refreshModelStatus(modelId).catch((error) =>
              setPersistenceNotice(copy.notices.failedLoadModelStatus, error),
            );
          }}
          theme={theme}
          onThemeChange={setTheme}
          language={language}
          onLanguageChange={setLanguage}
          pdfRedactionStyle={pdfRedactionStyle}
          onPdfRedactionStyleChange={setPdfRedactionStyle}
        />
      ) : routePath === "/onboarding" ? (
        <OnboardingPage
          copy={copy}
          defaultModel={defaultModel}
          downloadProgresses={modelDownloadProgresses}
          downloadStatuses={modelDownloadStatuses}
          downloadingModelId={downloadingModelId}
          onBack={() => navigate("/settings")}
          onDownloadModel={downloadPiiModel}
          onModelChange={setDefaultModel}
          onOpenWorkbench={() => completeOnboarding("/")}
          onOpenSettings={() => completeOnboarding("/settings")}
          language={language}
          onLanguageChange={setLanguage}
        />
      ) : (
      <Tabs
        value={activeTabId}
        onValueChange={setActiveTabId}
        className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <ScrollArea className="max-w-[calc(100vw-7rem)]">
            <TabsList className="w-max justify-start">
              {tabs.map((tab, index) => {
                const shortcut = tabShortcutLabel(index + 1);
                const trigger = (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="group min-w-32 max-w-52 justify-between"
                  >
                    {editingTabId === tab.id ? (
                      <input
                        value={editingTabTitle}
                        autoFocus
                        aria-label={copy.workbench.editTabName}
                        className="h-6 min-w-0 flex-1 rounded-sm border bg-background px-2 text-sm outline-none ring-1 ring-ring"
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          setEditingTabTitle(event.currentTarget.value)
                        }
                        onBlur={(event) =>
                          saveEditingTab(event.currentTarget.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveEditingTab(event.currentTarget.value);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelEditingTab();
                          }
                        }}
                      />
                    ) : (
                      <>
                        <span className="min-w-0 truncate">{tab.title}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`${copy.workbench.editTabName}: ${tab.title}`}
                          title={copy.workbench.editTabName}
                          className="ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover:opacity-100 focus:opacity-100"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            startEditingTab(tab);
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              startEditingTab(tab);
                            }
                          }}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`${copy.workbench.closeTab}: ${tab.title}`}
                          title={copy.workbench.closeTab}
                          className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground group-hover:opacity-100 focus:opacity-100"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            closeTab(tab.id);
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              event.stopPropagation();
                              closeTab(tab.id);
                            }
                          }}
                        >
                          <X className="size-3.5" aria-hidden="true" />
                        </span>
                      </>
                    )}
                  </TabsTrigger>
                );

                if (!shortcut) return trigger;

                return (
                  <Tooltip key={tab.id}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex h-full">{trigger}</span>
                    </TooltipTrigger>
                    <ShortcutTooltipContent shortcut={shortcut}>
                      {copy.workbench.switchTo} {tab.title}
                    </ShortcutTooltipContent>
                  </Tooltip>
                );
              })}
            </TabsList>
          </ScrollArea>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label={`${copy.workbench.addTab} (${newTabShortcutLabel})`}
                onClick={addTab}
              >
                <Plus aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <ShortcutTooltipContent shortcut={newTabShortcutLabel}>
              {copy.workbench.addTab}
            </ShortcutTooltipContent>
          </Tooltip>
        </div>

        {tabs.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            className="m-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
          >
            <section
              className="grid h-full min-h-0 w-full grid-cols-none gap-0 overflow-hidden p-4"
              style={{
                gridTemplateColumns: `${columnSizes.input}fr 0.75rem ${columnSizes.actions}fr 0.75rem ${columnSizes.output}fr`,
              }}
            >
              <div
                className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden pr-2"
                style={{ minWidth: minimumColumnWidths.input }}
              >
                <div className="flex h-8 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium">
                      {copy.workbench.input}
                    </h2>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={copy.workbench.clearInput}
                          disabled={!panelText("input", tab)}
                          onClick={clearInput}
                        >
                          <RotateCcw aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.workbench.clearInput}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={copy.workbench.copyInput}
                          disabled={!panelText("input", tab)}
                          onClick={() =>
                            void copyPanelText("input", panelText("input", tab))
                          }
                        >
                          {copiedTarget === "input" ? (
                            <Check
                              className="animate-in zoom-in-75 fade-in text-primary"
                              aria-hidden="true"
                            />
                          ) : (
                            <Copy aria-hidden="true" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.workbench.copyInput}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={copy.workbench.saveInput}
                          disabled={!panelText("input", tab)}
                          onClick={() => void downloadPanelText("input", tab)}
                        >
                          <Download aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.workbench.saveInput}</TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {textStats(panelText("input", tab), tab.matches, copy)}
                  </span>
                </div>
                {tab.mode === "text-to-pii" && tab.pdfDocument ? (
                  <PdfPreview
                    document={tab.pdfDocument}
                    matches={tab.matches}
                    selection={tab.matchSelection}
                    mode="input"
                  />
                ) : (
                  <HighlightedTextarea
                    value={panelText("input", tab)}
                    matches={tab.matches}
                    selection={tab.matchSelection}
                    indexFormat={tab.indexFormat}
                    view="input"
                    workflow={tab.mode}
                    onChange={(event) => {
                      if (tab.mode === "pii-to-text") {
                        updateActiveTab({
                          restoreInput: event.currentTarget.value,
                          restoreOutput: "",
                        });
                        return;
                      }

                      updateActiveTab({
                        input: event.currentTarget.value,
                        output: "",
                        matches: [],
                        matchSelection: {},
                        restoreInput: "",
                        restoreOutput: "",
                      });
                    }}
                    placeholder={
                      tab.mode === "pii-to-text"
                        ? copy.workbench.pasteAiResponse
                        : copy.workbench.pasteText
                    }
                    copy={copy}
                  />
                )}
              </div>

              <ColumnResizeHandle
                label={copy.workbench.resizeInputActions}
                onKeyDown={(event) =>
                  nudgeColumnResize("input-actions", event)
                }
                onPointerDown={(event) =>
                  beginColumnResize("input-actions", event)
                }
              />

              <aside
                className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden px-2"
                style={{ minWidth: minimumColumnWidths.actions }}
              >
                <div className="flex h-8 items-center justify-between gap-2">
                  <h2 className="truncate text-sm font-medium">
                    {tab.mode === "pii-to-text"
                      ? copy.workbench.piiToText
                      : copy.workbench.textToPii}
                  </h2>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        aria-label={copy.workbench.switchMode}
                        onClick={switchTabMode}
                      >
                        <ArrowLeftRight aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <ShortcutTooltipContent shortcut={switchModeShortcutLabel}>
                      {copy.workbench.switchMode}
                    </ShortcutTooltipContent>
                  </Tooltip>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted p-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={tab.mode === "text-to-pii" ? "default" : "ghost"}
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => setTabMode("text-to-pii")}
                      >
                        {copy.workbench.textToPii}
                      </Button>
                    </TooltipTrigger>
                    <ShortcutTooltipContent shortcut={switchModeShortcutLabel}>
                      {copy.workbench.switchMode}
                    </ShortcutTooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={tab.mode === "pii-to-text" ? "default" : "ghost"}
                        size="sm"
                        className="h-8 px-2 text-xs"
                        onClick={() => setTabMode("pii-to-text")}
                      >
                        {copy.workbench.piiToText}
                      </Button>
                    </TooltipTrigger>
                    <ShortcutTooltipContent shortcut={switchModeShortcutLabel}>
                      {copy.workbench.switchMode}
                    </ShortcutTooltipContent>
                  </Tooltip>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      key={`${tab.id}-${tab.mode}-${primaryActionPressKey}`}
                      type="button"
                      onClick={runPrimaryAction}
                      className={cn(
                        "w-full active:scale-[0.98] active:shadow-inner",
                        primaryActionPressKey > 0 && "primary-action-press",
                      )}
                    >
                      {tab.mode === "pii-to-text"
                        ? copy.workbench.convert
                        : copy.workbench.filter}
                    </Button>
                  </TooltipTrigger>
                  <ShortcutTooltipContent shortcut={filterShortcutLabel}>
                    {tab.mode === "pii-to-text"
                      ? copy.workbench.restoreOriginalPii
                      : defaultModel === "openai-privacy-filter"
                        ? copy.workbench.runOnnxFilter
                        : defaultModel === "bardsai-eu-pii"
                          ? copy.workbench.runBardsAiFilter
                        : copy.workbench.runRegexFilter}
                  </ShortcutTooltipContent>
                </Tooltip>
                {tab.mode === "text-to-pii" ? (
                  <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted p-1">
                    <Button
                      type="button"
                      variant={defaultModel === "regex" ? "default" : "ghost"}
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setDefaultModel("regex")}
                    >
                      {copy.workbench.regexBackend}
                    </Button>
                    <Button
                      type="button"
                      variant={
                        defaultModel === "openai-privacy-filter"
                          ? "default"
                          : "ghost"
                      }
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setDefaultModel("openai-privacy-filter")}
                    >
                      {copy.workbench.openAiBackend}
                    </Button>
                    <Button
                      type="button"
                      variant={
                        defaultModel === "bardsai-eu-pii" ? "default" : "ghost"
                      }
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setDefaultModel("bardsai-eu-pii")}
                    >
                      {copy.workbench.bardsAiBackend}
                    </Button>
                  </div>
                ) : null}
                <div className="flex min-h-0 w-full flex-1 flex-col gap-2 overflow-hidden">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium">
                        {copy.workbench.filteredItems}
                      </h3>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={copy.workbench.addCustomPiiRule}
                            onClick={openRuleDialog}
                          >
                            <Plus aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {copy.workbench.addCustomPiiRule}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="secondary">
                        {selectedPiiMatches(tab.matches, tab.matchSelection)
                          .length}
                        /{tab.matches.length}
                      </Badge>
                      {tab.matches.length > 0 ? (
                        <div
                          className="flex rounded-md border bg-muted p-0.5"
                          aria-label={copy.workbench.filteredItemsViewMode}
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant={
                                  filteredItemsViewMode === "list"
                                    ? "secondary"
                                    : "ghost"
                                }
                                size="icon"
                                className={cn(
                                  "size-7",
                                  filteredItemsViewMode === "list" &&
                                    "border border-border bg-background text-foreground shadow-sm ring-1 ring-ring/20 hover:bg-background",
                                )}
                                aria-label={copy.workbench.showList}
                                onClick={() => setFilteredItemsViewMode("list")}
                              >
                                <List aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {copy.workbench.listView}
                            </TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant={
                                  filteredItemsViewMode === "category"
                                    ? "secondary"
                                    : "ghost"
                                }
                                size="icon"
                                className={cn(
                                  "size-7",
                                  filteredItemsViewMode === "category" &&
                                    "border border-border bg-background text-foreground shadow-sm ring-1 ring-ring/20 hover:bg-background",
                                )}
                                aria-label={copy.workbench.groupByCategory}
                                onClick={() =>
                                  setFilteredItemsViewMode("category")
                                }
                              >
                                <FolderTree aria-hidden="true" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {copy.workbench.groupByCategory}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {tab.matches.length > 0 ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-muted-foreground">
                          {copy.workbench.redactWith}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIndexFormat("number")}
                          aria-label={copy.workbench.redactWithNumber}
                        >
                          <Badge
                            variant={
                              tab.indexFormat === "number"
                                ? "default"
                                : "outline"
                            }
                            className="cursor-pointer"
                          >
                            [number]
                          </Badge>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIndexFormat("id")}
                          aria-label={copy.workbench.redactWithId}
                        >
                          <Badge
                            variant={
                              tab.indexFormat === "id" ? "default" : "outline"
                            }
                            className="cursor-pointer"
                          >
                            [id]
                          </Badge>
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={selectAllMatches}
                        >
                          {copy.workbench.selectAll}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={deselectAllMatches}
                        >
                          {copy.workbench.deselectAll}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  <ScrollArea className="min-h-0 w-full flex-1 overflow-hidden rounded-md border bg-card">
                    {tab.matches.length > 0 ? (
                      filteredItemsViewMode === "list" ? (
                        <ul className="w-full divide-y">
                          {tab.matches.map((match) =>
                            renderFilteredItem(tab, match),
                          )}
                        </ul>
                      ) : (
                        <div className="w-full divide-y">
                          {groupMatchesByCategory(tab.matches).map((group) => {
                            const firstMatch = group.matches[0];

                            return (
                              <Collapsible
                                key={group.category}
                                defaultOpen
                                className="group/collapsible"
                              >
                                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/50">
                                  <span className="flex min-w-0 flex-col gap-1">
                                    <Badge
                                      className={piiBadgeClass(
                                        firstMatch?.kind ?? group.category,
                                      )}
                                      variant="outline"
                                    >
                                      {firstMatch
                                        ? piiMatchBadgeLabel(firstMatch)
                                        : piiKindDisplayLabel(group.category)}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                      {group.wordCount}{" "}
                                      {copy.workbench.filtered}{" "}
                                      {copy.workbench.word}
                                    </span>
                                  </span>
                                  <ChevronDown
                                    className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-180"
                                    aria-hidden="true"
                                  />
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <ul className="divide-y border-t">
                                    {group.matches.map((match) =>
                                      renderFilteredItem(tab, match, {
                                        showBadge: false,
                                      }),
                                    )}
                                  </ul>
                                </CollapsibleContent>
                              </Collapsible>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-sm text-muted-foreground">
                        {copy.workbench.noItems}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </aside>

              <ColumnResizeHandle
                label={copy.workbench.resizeActionsOutput}
                onKeyDown={(event) =>
                  nudgeColumnResize("actions-output", event)
                }
                onPointerDown={(event) =>
                  beginColumnResize("actions-output", event)
                }
              />

              <div
                className="flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden pl-2"
                style={{ minWidth: minimumColumnWidths.output }}
              >
                <div className="flex h-8 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-medium">
                      {copy.workbench.output}
                    </h2>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={copy.workbench.clearOutput}
                          disabled={!panelText("output", tab)}
                          onClick={clearOutput}
                        >
                          <RotateCcw aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.workbench.clearOutput}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={copy.workbench.copyOutput}
                          disabled={!panelText("output", tab)}
                          onClick={() =>
                            void copyPanelText("output", panelText("output", tab))
                          }
                        >
                          {copiedTarget === "output" ? (
                            <Check
                              className="animate-in zoom-in-75 fade-in text-primary"
                              aria-hidden="true"
                            />
                          ) : (
                            <Copy aria-hidden="true" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.workbench.copyOutput}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={copy.workbench.saveOutput}
                          disabled={!panelText("output", tab)}
                          onClick={() => void downloadPanelText("output", tab)}
                        >
                          <Download aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copy.workbench.saveOutput}</TooltipContent>
                    </Tooltip>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {textStats(panelText("output", tab), tab.matches, copy)}
                  </span>
                </div>
                <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  {tab.mode === "text-to-pii" && tab.pdfDocument ? (
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                      <PdfPreview
                        document={tab.pdfDocument}
                        matches={tab.matches}
                        selection={tab.matchSelection}
                        mode="output"
                        className={cn(
                          "min-h-0",
                          panelText("output", tab) ? "flex-[2]" : "flex-1",
                        )}
                      />
                      {panelText("output", tab) ? (
                        <HighlightedTextarea
                          value={panelText("output", tab)}
                          sourceText={tab.input}
                          matches={tab.matches}
                          selection={tab.matchSelection}
                          indexFormat={tab.indexFormat}
                          view="output"
                          readOnly
                          placeholder={copy.workbench.filteredText}
                          className="min-h-40 flex-[1]"
                          copy={copy}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <HighlightedTextarea
                      value={panelText("output", tab)}
                      sourceText={
                        tab.mode === "pii-to-text"
                          ? tab.restoreInput
                          : tab.input
                      }
                      matches={tab.matches}
                      selection={tab.matchSelection}
                      indexFormat={tab.indexFormat}
                      view="output"
                      workflow={tab.mode}
                      readOnly
                      placeholder={
                        tab.mode === "pii-to-text"
                          ? copy.workbench.restoredText
                          : copy.workbench.filteredText
                      }
                      copy={copy}
                    />
                  )}
                  {tabHasActiveTask(tab.id) ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="absolute inset-0 z-30 flex items-center justify-center rounded-md bg-background/70 backdrop-blur-sm"
                    >
                      <div className="flex items-center gap-2 rounded-md border bg-card px-4 py-3 text-sm font-medium shadow-lg">
                        <LoaderCircle
                          className="animate-spin"
                          aria-hidden="true"
                        />
                        {copy.workbench.filteringInProgress}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          </TabsContent>
        ))}
      </Tabs>
      )}

      {isDraggingFiles ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-4 border-primary/70 bg-background/80 backdrop-blur-sm">
          <div className="rounded-md border bg-card px-5 py-3 text-sm font-medium shadow-lg">
            {copy.workbench.dropDocuments}
          </div>
        </div>
      ) : null}

      {notice ? (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 max-w-sm rounded-md border bg-card px-4 py-3 text-sm shadow-lg"
        >
          <div className="flex items-start gap-3">
            <span className="text-muted-foreground">{notice}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() => setNotice(undefined)}
            >
              {copy.dialogs.dismiss}
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={pendingDocuments.length > 0}
        onOpenChange={(open) => {
          if (!open) setPendingDocuments([]);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.dialogs.importDocument}</DialogTitle>
            <DialogDescription>
              {pendingDocuments.length === 1
                ? pendingDocuments[0].fileName
                : `${pendingDocuments.length} ${copy.dialogs.documents}`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => importDocuments("current")}
            >
              {copy.dialogs.useCurrentTab}
            </Button>
            <Button type="button" onClick={() => importDocuments("new")}>
              {copy.dialogs.newTab}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={missingFilterModelId !== undefined}
        onOpenChange={(open) => {
          if (!open) setMissingFilterModelId(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{copy.dialogs.modelDownloadRequired}</DialogTitle>
            <DialogDescription>
              {copy.dialogs.modelDownloadRequiredDescription}
            </DialogDescription>
          </DialogHeader>
          {missingFilterModelId ? (
            <div className="space-y-3">
              <div className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-medium">
                    {modelName(missingFilterModelId, copy)}
                  </h3>
                  <Badge
                    variant={
                      missingFilterModelStatus?.downloaded ? "secondary" : "outline"
                    }
                  >
                    {missingFilterModelStatus?.downloaded
                      ? copy.onboarding.downloaded
                      : copy.onboarding.notDownloaded}
                  </Badge>
                  <Badge variant="outline">
                    {formatFileSize(
                      missingFilterModelStatus &&
                        missingFilterModelStatus.totalBytes > 0
                        ? missingFilterModelStatus.totalBytes
                        : expectedModelDownloadBytes[missingFilterModelId],
                    )}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {modelDescription(missingFilterModelId, copy)}
                </p>
                {isMissingFilterModelDownloading && missingFilterModelProgress ? (
                  <div className="mt-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>{copy.settings.downloadProgress}</span>
                      <span>
                        {modelDownloadProgressLabel(
                          missingFilterModelId,
                          missingFilterModelProgress,
                          copy,
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${modelDownloadProgressPercent(
                            missingFilterModelId,
                            missingFilterModelProgress,
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
              {missingFilterModelStatus?.downloaded ? (
                <p className="text-xs text-muted-foreground">
                  {copy.dialogs.modelDownloadReady}
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMissingFilterModelId(undefined)}
            >
              {copy.dialogs.cancel}
            </Button>
            {missingFilterModelId && missingFilterModelStatus?.downloaded ? (
              <Button
                type="button"
                onClick={() => {
                  setMissingFilterModelId(undefined);
                  queueFilterTasks([activeTab]);
                }}
              >
                {copy.dialogs.runFilter}
              </Button>
            ) : missingFilterModelId ? (
              <Button
                type="button"
                disabled={isMissingFilterModelDownloading}
                onClick={() => void downloadPiiModel(missingFilterModelId)}
              >
                {isMissingFilterModelDownloading ? (
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                ) : (
                  <Download aria-hidden="true" />
                )}
                {copy.onboarding.download}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRuleDialogOpen} onOpenChange={setIsRuleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {ruleDialogView === "manual"
                ? copy.dialogs.addPiiRule
                : copy.dialogs.createRuleWithAi}
            </DialogTitle>
            <DialogDescription>
              {ruleDialogView === "manual"
                ? copy.dialogs.addPiiRuleDescription
                : ruleDialogView === "aiPurpose"
                  ? copy.dialogs.createRuleWithAiDescription
                  : copy.dialogs.aiPromptDescription}
            </DialogDescription>
          </DialogHeader>
          {ruleDialogView === "manual" ? (
          <div className="space-y-4">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setRuleDialogView("aiPurpose")}
            >
              <Sparkles aria-hidden="true" />
              {copy.dialogs.createWithAi}
            </Button>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="custom-rule-name">
                {copy.dialogs.label}
              </label>
              <input
                id="custom-rule-name"
                value={customRuleName}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onChange={(event) =>
                  setCustomRuleName(event.currentTarget.value)
                }
              />
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">
                {copy.dialogs.matchType}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={customRuleMode === "exact" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCustomRuleMode("exact")}
                >
                  {copy.dialogs.exact}
                </Button>
                <Button
                  type="button"
                  variant={customRuleMode === "regex" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCustomRuleMode("regex")}
                >
                  {copy.dialogs.regex}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor="custom-rule-pattern"
              >
                {copy.dialogs.pattern}
              </label>
              <input
                id="custom-rule-pattern"
                value={customRulePattern}
                className="h-9 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={
                  customRuleMode === "exact"
                    ? "Internal Project"
                    : "PROJECT-[0-9]+"
                }
                onChange={(event) =>
                  setCustomRulePattern(event.currentTarget.value)
                }
              />
            </div>
            {customRules.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {customRules.map((rule) => (
                  <Badge key={rule.id} variant="secondary">
                    {rule.name}: {rule.mode}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
          ) : ruleDialogView === "aiPurpose" ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="ai-rule-purpose">
                {copy.dialogs.purpose}
              </label>
              <input
                id="ai-rule-purpose"
                value={aiRulePurpose}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={copy.dialogs.purposePlaceholder}
                onChange={(event) =>
                  setAiRulePurpose(event.currentTarget.value)
                }
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="ai-rule-examples">
                {copy.dialogs.purposeExamples}
              </label>
              <Textarea
                id="ai-rule-examples"
                value={aiRuleExamples}
                className="min-h-24 font-mono text-sm"
                placeholder={copy.dialogs.purposeExamplesPlaceholder}
                onChange={(event) =>
                  setAiRuleExamples(event.currentTarget.value)
                }
              />
            </div>
          </div>
          ) : (
          <Textarea
            readOnly
            aria-label={copy.dialogs.createRuleWithAi}
            value={buildAiRulePrompt(aiRulePurpose.trim(), aiRuleExamples)}
            className="min-h-56 font-mono text-xs"
          />
          )}
          <DialogFooter>
            {ruleDialogView === "manual" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsRuleDialogOpen(false)}
                >
                  {copy.dialogs.cancel}
                </Button>
                <Button
                  type="button"
                  disabled={!customRulePattern.trim()}
                  onClick={addCustomRule}
                >
                  {copy.dialogs.addRule}
                </Button>
              </>
            ) : ruleDialogView === "aiPurpose" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRuleDialogView("manual")}
                >
                  {copy.dialogs.back}
                </Button>
                <Button
                  type="button"
                  disabled={!aiRulePurpose.trim()}
                  onClick={() => setRuleDialogView("aiPrompt")}
                >
                  {copy.dialogs.generatePrompt}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRuleDialogView("aiPurpose")}
                >
                  {copy.dialogs.back}
                </Button>
                <Button type="button" onClick={() => void copyAiRulePrompt()}>
                  <Copy aria-hidden="true" />
                  {copy.dialogs.copyPrompt}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTaskHistoryOpen} onOpenChange={setIsTaskHistoryOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{copy.dialogs.taskHistory}</DialogTitle>
            <DialogDescription>
              {copy.dialogs.taskHistoryDescription}
            </DialogDescription>
          </DialogHeader>

          {taskPage.totalItems > 0 ? (
            <div className="grid min-h-0 gap-3">
              <ScrollArea className="min-h-0 max-h-[min(24rem,calc(100vh-14rem))] w-full overflow-hidden rounded-md border">
                <ul className="w-full min-w-0 divide-y">
                  {taskPage.items.map((task) => {
                    const taskTabExists = tabs.some((tab) => tab.id === task.tabId);
                    const taskTabIsClosed = closedTabs.some(
                      (tab) => tab.id === task.tabId,
                    );
                    const taskTabIsRestorable = taskTabExists || taskTabIsClosed;

                    return (
                      <li
                        key={task.id}
                        role={taskTabIsRestorable ? "button" : undefined}
                        tabIndex={taskTabIsRestorable ? 0 : undefined}
                        aria-label={
                          taskTabIsRestorable
                            ? `${copy.dialogs.openTaskTab}: ${task.tabTitle}`
                            : undefined
                        }
                        className={cn(
                          "min-w-0 space-y-2 p-3 outline-none transition-colors",
                          taskTabIsRestorable &&
                            "cursor-pointer hover:bg-accent/60 focus-visible:bg-accent/60",
                        )}
                        onClick={() => openTaskHistoryTab(task)}
                        onKeyDown={(event) => {
                          if (!taskTabIsRestorable) return;
                          if (event.key !== "Enter" && event.key !== " ") return;

                          event.preventDefault();
                          openTaskHistoryTab(task);
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {task.tabTitle}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {task.backend.toUpperCase()} ·{" "}
                              {new Date(task.queuedAt).toLocaleTimeString()}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                            {!taskTabIsRestorable ? (
                              <Badge variant="outline">{copy.dialogs.deletedTab}</Badge>
                            ) : null}
                            <Badge
                              variant={
                                task.status === "failed"
                                  ? "destructive"
                                  : task.status === "completed"
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {task.status}
                            </Badge>
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-wrap gap-1.5">
                          {task.categorySummary &&
                          task.categorySummary.length > 0 ? (
                            task.categorySummary.map((category) => (
                              <Badge
                                key={`${task.id}-${category.kind}`}
                                variant="outline"
                                className={cn(
                                  "max-w-full text-[11px]",
                                  piiBadgeClass(category.kind),
                                )}
                              >
                                <span className="truncate">
                                  {piiKindDisplayLabel(category.kind)}
                                </span>
                                <span className="ml-1 font-mono">
                                  {category.count}
                                </span>
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {task.matchCount === 0
                                ? copy.dialogs.noFilteredCategories
                                : copy.dialogs.filteredCategoriesUnavailable}
                            </span>
                          )}
                        </div>
                        <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span className="shrink-0">
                            {task.inputLength} {copy.workbench.chars}
                          </span>
                          {task.matchCount !== undefined ? (
                            <span className="shrink-0">
                              {task.matchCount} {copy.dialogs.matches}
                            </span>
                          ) : null}
                          {task.durationMs !== undefined ? (
                            <span className="shrink-0">{task.durationMs}ms</span>
                          ) : null}
                          {task.error ? (
                            <span className="min-w-0 max-w-full break-words">
                              {task.error}
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {copy.dialogs.page} {taskPage.page} {copy.dialogs.of}{" "}
                  {taskPage.totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label={copy.dialogs.previousTaskHistoryPage}
                    disabled={taskPage.page <= 1}
                    onClick={() =>
                      setTaskHistoryPage((currentPage) => currentPage - 1)
                    }
                  >
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8"
                    aria-label={copy.dialogs.nextTaskHistoryPage}
                    disabled={taskPage.page >= taskPage.totalPages}
                    onClick={() =>
                      setTaskHistoryPage((currentPage) => currentPage + 1)
                    }
                  >
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
              {copy.dialogs.noTasksYet}
            </div>
          )}
        </DialogContent>
      </Dialog>
      </main>
    </TooltipProvider>
  );
}

export default App;
