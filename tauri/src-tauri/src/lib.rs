mod redact_engine;

use base64::{engine::general_purpose, Engine as _};
use redact_engine::{RedactBackend, RedactEngine, RedactResult};
use reqwest::blocking::Client;
use serde::Serialize;
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

#[tauri::command]
async fn redact_text(input: String, backend: RedactBackend) -> Result<RedactResult, String> {
    // Inference is CPU-bound and can take seconds (plus lazy model load on the
    // first call), so run it on the blocking pool to keep the UI responsive.
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let result = RedactEngine::new(backend).redact(&input);
        match &result {
            Ok(result) => log::info!(
                "redact_text done: backend={} input_bytes={} input_chars={} matches={} total_ms={}",
                result.backend,
                input.len(),
                input.chars().count(),
                result.matches.len(),
                started.elapsed().as_millis(),
            ),
            Err(error) => log::warn!(
                "redact_text failed: backend={backend:?} input_bytes={} total_ms={} error={error}",
                input.len(),
                started.elapsed().as_millis(),
            ),
        }
        result
    })
    .await
    .map_err(|error| format!("Redaction task failed to run: {error}"))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MarkdownFile {
    path: String,
    file_name: String,
    contents: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportFile {
    path: String,
    file_name: String,
    kind: String,
    contents: Option<String>,
    data_base64: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileWriteResult {
    target_path: String,
    bytes_written: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PiiResultFile {
    relative_path: String,
    target_path: String,
    bytes_written: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDownloadStatus {
    model_id: String,
    downloaded: bool,
    target_path: String,
    missing_files: Vec<String>,
    total_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDownloadResult {
    model_id: String,
    target_path: String,
    files_downloaded: usize,
    bytes_written: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDownloadProgress {
    model_id: String,
    phase: String,
    file_path: Option<String>,
    file_index: usize,
    file_count: usize,
    files_downloaded: usize,
    bytes_written: u64,
    expected_bytes: u64,
    total_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DownloadModel {
    OpenAiPrivacyFilter,
    BardsAiEuPii,
}

impl DownloadModel {
    fn from_id(model_id: &str) -> Result<Self, String> {
        match model_id {
            "openai-privacy-filter" => Ok(Self::OpenAiPrivacyFilter),
            "bardsai-eu-pii" => Ok(Self::BardsAiEuPii),
            _ => Err(format!("Unsupported model id: {model_id}")),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::OpenAiPrivacyFilter => "openai-privacy-filter",
            Self::BardsAiEuPii => "bardsai-eu-pii",
        }
    }

    fn storage_dir(self) -> &'static str {
        match self {
            Self::OpenAiPrivacyFilter => "openai-privacy-filter",
            Self::BardsAiEuPii => "bardsai-eu-pii-anonimization-multilang",
        }
    }

    fn files(self) -> &'static [ModelFile] {
        match self {
            Self::OpenAiPrivacyFilter => &OPENAI_PRIVACY_FILTER_FILES,
            Self::BardsAiEuPii => &BARDSAI_EU_PII_FILES,
        }
    }

    fn expected_bytes(self) -> u64 {
        match self {
            Self::OpenAiPrivacyFilter => 837_099_555,
            Self::BardsAiEuPii => 295_523_237,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct ModelFile {
    relative_path: &'static str,
    url: &'static str,
}

const OPENAI_PRIVACY_FILTER_FILES: [ModelFile; 6] = [
    ModelFile {
        relative_path: "config.json",
        url: "https://huggingface.co/openai/privacy-filter/resolve/main/config.json",
    },
    ModelFile {
        relative_path: "tokenizer.json",
        url: "https://huggingface.co/openai/privacy-filter/resolve/main/tokenizer.json",
    },
    ModelFile {
        relative_path: "tokenizer_config.json",
        url: "https://huggingface.co/openai/privacy-filter/resolve/main/tokenizer_config.json",
    },
    ModelFile {
        relative_path: "viterbi_calibration.json",
        url: "https://huggingface.co/openai/privacy-filter/resolve/main/viterbi_calibration.json",
    },
    ModelFile {
        relative_path: "onnx/model_q4f16.onnx",
        url: "https://huggingface.co/openai/privacy-filter/resolve/main/onnx/model_q4f16.onnx",
    },
    ModelFile {
        relative_path: "onnx/model_q4f16.onnx_data",
        url: "https://huggingface.co/openai/privacy-filter/resolve/main/onnx/model_q4f16.onnx_data",
    },
];

const BARDSAI_EU_PII_FILES: [ModelFile; 4] = [
    ModelFile {
        relative_path: "config.json",
        url: "https://huggingface.co/bardsai/eu-pii-anonimization-multilang/resolve/main/config.json",
    },
    ModelFile {
        relative_path: "tokenizer.json",
        url: "https://huggingface.co/bardsai/eu-pii-anonimization-multilang/resolve/main/tokenizer.json",
    },
    ModelFile {
        relative_path: "tokenizer_config.json",
        url: "https://huggingface.co/bardsai/eu-pii-anonimization-multilang/resolve/main/tokenizer_config.json",
    },
    ModelFile {
        relative_path: "onnx/model_quantized.onnx",
        url: "https://huggingface.co/bardsai/eu-pii-anonimization-multilang/resolve/main/onnx/model_quantized.onnx",
    },
];

#[tauri::command]
fn read_markdown_file(path: &str) -> Result<MarkdownFile, String> {
    let path_ref = Path::new(path);

    if !is_markdown_path(path_ref) {
        return Err("Only Markdown files are supported.".to_string());
    }

    let contents = fs::read_to_string(path_ref)
        .map_err(|error| format!("Failed to read Markdown file: {error}"))?;
    let file_name = path_ref
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Markdown file")
        .to_string();

    Ok(MarkdownFile {
        path: path.to_string(),
        file_name,
        contents,
    })
}

#[tauri::command]
fn read_import_file(path: &str) -> Result<ImportFile, String> {
    let path_ref = Path::new(path);
    let file_name = path_ref
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Imported file")
        .to_string();

    if is_markdown_path(path_ref) {
        let contents = fs::read_to_string(path_ref)
            .map_err(|error| format!("Failed to read Markdown file: {error}"))?;

        return Ok(ImportFile {
            path: path.to_string(),
            file_name,
            kind: "markdown".to_string(),
            contents: Some(contents),
            data_base64: None,
        });
    }

    if is_pdf_path(path_ref) {
        let bytes =
            fs::read(path_ref).map_err(|error| format!("Failed to read PDF file: {error}"))?;

        return Ok(ImportFile {
            path: path.to_string(),
            file_name,
            kind: "pdf".to_string(),
            contents: None,
            data_base64: Some(general_purpose::STANDARD.encode(bytes)),
        });
    }

    Err("Only Markdown and PDF files are supported.".to_string())
}

#[tauri::command]
fn write_output_file(
    output_directory: &str,
    file_name: &str,
    text: &str,
) -> Result<FileWriteResult, String> {
    write_text_file(output_directory, file_name, text)
}

#[tauri::command]
fn write_output_file_path(target_path: &str, text: &str) -> Result<FileWriteResult, String> {
    write_text_file_path(Path::new(target_path), text)
}

#[tauri::command]
fn model_download_status(
    app: tauri::AppHandle,
    model_id: &str,
) -> Result<ModelDownloadStatus, String> {
    let model = DownloadModel::from_id(model_id)?;
    let model_dir = model_storage_dir(&app, model)?;
    let status = model_status(model, &model_dir);
    if status.downloaded {
        configure_process_model_path(model, &model_dir);
    }
    Ok(status)
}

#[tauri::command]
async fn download_model(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<ModelDownloadResult, String> {
    // Network + disk I/O can run for minutes; keep it off the main thread so
    // the UI stays responsive and progress events can render.
    tauri::async_runtime::spawn_blocking(move || download_model_blocking(&app, &model_id))
        .await
        .map_err(|error| format!("Model download task failed to run: {error}"))?
}

fn download_model_blocking(
    app: &tauri::AppHandle,
    model_id: &str,
) -> Result<ModelDownloadResult, String> {
    let model = DownloadModel::from_id(model_id)?;
    let model_dir = model_storage_dir(app, model)?;
    let started = Instant::now();
    log::info!(
        "model download started: model={} target={}",
        model.id(),
        model_dir.display()
    );
    fs::create_dir_all(&model_dir)
        .map_err(|error| format!("Failed to create model directory: {error}"))?;

    let client = Client::builder()
        .timeout(Duration::from_secs(900))
        .build()
        .map_err(|error| format!("Failed to create download client: {error}"))?;
    let mut files_downloaded = 0;
    let mut bytes_written = 0;
    let expected_bytes = model.expected_bytes();
    emit_model_download_progress(
        app,
        model,
        "started",
        None,
        0,
        files_downloaded,
        bytes_written,
        expected_bytes,
    );

    for (file_index, model_file) in model.files().iter().enumerate() {
        let current_file_index = file_index + 1;
        let target_path = safe_model_file_path(&model_dir, model_file.relative_path)?;
        if target_path.exists() && stored_model_file_is_valid(&client, model_file, &target_path) {
            bytes_written += fs::metadata(&target_path)
                .map(|metadata| metadata.len())
                .unwrap_or(0);
            emit_model_download_progress(
                app,
                model,
                "downloading",
                Some(model_file.relative_path),
                current_file_index,
                files_downloaded,
                bytes_written,
                expected_bytes,
            );
            continue;
        }

        if target_path.exists() {
            log::warn!(
                "stored model file failed verification: model={} file={}",
                model.id(),
                model_file.relative_path
            );
            fs::remove_file(&target_path)
                .map_err(|error| format!("Failed to remove a stored model file: {error}"))?;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create model file directory: {error}"))?;
        }

        let mut response = client
            .get(model_file.url)
            .send()
            .map_err(|error| format!("Failed to download {}: {error}", model_file.relative_path))?
            .error_for_status()
            .map_err(|error| format!("Failed to download {}: {error}", model_file.relative_path))?;
        let expected_hash = response_content_hash(&response);
        let expected_size = response_content_size(&response);
        let temporary_path = target_path.with_extension("download");
        let mut file = fs::File::create(&temporary_path)
            .map_err(|error| format!("Failed to create model download file: {error}"))?;
        let mut hasher = ContentHasher::for_digest(expected_hash.as_deref(), expected_size);
        let mut buffer = [0_u8; 64 * 1024];
        let mut written = 0;
        loop {
            let read = response
                .read(&mut buffer)
                .map_err(|error| format!("Failed to read model file: {error}"))?;
            if read == 0 {
                break;
            }
            file.write_all(&buffer[..read])
                .map_err(|error| format!("Failed to write model file: {error}"))?;
            hasher.update(&buffer[..read]);
            written += read as u64;
            emit_model_download_progress(
                app,
                model,
                "downloading",
                Some(model_file.relative_path),
                current_file_index,
                files_downloaded,
                bytes_written + written,
                expected_bytes,
            );
        }
        if let Some(expected_size) = expected_size {
            if written != expected_size {
                let _ = fs::remove_file(&temporary_path);

                return Err(format!(
                    "Downloaded {} is {written} bytes but {expected_size} bytes were expected.",
                    model_file.relative_path
                ));
            }
        }

        if let (Some(expected_hash), Some(actual_hash)) = (expected_hash, hasher.finish()) {
            if expected_hash != actual_hash {
                let _ = fs::remove_file(&temporary_path);

                return Err(format!(
                    "Checksum mismatch for {}. The downloaded file does not match the hash published by {}.",
                    model_file.relative_path, model_file.url
                ));
            }

            log::info!(
                "model file verified: model={} file={} bytes={written}",
                model.id(),
                model_file.relative_path,
            );
        }

        fs::rename(&temporary_path, &target_path)
            .map_err(|error| format!("Failed to finalize model file: {error}"))?;
        files_downloaded += 1;
        bytes_written += written;
        emit_model_download_progress(
            app,
            model,
            "downloading",
            Some(model_file.relative_path),
            current_file_index,
            files_downloaded,
            bytes_written,
            expected_bytes,
        );
    }

    configure_process_model_path(model, &model_dir);
    emit_model_download_progress(
        app,
        model,
        "completed",
        None,
        model.files().len(),
        files_downloaded,
        bytes_written,
        expected_bytes,
    );
    log::info!(
        "model download completed: model={} files_downloaded={} bytes_written={} total_ms={}",
        model.id(),
        files_downloaded,
        bytes_written,
        started.elapsed().as_millis(),
    );

    Ok(ModelDownloadResult {
        model_id: model.id().to_string(),
        target_path: path_to_string(&model_dir),
        files_downloaded,
        bytes_written,
    })
}

#[tauri::command]
fn delete_model(app: tauri::AppHandle, model_id: &str) -> Result<ModelDownloadStatus, String> {
    let model = DownloadModel::from_id(model_id)?;
    let model_dir = model_storage_dir(&app, model)?;

    if model_dir.exists() {
        fs::remove_dir_all(&model_dir)
            .map_err(|error| format!("Failed to delete model checkpoint: {error}"))?;
    }

    clear_process_model_path(model, &model_dir);
    log::info!(
        "model deleted: model={} target={}",
        model.id(),
        model_dir.display()
    );
    Ok(model_status(model, &model_dir))
}

fn configure_process_model_path(model: DownloadModel, model_dir: &Path) {
    match model {
        DownloadModel::OpenAiPrivacyFilter => env::set_var("PRIVACY_FILTER_MODEL_DIR", model_dir),
        DownloadModel::BardsAiEuPii => env::set_var("BARDSAI_PII_MODEL_DIR", model_dir),
    }
}

fn clear_process_model_path(model: DownloadModel, model_dir: &Path) {
    let env_key = match model {
        DownloadModel::OpenAiPrivacyFilter => "PRIVACY_FILTER_MODEL_DIR",
        DownloadModel::BardsAiEuPii => "BARDSAI_PII_MODEL_DIR",
    };

    if env::var_os(env_key).is_some_and(|value| PathBuf::from(value) == model_dir) {
        env::remove_var(env_key);
    }
}

#[tauri::command]
fn write_binary_file_path(target_path: &str, data_base64: &str) -> Result<FileWriteResult, String> {
    let bytes = general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|error| format!("Failed to decode output file: {error}"))?;

    write_binary_file_path_inner(Path::new(target_path), &bytes)
}

#[tauri::command]
fn write_pii_filter_result(
    app: tauri::AppHandle,
    tab_id: &str,
    file_name: &str,
    contents: &str,
) -> Result<PiiResultFile, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    write_pii_filter_result_file(&app_data_dir, tab_id, file_name, contents)
}

/// The content digest published for a model file, normalised to lowercase hex
/// without quotes. Hugging Face publishes the content SHA-256 for files it
/// stores with Xet or LFS, and the git blob SHA-1 for small plain git files.
fn response_content_hash(response: &reqwest::blocking::Response) -> Option<String> {
    let linked = response
        .headers()
        .get("x-linked-etag")
        .and_then(|value| value.to_str().ok())
        .map(normalize_hash_value)
        .filter(|value| value.len() == SHA256_HEX_LEN);

    if linked.is_some() {
        return linked;
    }

    response
        .headers()
        .get("etag")
        .and_then(|value| value.to_str().ok())
        .map(normalize_hash_value)
        .filter(|value| value.len() == SHA1_HEX_LEN)
}

fn response_content_size(response: &reqwest::blocking::Response) -> Option<u64> {
    response
        .headers()
        .get("x-linked-size")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| response.content_length())
}

const SHA1_HEX_LEN: usize = 40;
const SHA256_HEX_LEN: usize = 64;

fn normalize_hash_value(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("W/")
        .trim_matches('"')
        .to_ascii_lowercase()
}

fn hex_digest(bytes: &[u8]) -> String {
    let mut digest = String::with_capacity(bytes.len() * 2);

    for byte in bytes {
        digest.push_str(&format!("{byte:02x}"));
    }

    digest
}

/// Hashes bytes the way the published digest is computed: a plain content
/// SHA-256, or a git blob SHA-1 that folds in the file length.
enum ContentHasher {
    Sha256(Sha256),
    GitBlobSha1 { hasher: Sha1, header: Vec<u8> },
    None,
}

impl ContentHasher {
    fn for_digest(digest: Option<&str>, size: Option<u64>) -> Self {
        match (digest.map(str::len), size) {
            (Some(SHA256_HEX_LEN), _) => Self::Sha256(Sha256::new()),
            (Some(SHA1_HEX_LEN), Some(size)) => Self::GitBlobSha1 {
                hasher: Sha1::new(),
                header: format!("blob {size}\0").into_bytes(),
            },
            _ => Self::None,
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        match self {
            Self::Sha256(hasher) => {
                hasher.update(bytes);
            }
#[derive(Serialize)]
struct StoredDataDeletion {
    removed_files: usize,
    target_path: String,
}

/// Deletes stored document and PII result files. The paths are built from the
/// app data directory only, so this can never reach outside it.
#[tauri::command]
fn delete_local_pii_data(
    app: tauri::AppHandle,
    tab_id: Option<String>,
) -> Result<StoredDataDeletion, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let target_path = match tab_id.as_deref() {
        Some(tab_id) => {
            if !is_safe_path_segment(tab_id) {
                return Err("Tab id is invalid.".to_string());
            }

            app_data_dir.join("tabs").join(tab_id)
        }
        None => app_data_dir.join("tabs"),
    };

    if !target_path.starts_with(&app_data_dir) {
        return Err("Stored data path is outside the app data directory.".to_string());
    }

    let removed_files = count_stored_files(&target_path)?;

    if target_path.exists() {
        fs::remove_dir_all(&target_path)
            .map_err(|error| format!("Failed to delete stored data: {error}"))?;
    }

    Ok(StoredDataDeletion {
        removed_files,
        target_path: path_to_string(&target_path),
    })
}

fn count_stored_files(directory: &Path) -> Result<usize, String> {
    if !directory.is_dir() {
        return Ok(0);
    }

    let entries = fs::read_dir(directory)
        .map_err(|error| format!("Failed to read stored data: {error}"))?;
    let mut count = 0;

    for entry in entries {
        let entry = entry.map_err(|error| format!("Failed to read stored data: {error}"))?;
        let path = entry.path();

        if path.is_dir() {
            count += count_stored_files(&path)?;
        } else {
            count += 1;
        }
    }

    Ok(count)
}

fn model_storage_dir(app: &tauri::AppHandle, model: DownloadModel) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    Ok(model_checkpoint_dir(&app_data_dir, model))
}

fn model_checkpoint_dir(app_data_dir: &Path, model: DownloadModel) -> PathBuf {
    app_data_dir.join("checkpoints").join(model.storage_dir())
}

fn model_status(model: DownloadModel, model_dir: &Path) -> ModelDownloadStatus {
    let mut missing_files = Vec::new();
    let mut total_bytes = 0;

    for model_file in model.files() {
        let Ok(path) = safe_model_file_path(model_dir, model_file.relative_path) else {
            missing_files.push(model_file.relative_path.to_string());
            continue;
        };

        match fs::metadata(path) {
            Ok(metadata) => total_bytes += metadata.len(),
            Err(_) => missing_files.push(model_file.relative_path.to_string()),
        }
    }

    ModelDownloadStatus {
        model_id: model.id().to_string(),
        downloaded: missing_files.is_empty(),
        target_path: path_to_string(model_dir),
        missing_files,
        total_bytes,
    }
}

fn emit_model_download_progress(
    app: &tauri::AppHandle,
    model: DownloadModel,
    phase: &str,
    file_path: Option<&str>,
    file_index: usize,
    files_downloaded: usize,
    bytes_written: u64,
    expected_bytes: u64,
) {
    let progress = ModelDownloadProgress {
        model_id: model.id().to_string(),
        phase: phase.to_string(),
        file_path: file_path.map(str::to_string),
        file_index,
        file_count: model.files().len(),
        files_downloaded,
        bytes_written,
        expected_bytes,
        total_bytes: bytes_written,
    };
    let _ = app.emit("model-download-progress", progress);
}

fn safe_model_file_path(model_dir: &Path, relative_path: &str) -> Result<PathBuf, String> {
    if relative_path.is_empty() {
        return Err("Model file path is invalid.".to_string());
    }

    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Model file path must stay inside the model directory.".to_string());
    }

    Ok(model_dir.join(relative))
}

fn write_text_file(
    output_directory: &str,
    file_name: &str,
    text: &str,
) -> Result<FileWriteResult, String> {
    if file_name.trim().is_empty() || file_name.contains('/') || file_name.contains('\\') {
        return Err("File name is invalid.".to_string());
    }

    let output_directory = Path::new(output_directory);
    fs::create_dir_all(output_directory)
        .map_err(|error| format!("Failed to create output directory: {error}"))?;

    let target_path = output_directory.join(file_name);
    write_text_file_path(&target_path, text)
}

fn write_text_file_path(target_path: &Path, text: &str) -> Result<FileWriteResult, String> {
    write_binary_file_path_inner(target_path, text.as_bytes())
}

fn write_binary_file_path_inner(
    target_path: &Path,
    bytes: &[u8],
) -> Result<FileWriteResult, String> {
    if target_path.as_os_str().is_empty() {
        return Err("Output path is invalid.".to_string());
    }

    if let Some(parent) = target_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create output directory: {error}"))?;
    }

    fs::write(target_path, bytes)
        .map_err(|error| format!("Failed to write output file: {error}"))?;

    Ok(FileWriteResult {
        target_path: path_to_string(target_path),
        bytes_written: bytes.len(),
    })
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "md" | "markdown"))
        .unwrap_or(false)
}

fn is_pdf_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn write_pii_filter_result_file(
    app_data_dir: &Path,
    tab_id: &str,
    file_name: &str,
    contents: &str,
) -> Result<PiiResultFile, String> {
    if !is_safe_path_segment(tab_id) {
        return Err("Tab id is invalid.".to_string());
    }

    if !is_safe_result_file_name(file_name) {
        return Err("Result file name is invalid.".to_string());
    }

    let relative_path = PathBuf::from("tabs")
        .join(tab_id)
        .join("results")
        .join(file_name);
    let target_path = app_data_dir.join(&relative_path);

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create result directory: {error}"))?;
    }

    fs::write(&target_path, contents)
        .map_err(|error| format!("Failed to write PII result file: {error}"))?;

    Ok(PiiResultFile {
        relative_path: format!("tabs/{tab_id}/results/{file_name}"),
        target_path: path_to_string(&target_path),
        bytes_written: contents.len(),
    })
}

fn is_safe_path_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
}

fn is_safe_result_file_name(file_name: &str) -> bool {
    file_name.ends_with(".json") && is_safe_path_segment(file_name.trim_end_matches(".json"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            redact_text,
            download_model,
            delete_model,
            model_download_status,
            read_import_file,
            read_markdown_file,
            write_output_file,
            write_output_file_path,
            write_binary_file_path,
            write_pii_filter_result,
            delete_local_pii_data
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{
        clear_process_model_path, is_markdown_path, is_pdf_path, model_checkpoint_dir,
        write_binary_file_path_inner, write_pii_filter_result_file, write_text_file,
        write_text_file_path, DownloadModel,
    };
    use std::{
        fs,
        path::Path,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn recognizes_supported_markdown_extensions() {
        assert!(is_markdown_path(Path::new("notes.md")));
        assert!(is_markdown_path(Path::new("notes.MARKDOWN")));
    }

    #[test]
    fn recognizes_supported_pdf_extension() {
        assert!(is_pdf_path(Path::new("report.pdf")));
        assert!(is_pdf_path(Path::new("report.PDF")));
    }

    #[test]
    fn rejects_non_markdown_extensions() {
        assert!(!is_markdown_path(Path::new("notes.txt")));
        assert!(!is_markdown_path(Path::new("notes")));
        assert!(!is_pdf_path(Path::new("notes.txt")));
    }

    #[test]
    fn writes_output_file() {
        let output_directory = std::env::temp_dir().join(format!(
            "pii-gui-output-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));

        let result = write_text_file(
            output_directory
                .to_str()
                .expect("temporary path should be valid utf-8"),
            "redacted.txt",
            "hello",
        )
        .expect("file should write");

        assert_eq!(result.bytes_written, 5);
        assert_eq!(
            fs::read_to_string(output_directory.join("redacted.txt")).unwrap(),
            "hello"
        );

        let _ = fs::remove_dir_all(output_directory);
    }

    #[test]
    fn writes_output_file_from_exact_target_path() {
        let output_directory = std::env::temp_dir().join(format!(
            "pii-gui-output-path-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let target_path = output_directory.join("nested").join("redacted.md");

        let result = write_text_file_path(&target_path, "hello").expect("file should write");

        assert_eq!(result.bytes_written, 5);
        assert_eq!(fs::read_to_string(&target_path).unwrap(), "hello");
        assert_eq!(Path::new(&result.target_path), target_path.as_path());

        let _ = fs::remove_dir_all(output_directory);
    }

    #[test]
    fn writes_binary_output_file_from_exact_target_path() {
        let output_directory = std::env::temp_dir().join(format!(
            "pii-gui-binary-output-path-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));
        let target_path = output_directory.join("nested").join("redacted.pdf");
        let bytes = [0x25, 0x50, 0x44, 0x46, 0x00, 0xff];

        let result = write_binary_file_path_inner(&target_path, &bytes).expect("file should write");

        assert_eq!(result.bytes_written, bytes.len());
        assert_eq!(fs::read(&target_path).unwrap(), bytes);
        assert_eq!(Path::new(&result.target_path), target_path.as_path());

        let _ = fs::remove_dir_all(output_directory);
    }

    #[test]
    fn rejects_nested_output_file_names() {
        assert!(write_text_file(".", "../redacted.txt", "hello").is_err());
        assert!(write_text_file(".", "nested/redacted.txt", "hello").is_err());
    }

    #[test]
    fn stores_model_checkpoints_under_app_data_dir() {
        let app_data_dir = Path::new("/tmp/pii-gui-app-data");

        assert_eq!(
            model_checkpoint_dir(app_data_dir, DownloadModel::OpenAiPrivacyFilter),
            app_data_dir
                .join("checkpoints")
                .join("openai-privacy-filter")
        );
        assert_eq!(
            model_checkpoint_dir(app_data_dir, DownloadModel::BardsAiEuPii),
            app_data_dir
                .join("checkpoints")
                .join("bardsai-eu-pii-anonimization-multilang")
        );
    }

    #[test]
    fn clears_model_env_only_when_it_matches_deleted_checkpoint() {
        let model_dir =
            Path::new("/tmp/pii-gui-app-data/checkpoints/bardsai-eu-pii-anonimization-multilang");
        let other_dir = Path::new("/tmp/other-checkpoint");

        std::env::set_var("BARDSAI_PII_MODEL_DIR", model_dir);
        clear_process_model_path(DownloadModel::BardsAiEuPii, model_dir);
        assert!(std::env::var_os("BARDSAI_PII_MODEL_DIR").is_none());

        std::env::set_var("BARDSAI_PII_MODEL_DIR", other_dir);
        clear_process_model_path(DownloadModel::BardsAiEuPii, model_dir);
        assert_eq!(
            std::env::var_os("BARDSAI_PII_MODEL_DIR").map(std::path::PathBuf::from),
            Some(other_dir.to_path_buf())
        );
        std::env::remove_var("BARDSAI_PII_MODEL_DIR");
    }

    #[test]
    fn writes_pii_result_file_under_tab_results() {
        let app_data_dir = std::env::temp_dir().join(format!(
            "pii-gui-result-test-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after unix epoch")
                .as_nanos()
        ));

        let result = write_pii_filter_result_file(
            &app_data_dir,
            "tab-123",
            "2026-01-01T00-00-00-000Z.json",
            "{\"matches\":[]}",
        )
        .expect("result file should write");

        assert_eq!(
            result.relative_path,
            "tabs/tab-123/results/2026-01-01T00-00-00-000Z.json"
        );
        assert_eq!(result.bytes_written, 14);
        assert_eq!(
            fs::read_to_string(
                app_data_dir
                    .join("tabs")
                    .join("tab-123")
                    .join("results")
                    .join("2026-01-01T00-00-00-000Z.json")
            )
            .unwrap(),
            "{\"matches\":[]}"
        );

        let _ = fs::remove_dir_all(app_data_dir);
    }

    #[test]
    fn rejects_unsafe_pii_result_paths() {
        let app_data_dir = std::env::temp_dir();

        assert!(write_pii_filter_result_file(&app_data_dir, "../tab", "safe.json", "{}").is_err());
        assert!(
            write_pii_filter_result_file(&app_data_dir, "tab-1", "../unsafe.json", "{}").is_err()
        );
    }
}
