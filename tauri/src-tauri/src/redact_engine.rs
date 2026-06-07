use ndarray::Ix3;
use ort::{
    session::{builder::GraphOptimizationLevel, Session},
    value::TensorRef,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::Instant,
};
use tokenizers::Tokenizer;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RedactBackend {
    Regex,
    Onnx,
    BardsAi,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedactMatch {
    pub id: String,
    pub kind: String,
    pub value: String,
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RedactResult {
    pub backend: String,
    pub redacted_text: String,
    pub matches: Vec<RedactMatch>,
}

pub struct RedactEngine {
    redactor: Box<dyn PiiRedactor>,
}

impl RedactEngine {
    pub fn new(backend: RedactBackend) -> Self {
        let redactor: Box<dyn PiiRedactor> = match backend {
            RedactBackend::Regex => Box::new(RegexRedactor::new()),
            RedactBackend::Onnx => Box::new(PrivacyFilterOnnxRedactor::from_environment()),
            RedactBackend::BardsAi => Box::new(BardsAiOnnxRedactor::from_environment()),
        };

        Self { redactor }
    }

    #[cfg(test)]
    fn with_redactor(redactor: Box<dyn PiiRedactor>) -> Self {
        Self { redactor }
    }

    pub fn redact(&self, input: &str) -> Result<RedactResult, String> {
        self.redactor.redact(input)
    }
}

trait PiiRedactor: Send + Sync {
    fn redact(&self, input: &str) -> Result<RedactResult, String>;
}

struct RegexRedactor {
    email: Regex,
    phone: Regex,
    url: Regex,
    date: Regex,
    secret: Regex,
}

impl RegexRedactor {
    fn new() -> Self {
        Self {
            email: Regex::new(r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b")
                .expect("email regex must compile"),
            phone: Regex::new(r"(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}")
                .expect("phone regex must compile"),
            url: Regex::new(r#"(?i)\b(?:https?://|www\.)[A-Z0-9._~:/?#\[\]@!$&'()*+,;=%-]*[A-Z0-9/#]"#)
                .expect("url regex must compile"),
            date: Regex::new(
                r"(?ix)\b(?:
                    \d{4}-\d{2}-\d{2}
                    |
                    \d{1,2}/\d{1,2}/\d{2,4}
                    |
                    (?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}
                )\b",
            )
            .expect("date regex must compile"),
            secret: Regex::new(r"\bsk_[A-Za-z0-9_]{12,}\b")
                .expect("secret regex must compile"),
        }
    }

    fn redact_sync(&self, input: &str) -> RedactResult {
        let mut matches = self.collect_matches(input);
        matches.sort_by_key(|pii_match| pii_match.start);

        RedactResult {
            backend: "regex".to_string(),
            redacted_text: redact_spans(input, &matches),
            matches,
        }
    }

    fn collect_matches(&self, input: &str) -> Vec<RedactMatch> {
        let mut matches = Vec::new();

        for (index, pii_match) in self.email.find_iter(input).enumerate() {
            matches.push(RedactMatch {
                id: format!("private-email-{}-{index}", pii_match.start()),
                kind: "private_email".to_string(),
                value: pii_match.as_str().to_string(),
                start: pii_match.start(),
                end: pii_match.end(),
            });
        }

        for (index, pii_match) in self.phone.find_iter(input).enumerate() {
            matches.push(RedactMatch {
                id: format!("private-phone-{}-{index}", pii_match.start()),
                kind: "private_phone".to_string(),
                value: pii_match.as_str().to_string(),
                start: pii_match.start(),
                end: pii_match.end(),
            });
        }

        for (index, pii_match) in self.url.find_iter(input).enumerate() {
            matches.push(RedactMatch {
                id: format!("private-url-{}-{index}", pii_match.start()),
                kind: "private_url".to_string(),
                value: pii_match.as_str().to_string(),
                start: pii_match.start(),
                end: pii_match.end(),
            });
        }

        for (index, pii_match) in self.date.find_iter(input).enumerate() {
            matches.push(RedactMatch {
                id: format!("private-date-{}-{index}", pii_match.start()),
                kind: "private_date".to_string(),
                value: pii_match.as_str().to_string(),
                start: pii_match.start(),
                end: pii_match.end(),
            });
        }

        for (index, pii_match) in self.secret.find_iter(input).enumerate() {
            matches.push(RedactMatch {
                id: format!("secret-{}-{index}", pii_match.start()),
                kind: "secret".to_string(),
                value: pii_match.as_str().to_string(),
                start: pii_match.start(),
                end: pii_match.end(),
            });
        }

        matches
    }
}

impl PiiRedactor for RegexRedactor {
    fn redact(&self, input: &str) -> Result<RedactResult, String> {
        Ok(self.redact_sync(input))
    }
}

struct PrivacyFilterOnnxRedactor {
    runner: Box<dyn PrivacyFilterRunner>,
}

impl PrivacyFilterOnnxRedactor {
    fn from_environment() -> Self {
        Self {
            runner: Box::new(LazyOnnxRunner::from_environment()),
        }
    }

    #[cfg(test)]
    fn from_runner(runner: Box<dyn PrivacyFilterRunner>) -> Self {
        Self { runner }
    }
}

impl PiiRedactor for PrivacyFilterOnnxRedactor {
    fn redact(&self, input: &str) -> Result<RedactResult, String> {
        let tokenized_logits = self.runner.infer(input)?;
        let decoded_labels = decode_bioes_labels(&tokenized_logits.logits);
        let mut matches =
            matches_from_token_labels(input, &tokenized_logits.token_offsets, &decoded_labels);
        matches.sort_by_key(|pii_match| pii_match.start);

        Ok(RedactResult {
            backend: "onnx".to_string(),
            redacted_text: redact_spans(input, &matches),
            matches,
        })
    }
}

trait PrivacyFilterRunner: Send + Sync {
    fn infer(&self, input: &str) -> Result<TokenizedLogits, String>;
}

struct LazyOnnxRunner {
    model_dir: Result<PathBuf, String>,
}

impl LazyOnnxRunner {
    fn from_environment() -> Self {
        Self {
            model_dir: privacy_filter_model_dir(),
        }
    }

    fn runtime(&self) -> Result<&Mutex<Option<PrivacyFilterRuntime>>, String> {
        static PRIVACY_FILTER_RUNTIME: OnceLock<Mutex<Option<PrivacyFilterRuntime>>> =
            OnceLock::new();

        let runtime = PRIVACY_FILTER_RUNTIME.get_or_init(|| Mutex::new(None));
        let mut guard = runtime
            .lock()
            .map_err(|_| "Privacy Filter ONNX runtime lock was poisoned.".to_string())?;

        if guard.is_none() {
            let model_dir = self.model_dir.as_ref().map_err(Clone::clone)?;
            *guard = Some(PrivacyFilterRuntime::new(model_dir)?);
        }

        drop(guard);
        Ok(runtime)
    }
}

impl PrivacyFilterRunner for LazyOnnxRunner {
    fn infer(&self, input: &str) -> Result<TokenizedLogits, String> {
        let runtime = self.runtime()?;
        let mut runtime = runtime
            .lock()
            .map_err(|_| "Privacy Filter ONNX runtime lock was poisoned.".to_string())?;
        let runtime = runtime
            .as_mut()
            .ok_or_else(|| "Privacy Filter ONNX runtime was not initialized.".to_string())?;

        runtime.infer(input)
    }
}

struct PrivacyFilterRuntime {
    tokenizer: Tokenizer,
    session: Session,
}

impl PrivacyFilterRuntime {
    fn new(model_dir: &Path) -> Result<Self, String> {
        let started = Instant::now();
        let tokenizer_path = model_dir.join("tokenizer.json");
        let model_path = privacy_filter_onnx_path(model_dir)?;
        log::info!(
            "privacy-filter model load started: model_path={}",
            model_path.display()
        );
        let tokenizer = Tokenizer::from_file(&tokenizer_path).map_err(|error| {
            format!(
                "Failed to load Privacy Filter tokenizer at {}: {error}",
                tokenizer_path.display()
            )
        })?;
        let session = Session::builder()
            .map_err(|error| format!("Failed to create ONNX session builder: {error}"))?
            .with_optimization_level(GraphOptimizationLevel::Level1)
            .map_err(|error| format!("Failed to configure ONNX graph optimization: {error}"))?
            .with_intra_threads(1)
            .map_err(|error| format!("Failed to configure ONNX thread count: {error}"))?
            .commit_from_file(&model_path)
            .map_err(|error| {
                format!(
                    "Failed to load Privacy Filter ONNX model at {}: {error}",
                    model_path.display()
                )
            })?;
        log::info!(
            "privacy-filter model load completed: load_ms={}",
            started.elapsed().as_millis()
        );

        Ok(Self { tokenizer, session })
    }

    fn infer(&mut self, input: &str) -> Result<TokenizedLogits, String> {
        let tokenize_started = Instant::now();
        let encoding = self
            .tokenizer
            .encode(input, true)
            .map_err(|error| format!("Failed to tokenize input for Privacy Filter: {error}"))?;
        let tokenize_ms = tokenize_started.elapsed().as_millis();
        let token_count = encoding.len();

        if token_count == 0 {
            return Ok(TokenizedLogits {
                token_offsets: Vec::new(),
                logits: Vec::new(),
            });
        }

        let input_ids: Vec<i64> = encoding.get_ids().iter().map(|id| *id as i64).collect();
        let attention_mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .map(|mask| *mask as i64)
            .collect();
        let token_offsets = encoding.get_offsets().to_vec();
        let input_ids = TensorRef::from_array_view(([1, token_count], input_ids.as_slice()))
            .map_err(|error| {
                format!("Failed to prepare Privacy Filter input_ids tensor: {error}")
            })?;
        let attention_mask =
            TensorRef::from_array_view(([1, token_count], attention_mask.as_slice())).map_err(
                |error| format!("Failed to prepare Privacy Filter attention_mask tensor: {error}"),
            )?;
        let inference_started = Instant::now();
        let outputs = self
            .session
            .run(ort::inputs! {
                "input_ids" => input_ids,
                "attention_mask" => attention_mask,
            })
            .map_err(|error| format!("Privacy Filter ONNX inference failed: {error}"))?;
        log::info!(
            "privacy-filter inference: input_bytes={} tokens={token_count} tokenize_ms={tokenize_ms} inference_ms={}",
            input.len(),
            inference_started.elapsed().as_millis(),
        );
        let logits_value = outputs.get("logits").unwrap_or_else(|| &outputs[0]);
        let logits = logits_value
            .try_extract_array::<f32>()
            .map_err(|error| format!("Privacy Filter logits output was not f32 tensor: {error}"))?
            .into_dimensionality::<Ix3>()
            .map_err(|error| format!("Privacy Filter logits output was not [B,T,C]: {error}"))?;
        let logits = logits
            .index_axis(ndarray::Axis(0), 0)
            .outer_iter()
            .map(|token_logits| token_logits.to_vec())
            .collect();

        Ok(TokenizedLogits {
            token_offsets,
            logits,
        })
    }
}

struct TokenizedLogits {
    token_offsets: Vec<(usize, usize)>,
    logits: Vec<Vec<f32>>,
}

fn privacy_filter_model_dir() -> Result<PathBuf, String> {
    env::var("PRIVACY_FILTER_MODEL_DIR")
        .map(PathBuf::from)
        .map_err(|_| {
            "ONNX backend requires PRIVACY_FILTER_MODEL_DIR to point at a local openai/privacy-filter snapshot.".to_string()
        })
}

fn privacy_filter_onnx_path(model_dir: &Path) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("PRIVACY_FILTER_ONNX_FILE") {
        return Ok(PathBuf::from(path));
    }

    [
        "onnx/model_quantized.onnx",
        "onnx/model_q4.onnx",
        "onnx/model_q4f16.onnx",
        "onnx/model_fp16.onnx",
        "onnx/model.onnx",
    ]
    .into_iter()
    .map(|relative_path| model_dir.join(relative_path))
    .find(|path| path.exists())
    .ok_or_else(|| {
        format!(
            "No Privacy Filter ONNX model found under {}. Expected one of onnx/model_quantized.onnx, onnx/model_q4.onnx, onnx/model_q4f16.onnx, onnx/model_fp16.onnx, or onnx/model.onnx.",
            model_dir.display()
        )
    })
}

const PRIVACY_FILTER_LABELS: [&str; 33] = [
    "O",
    "B-account_number",
    "I-account_number",
    "E-account_number",
    "S-account_number",
    "B-private_address",
    "I-private_address",
    "E-private_address",
    "S-private_address",
    "B-private_date",
    "I-private_date",
    "E-private_date",
    "S-private_date",
    "B-private_email",
    "I-private_email",
    "E-private_email",
    "S-private_email",
    "B-private_person",
    "I-private_person",
    "E-private_person",
    "S-private_person",
    "B-private_phone",
    "I-private_phone",
    "E-private_phone",
    "S-private_phone",
    "B-private_url",
    "I-private_url",
    "E-private_url",
    "S-private_url",
    "B-secret",
    "I-secret",
    "E-secret",
    "S-secret",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BioesBoundary {
    Begin,
    Inside,
    End,
    Single,
}

fn decode_bioes_labels(logits: &[Vec<f32>]) -> Vec<usize> {
    viterbi_decode_labels(
        logits,
        PRIVACY_FILTER_LABELS.len(),
        &is_allowed_start,
        &is_allowed_end,
        &is_allowed_transition,
    )
}

/// Constrained BIO Viterbi for dynamic label sets (e.g. the xlm-roberta EU PII
/// checkpoint): an I- tag may only continue a span of the same entity kind, and
/// a sequence cannot start inside a span. Matches the reference decoder in
/// oh-my-pii/artifacts/bench_viterbi.py.
fn decode_bio_labels(logits: &[Vec<f32>], label_names: &[String]) -> Vec<usize> {
    #[derive(Clone, Copy, PartialEq)]
    enum BioTag<'a> {
        Outside,
        Begin(&'a str),
        Inside(&'a str),
    }

    let tags: Vec<BioTag> = label_names
        .iter()
        .map(|label| match label.split_once('-') {
            Some(("B", kind)) => BioTag::Begin(kind),
            Some(("I", kind)) => BioTag::Inside(kind),
            _ => BioTag::Outside,
        })
        .collect();
    let tag = |state: usize| tags.get(state).copied().unwrap_or(BioTag::Outside);

    viterbi_decode_labels(
        logits,
        label_names.len(),
        &|state| !matches!(tag(state), BioTag::Inside(_)),
        &|_state| true,
        &|previous, next| match (tag(previous), tag(next)) {
            (BioTag::Begin(previous_kind) | BioTag::Inside(previous_kind), BioTag::Inside(next_kind)) => {
                previous_kind == next_kind
            }
            (BioTag::Outside, BioTag::Inside(_)) => false,
            _ => true,
        },
    )
}

fn viterbi_decode_labels(
    logits: &[Vec<f32>],
    state_count: usize,
    is_allowed_start: &dyn Fn(usize) -> bool,
    is_allowed_end: &dyn Fn(usize) -> bool,
    is_allowed_transition: &dyn Fn(usize, usize) -> bool,
) -> Vec<usize> {
    if logits.is_empty() {
        return Vec::new();
    }

    let mut scores = vec![vec![f32::NEG_INFINITY; state_count]; logits.len()];
    let mut previous = vec![vec![0usize; state_count]; logits.len()];

    for state in 0..state_count {
        if is_allowed_start(state) {
            scores[0][state] = logit_score(&logits[0], state);
        }
    }

    for token_index in 1..logits.len() {
        for state in 0..state_count {
            let state_score = logit_score(&logits[token_index], state);
            if !state_score.is_finite() {
                continue;
            }

            for previous_state in 0..state_count {
                if !is_allowed_transition(previous_state, state) {
                    continue;
                }

                let candidate = scores[token_index - 1][previous_state] + state_score;
                if candidate > scores[token_index][state] {
                    scores[token_index][state] = candidate;
                    previous[token_index][state] = previous_state;
                }
            }
        }
    }

    let last_index = logits.len() - 1;
    let mut state = (0..state_count)
        .filter(|state| is_allowed_end(*state))
        .max_by(|left, right| {
            scores[last_index][*left]
                .partial_cmp(&scores[last_index][*right])
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .unwrap_or(0);

    if !scores[last_index][state].is_finite() {
        return logits.iter().map(|row| argmax(row)).collect();
    }

    let mut labels = vec![0usize; logits.len()];
    for token_index in (0..logits.len()).rev() {
        labels[token_index] = state;
        if token_index > 0 {
            state = previous[token_index][state];
        }
    }

    labels
}

fn logit_score(logits: &[f32], state: usize) -> f32 {
    logits.get(state).copied().unwrap_or(f32::NEG_INFINITY)
}

fn argmax(values: &[f32]) -> usize {
    values
        .iter()
        .enumerate()
        .max_by(|(_, left), (_, right)| {
            left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal)
        })
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn is_allowed_start(state: usize) -> bool {
    match label_boundary(state) {
        None => true,
        Some((BioesBoundary::Begin | BioesBoundary::Single, _)) => true,
        Some(_) => false,
    }
}

fn is_allowed_end(state: usize) -> bool {
    match label_boundary(state) {
        None => true,
        Some((BioesBoundary::End | BioesBoundary::Single, _)) => true,
        Some(_) => false,
    }
}

fn is_allowed_transition(previous_state: usize, next_state: usize) -> bool {
    match (label_boundary(previous_state), label_boundary(next_state)) {
        (None, None | Some((BioesBoundary::Begin | BioesBoundary::Single, _))) => true,
        (Some((BioesBoundary::End | BioesBoundary::Single, _)), None) => true,
        (
            Some((BioesBoundary::End | BioesBoundary::Single, _)),
            Some((BioesBoundary::Begin | BioesBoundary::Single, _)),
        ) => true,
        (
            Some((BioesBoundary::Begin | BioesBoundary::Inside, previous_kind)),
            Some((BioesBoundary::Inside | BioesBoundary::End, next_kind)),
        ) => previous_kind == next_kind,
        _ => false,
    }
}

fn label_boundary(label_id: usize) -> Option<(BioesBoundary, &'static str)> {
    let label = PRIVACY_FILTER_LABELS.get(label_id)?;
    let (boundary, kind) = label.split_once('-')?;
    let boundary = match boundary {
        "B" => BioesBoundary::Begin,
        "I" => BioesBoundary::Inside,
        "E" => BioesBoundary::End,
        "S" => BioesBoundary::Single,
        _ => return None,
    };

    Some((boundary, kind))
}

fn matches_from_token_labels(
    input: &str,
    token_offsets: &[(usize, usize)],
    labels: &[usize],
) -> Vec<RedactMatch> {
    #[derive(Debug)]
    struct ActiveSpan {
        kind: &'static str,
        start: usize,
        end: usize,
    }

    let mut matches = Vec::new();
    let mut active_span: Option<ActiveSpan> = None;

    for ((start, end), label_id) in token_offsets.iter().copied().zip(labels.iter().copied()) {
        if start >= end
            || end > input.len()
            || !input.is_char_boundary(start)
            || !input.is_char_boundary(end)
        {
            continue;
        }

        let Some((boundary, kind)) = label_boundary(label_id) else {
            if let Some(span) = active_span.take() {
                push_onnx_match(input, &mut matches, span.kind, span.start, span.end);
            }
            continue;
        };

        match boundary {
            BioesBoundary::Single => {
                if let Some(span) = active_span.take() {
                    push_onnx_match(input, &mut matches, span.kind, span.start, span.end);
                }
                push_onnx_match(input, &mut matches, kind, start, end);
            }
            BioesBoundary::Begin => {
                if let Some(span) = active_span.take() {
                    push_onnx_match(input, &mut matches, span.kind, span.start, span.end);
                }
                active_span = Some(ActiveSpan { kind, start, end });
            }
            BioesBoundary::Inside => match active_span.as_mut() {
                Some(span) if span.kind == kind => span.end = end,
                Some(_) => {
                    let previous = active_span.take().expect("active span must exist");
                    push_onnx_match(
                        input,
                        &mut matches,
                        previous.kind,
                        previous.start,
                        previous.end,
                    );
                    active_span = Some(ActiveSpan { kind, start, end });
                }
                None => active_span = Some(ActiveSpan { kind, start, end }),
            },
            BioesBoundary::End => match active_span.take() {
                Some(span) if span.kind == kind => {
                    push_onnx_match(input, &mut matches, kind, span.start, end);
                }
                Some(span) => {
                    push_onnx_match(input, &mut matches, span.kind, span.start, span.end);
                    push_onnx_match(input, &mut matches, kind, start, end);
                }
                None => push_onnx_match(input, &mut matches, kind, start, end),
            },
        }
    }

    if let Some(span) = active_span {
        push_onnx_match(input, &mut matches, span.kind, span.start, span.end);
    }

    matches
}

fn trim_span_whitespace(input: &str, start: usize, end: usize) -> (usize, usize) {
    let slice = &input[start..end];
    let trimmed_start = slice.trim_start();
    let new_start = start + (slice.len() - trimmed_start.len());
    let new_end = new_start + trimmed_start.trim_end().len();

    (new_start, new_end)
}

fn push_onnx_match(
    input: &str,
    matches: &mut Vec<RedactMatch>,
    kind: &'static str,
    start: usize,
    end: usize,
) {
    let (start, end) = trim_span_whitespace(input, start, end);
    if start >= end {
        return;
    }

    matches.push(RedactMatch {
        id: format!("onnx-{kind}-{start}-{}", matches.len()),
        kind: kind.to_string(),
        value: input[start..end].to_string(),
        start,
        end,
    });
}

struct BardsAiOnnxRedactor {
    runner: Box<dyn BardsAiRunner>,
}

impl BardsAiOnnxRedactor {
    fn from_environment() -> Self {
        Self {
            runner: Box::new(LazyBardsAiRunner::from_environment()),
        }
    }
}

impl PiiRedactor for BardsAiOnnxRedactor {
    fn redact(&self, input: &str) -> Result<RedactResult, String> {
        let tokenized_logits = self.runner.infer(input)?;
        let labels = decode_bio_labels(&tokenized_logits.logits, &tokenized_logits.label_names);
        let mut matches = bio_matches_from_token_labels(
            input,
            &tokenized_logits.token_offsets,
            &labels,
            &tokenized_logits.label_names,
        );
        matches.sort_by_key(|pii_match| pii_match.start);

        Ok(RedactResult {
            backend: "bardsai".to_string(),
            redacted_text: redact_spans(input, &matches),
            matches,
        })
    }
}

trait BardsAiRunner: Send + Sync {
    fn infer(&self, input: &str) -> Result<BardsAiTokenizedLogits, String>;
}

struct LazyBardsAiRunner {
    model_dir: Result<PathBuf, String>,
}

impl LazyBardsAiRunner {
    fn from_environment() -> Self {
        Self {
            model_dir: bardsai_model_dir(),
        }
    }

    fn runtime(&self) -> Result<&Mutex<Option<BardsAiRuntime>>, String> {
        static BARDSAI_RUNTIME: OnceLock<Mutex<Option<BardsAiRuntime>>> = OnceLock::new();

        let runtime = BARDSAI_RUNTIME.get_or_init(|| Mutex::new(None));
        let mut guard = runtime
            .lock()
            .map_err(|_| "BardsAI ONNX runtime lock was poisoned.".to_string())?;

        if guard.is_none() {
            let model_dir = self.model_dir.as_ref().map_err(Clone::clone)?;
            *guard = Some(BardsAiRuntime::new(model_dir)?);
        }

        drop(guard);
        Ok(runtime)
    }
}

impl BardsAiRunner for LazyBardsAiRunner {
    fn infer(&self, input: &str) -> Result<BardsAiTokenizedLogits, String> {
        let runtime = self.runtime()?;
        let mut runtime = runtime
            .lock()
            .map_err(|_| "BardsAI ONNX runtime lock was poisoned.".to_string())?;
        let runtime = runtime
            .as_mut()
            .ok_or_else(|| "BardsAI ONNX runtime was not initialized.".to_string())?;

        runtime.infer(input)
    }
}

struct BardsAiRuntime {
    tokenizer: Tokenizer,
    session: Session,
    label_names: Vec<String>,
}

impl BardsAiRuntime {
    fn new(model_dir: &Path) -> Result<Self, String> {
        let started = Instant::now();
        let tokenizer_path = model_dir.join("tokenizer.json");
        let model_path = bardsai_onnx_path(model_dir)?;
        log::info!(
            "bardsai model load started: model_path={}",
            model_path.display()
        );
        let config_path = model_dir.join("config.json");
        let tokenizer = Tokenizer::from_file(&tokenizer_path).map_err(|error| {
            format!(
                "Failed to load BardsAI tokenizer at {}: {error}",
                tokenizer_path.display()
            )
        })?;
        let label_names = read_id2label(&config_path)?;
        let session = Session::builder()
            .map_err(|error| format!("Failed to create BardsAI ONNX session builder: {error}"))?
            .with_optimization_level(GraphOptimizationLevel::Level1)
            .map_err(|error| format!("Failed to configure BardsAI graph optimization: {error}"))?
            .with_intra_threads(1)
            .map_err(|error| format!("Failed to configure BardsAI thread count: {error}"))?
            .commit_from_file(&model_path)
            .map_err(|error| {
                format!(
                    "Failed to load BardsAI ONNX model at {}: {error}",
                    model_path.display()
                )
            })?;
        log::info!(
            "bardsai model load completed: load_ms={}",
            started.elapsed().as_millis()
        );

        Ok(Self {
            tokenizer,
            session,
            label_names,
        })
    }

    fn infer(&mut self, input: &str) -> Result<BardsAiTokenizedLogits, String> {
        let tokenize_started = Instant::now();
        let encoding = self
            .tokenizer
            .encode(input, true)
            .map_err(|error| format!("Failed to tokenize input for BardsAI: {error}"))?;
        let tokenize_ms = tokenize_started.elapsed().as_millis();
        let token_count = encoding.len();

        if token_count == 0 {
            return Ok(BardsAiTokenizedLogits {
                token_offsets: Vec::new(),
                logits: Vec::new(),
                label_names: self.label_names.clone(),
            });
        }

        let input_ids: Vec<i64> = encoding.get_ids().iter().map(|id| *id as i64).collect();
        let attention_mask: Vec<i64> = encoding
            .get_attention_mask()
            .iter()
            .map(|mask| *mask as i64)
            .collect();
        let token_offsets = encoding.get_offsets().to_vec();
        let input_ids = TensorRef::from_array_view(([1, token_count], input_ids.as_slice()))
            .map_err(|error| format!("Failed to prepare BardsAI input_ids tensor: {error}"))?;
        let attention_mask =
            TensorRef::from_array_view(([1, token_count], attention_mask.as_slice())).map_err(
                |error| format!("Failed to prepare BardsAI attention_mask tensor: {error}"),
            )?;
        let inference_started = Instant::now();
        let outputs = self
            .session
            .run(ort::inputs! {
                "input_ids" => input_ids,
                "attention_mask" => attention_mask,
            })
            .map_err(|error| format!("BardsAI ONNX inference failed: {error}"))?;
        log::info!(
            "bardsai inference: input_bytes={} tokens={token_count} tokenize_ms={tokenize_ms} inference_ms={}",
            input.len(),
            inference_started.elapsed().as_millis(),
        );
        let logits_value = outputs.get("logits").unwrap_or_else(|| &outputs[0]);
        let logits = logits_value
            .try_extract_array::<f32>()
            .map_err(|error| format!("BardsAI logits output was not f32 tensor: {error}"))?
            .into_dimensionality::<Ix3>()
            .map_err(|error| format!("BardsAI logits output was not [B,T,C]: {error}"))?;
        let logits = logits
            .index_axis(ndarray::Axis(0), 0)
            .outer_iter()
            .map(|token_logits| token_logits.to_vec())
            .collect();

        Ok(BardsAiTokenizedLogits {
            token_offsets,
            logits,
            label_names: self.label_names.clone(),
        })
    }
}

struct BardsAiTokenizedLogits {
    token_offsets: Vec<(usize, usize)>,
    logits: Vec<Vec<f32>>,
    label_names: Vec<String>,
}

fn bardsai_model_dir() -> Result<PathBuf, String> {
    env::var("BARDSAI_PII_MODEL_DIR")
        .or_else(|_| env::var("EU_PII_MODEL_DIR"))
        .map(PathBuf::from)
        .map_err(|_| {
            "BardsAI backend requires BARDSAI_PII_MODEL_DIR to point at a local bardsai/eu-pii-anonimization-multilang snapshot.".to_string()
        })
}

fn bardsai_onnx_path(model_dir: &Path) -> Result<PathBuf, String> {
    if let Ok(path) = env::var("BARDSAI_PII_ONNX_FILE") {
        return Ok(PathBuf::from(path));
    }

    ["onnx/model_quantized.onnx", "onnx/model.onnx"]
        .into_iter()
        .map(|relative_path| model_dir.join(relative_path))
        .find(|path| path.exists())
        .ok_or_else(|| {
            format!(
                "No BardsAI ONNX model found under {}. Expected onnx/model_quantized.onnx or onnx/model.onnx.",
                model_dir.display()
            )
        })
}

fn read_id2label(config_path: &Path) -> Result<Vec<String>, String> {
    let config_text = fs::read_to_string(config_path).map_err(|error| {
        format!(
            "Failed to read BardsAI config at {}: {error}",
            config_path.display()
        )
    })?;
    let config: serde_json::Value = serde_json::from_str(&config_text)
        .map_err(|error| format!("Failed to parse BardsAI config: {error}"))?;
    let labels = config
        .get("id2label")
        .and_then(|value| value.as_object())
        .ok_or_else(|| "BardsAI config does not contain id2label.".to_string())?;
    let mut parsed_labels = labels
        .iter()
        .filter_map(|(key, value)| {
            let id = key.parse::<usize>().ok()?;
            let label = value.as_str()?.to_string();
            Some((id, label))
        })
        .collect::<Vec<_>>();
    parsed_labels.sort_by_key(|(id, _)| *id);

    Ok(parsed_labels.into_iter().map(|(_, label)| label).collect())
}

fn bio_matches_from_token_labels(
    input: &str,
    token_offsets: &[(usize, usize)],
    labels: &[usize],
    label_names: &[String],
) -> Vec<RedactMatch> {
    let mut spans: Vec<(String, usize, usize)> = Vec::new();
    let mut active_kind: Option<String> = None;
    let mut active_start = 0;
    let mut active_end = 0;

    for ((start, end), label_id) in token_offsets.iter().copied().zip(labels.iter().copied()) {
        if start >= end
            || end > input.len()
            || !input.is_char_boundary(start)
            || !input.is_char_boundary(end)
        {
            continue;
        }

        let Some(label) = label_names.get(label_id).map(String::as_str) else {
            continue;
        };
        let Some((_, raw_kind)) = label.split_once('-') else {
            // "O" (or a malformed label) ends the active span.
            if let Some(kind) = active_kind.take() {
                spans.push((kind, active_start, active_end));
            }
            continue;
        };

        // HF aggregation_strategy="simple": merge contiguous tokens of the same
        // entity kind regardless of B-/I- prefix. This model emits B- on
        // consecutive subtokens, so splitting on every B- fragments one entity
        // into many single-token matches.
        let kind = normalize_bardsai_kind(raw_kind);
        match active_kind.as_deref() {
            Some(active) if active == kind => active_end = end,
            _ => {
                if let Some(previous_kind) = active_kind.take() {
                    spans.push((previous_kind, active_start, active_end));
                }
                active_kind = Some(kind);
                active_start = start;
                active_end = end;
            }
        }
    }

    if let Some(kind) = active_kind {
        spans.push((kind, active_start, active_end));
    }

    let mut matches = Vec::new();
    for (kind, start, end) in bridge_connector_gaps(input, spans) {
        push_onnx_match_owned(input, &mut matches, &kind, start, end);
    }

    matches
}

/// Merge same-kind spans separated only by a short connector (e.g. the `@` in
/// an email the model labeled `O`), so one entity is not redacted as two
/// boxes. List separators like `,`/`;` and whitespace never bridge.
fn bridge_connector_gaps(
    input: &str,
    spans: Vec<(String, usize, usize)>,
) -> Vec<(String, usize, usize)> {
    let mut merged: Vec<(String, usize, usize)> = Vec::new();

    for (kind, start, end) in spans {
        if let Some((previous_kind, _, previous_end)) = merged.last_mut() {
            let gap = &input[*previous_end..start.max(*previous_end)];
            let bridgeable = gap.len() <= 3
                && gap
                    .chars()
                    .all(|c| c.is_ascii_punctuation() && !matches!(c, ',' | ';'));
            if *previous_kind == kind && bridgeable {
                *previous_end = end.max(*previous_end);
                continue;
            }
        }
        merged.push((kind, start, end));
    }

    merged
}

fn normalize_bardsai_kind(kind: &str) -> String {
    let normalized = kind.to_ascii_lowercase().replace([' ', '-'], "_");

    match normalized.as_str() {
        "per" | "person" | "name" | "person_name" | "person_alias" | "proper_name" => {
            "private_person".to_string()
        }
        "email" | "email_address" => "private_email".to_string(),
        "phone" | "phone_number" | "telephone" => "private_phone".to_string(),
        "address" | "addr" | "location" | "postal_address" | "geo_location" => {
            "private_address".to_string()
        }
        "date" | "date_of_birth" => "private_date".to_string(),
        "url" | "website" | "identifying_link" => "private_url".to_string(),
        "iban" | "account" | "account_number" | "account_identifier"
        | "bank_account_identifier" | "payment_card" => "account_number".to_string(),
        "password" | "secret" | "api_key" | "token" | "auth_secret"
        | "payment_card_security" => "secret".to_string(),
        _ => normalized,
    }
}

fn push_onnx_match_owned(
    input: &str,
    matches: &mut Vec<RedactMatch>,
    kind: &str,
    start: usize,
    end: usize,
) {
    let (start, end) = trim_span_whitespace(input, start, end);
    if start >= end {
        return;
    }

    matches.push(RedactMatch {
        id: format!("onnx-{kind}-{start}-{}", matches.len()),
        kind: kind.to_string(),
        value: input[start..end].to_string(),
        start,
        end,
    });
}

fn redact_spans(input: &str, matches: &[RedactMatch]) -> String {
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0;

    for pii_match in matches {
        if pii_match.start < cursor {
            continue;
        }

        output.push_str(&input[cursor..pii_match.start]);
        output.push_str(&format!("[{}]", pii_match.kind.to_uppercase()));
        cursor = pii_match.end;
    }

    output.push_str(&input[cursor..]);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regex_redacts_rule_based_privacy_filter_labels() {
        let engine = RedactEngine::new(RedactBackend::Regex);
        let result = engine.redact(
            "Contact ada@example.com or +1 (123) 456-7890 at https://example.com/case on 2026-07-15 with sk_live_abcdefg0123456 today.",
        ).expect("regex redaction should succeed");

        assert_eq!(result.backend, "regex");
        assert_eq!(
            result.redacted_text,
            "Contact [PRIVATE_EMAIL] or [PRIVATE_PHONE] at [PRIVATE_URL] on [PRIVATE_DATE] with [SECRET] today."
        );
        assert_eq!(result.matches.len(), 5);
        assert_eq!(result.matches[0].kind, "private_email");
        assert_eq!(result.matches[0].value, "ada@example.com");
        assert_eq!(result.matches[1].kind, "private_phone");
        assert_eq!(result.matches[1].value, "+1 (123) 456-7890");
        assert_eq!(result.matches[2].kind, "private_url");
        assert_eq!(result.matches[2].value, "https://example.com/case");
        assert_eq!(result.matches[3].kind, "private_date");
        assert_eq!(result.matches[3].value, "2026-07-15");
        assert_eq!(result.matches[4].kind, "secret");
        assert_eq!(result.matches[4].value, "sk_live_abcdefg0123456");
    }

    #[test]
    fn regex_keeps_plain_text_unchanged() {
        let engine = RedactEngine::new(RedactBackend::Regex);
        let result = engine
            .redact("No sensitive data here.")
            .expect("regex redaction should succeed");

        assert_eq!(result.redacted_text, "No sensitive data here.");
        assert!(result.matches.is_empty());
    }

    #[test]
    fn onnx_backend_decodes_privacy_filter_logits_to_spans() {
        struct FakePrivacyFilterRunner;

        impl PrivacyFilterRunner for FakePrivacyFilterRunner {
            fn infer(&self, _input: &str) -> Result<TokenizedLogits, String> {
                Ok(TokenizedLogits {
                    token_offsets: vec![(0, 8), (9, 12), (13, 21), (22, 30), (31, 33), (34, 49)],
                    logits: vec![
                        high_logit(0),
                        high_logit(17),
                        high_logit(19),
                        high_logit(0),
                        high_logit(0),
                        high_logit(16),
                    ],
                })
            }
        }

        let engine = RedactEngine::with_redactor(Box::new(PrivacyFilterOnnxRedactor::from_runner(
            Box::new(FakePrivacyFilterRunner),
        )));
        let result = engine
            .redact("Reviewer Ada Lovelace approved it ada@example.com")
            .expect("fake ONNX redaction should succeed");

        assert_eq!(result.backend, "onnx");
        assert_eq!(
            result.redacted_text,
            "Reviewer [PRIVATE_PERSON] approved it [PRIVATE_EMAIL]"
        );
        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.matches[0].kind, "private_person");
        assert_eq!(result.matches[0].value, "Ada Lovelace");
        assert_eq!(result.matches[1].kind, "private_email");
        assert_eq!(result.matches[1].value, "ada@example.com");
    }

    #[test]
    fn onnx_backend_trims_whitespace_from_match_edges() {
        struct WhitespaceOffsetRunner;

        impl PrivacyFilterRunner for WhitespaceOffsetRunner {
            fn infer(&self, _input: &str) -> Result<TokenizedLogits, String> {
                // BPE-style offsets that include the leading space of each token.
                Ok(TokenizedLogits {
                    token_offsets: vec![(0, 8), (8, 12), (12, 21), (21, 30), (30, 33), (33, 49)],
                    logits: vec![
                        high_logit(0),
                        high_logit(17),
                        high_logit(19),
                        high_logit(0),
                        high_logit(0),
                        high_logit(16),
                    ],
                })
            }
        }

        let engine = RedactEngine::with_redactor(Box::new(PrivacyFilterOnnxRedactor::from_runner(
            Box::new(WhitespaceOffsetRunner),
        )));
        let result = engine
            .redact("Reviewer Ada Lovelace approved it ada@example.com")
            .expect("fake ONNX redaction should succeed");

        assert_eq!(
            result.redacted_text,
            "Reviewer [PRIVATE_PERSON] approved it [PRIVATE_EMAIL]"
        );
        assert_eq!(result.matches.len(), 2);
        assert_eq!(result.matches[0].value, "Ada Lovelace");
        assert_eq!(result.matches[1].value, "ada@example.com");
    }

    #[test]
    fn onnx_backend_reports_missing_model_dir() {
        let previous_value = env::var("PRIVACY_FILTER_MODEL_DIR").ok();
        env::remove_var("PRIVACY_FILTER_MODEL_DIR");

        let engine = RedactEngine::new(RedactBackend::Onnx);
        let error = engine
            .redact("My name is Ada Lovelace.")
            .expect_err("missing model dir should fail the ONNX backend");

        assert!(error.contains("PRIVACY_FILTER_MODEL_DIR"));

        if let Some(previous_value) = previous_value {
            env::set_var("PRIVACY_FILTER_MODEL_DIR", previous_value);
        }
    }

    #[test]
    fn viterbi_decoder_repairs_invalid_inside_start() {
        let labels = decode_bioes_labels(&[high_logit(18), high_logit(19)]);

        assert_eq!(labels, vec![17, 19]);
    }

    #[test]
    fn bardsai_bio_decoder_maps_common_eu_pii_labels() {
        let input = "Maria Garcia uses maria@example.eu";
        let labels = vec![
            "O".to_string(),
            "B-PER".to_string(),
            "I-PER".to_string(),
            "B-EMAIL".to_string(),
        ];
        let matches =
            bio_matches_from_token_labels(input, &[(0, 5), (6, 12), (18, 34)], &[1, 2, 3], &labels);

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].kind, "private_person");
        assert_eq!(matches[0].value, "Maria Garcia");
        assert_eq!(matches[1].kind, "private_email");
        assert_eq!(matches[1].value, "maria@example.eu");
    }

    #[test]
    fn bardsai_simple_aggregation_merges_consecutive_begin_subtokens() {
        let input = "Contact jordan.lee@example.com now";
        let labels = vec![
            "O".to_string(),
            "B-EMAIL_ADDRESS".to_string(),
            "I-EMAIL_ADDRESS".to_string(),
        ];
        // The EU PII checkpoint emits B- on consecutive subtokens of one entity.
        let matches = bio_matches_from_token_labels(
            input,
            &[(0, 7), (8, 14), (14, 18), (18, 26), (26, 30), (31, 34)],
            &[0, 1, 1, 1, 1, 0],
            &labels,
        );

        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].kind, "private_email");
        assert_eq!(matches[0].value, "jordan.lee@example.com");
    }

    #[test]
    fn bardsai_aggregation_bridges_connector_gaps_but_not_separators() {
        let labels = vec!["O".to_string(), "B-EMAIL_ADDRESS".to_string()];

        // The model labels the "@" token O; the two email halves must merge.
        let input = "jordan.lee@example.com or a@b.io";
        let matches = bio_matches_from_token_labels(
            input,
            &[(0, 10), (10, 11), (11, 22), (23, 25), (26, 32)],
            &[1, 0, 1, 0, 1],
            &labels,
        );

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].value, "jordan.lee@example.com");
        assert_eq!(matches[1].value, "a@b.io");

        // Comma-separated entities stay distinct.
        let input = "a@b.io,c@d.io";
        let matches =
            bio_matches_from_token_labels(input, &[(0, 6), (6, 7), (7, 13)], &[1, 0, 1], &labels);

        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].value, "a@b.io");
        assert_eq!(matches[1].value, "c@d.io");
    }

    #[test]
    fn bardsai_kind_normalization_covers_eu_pii_taxonomy() {
        assert_eq!(normalize_bardsai_kind("PERSON_NAME"), "private_person");
        assert_eq!(normalize_bardsai_kind("IDENTIFYING_LINK"), "private_url");
        assert_eq!(normalize_bardsai_kind("AUTH_SECRET"), "secret");
        assert_eq!(normalize_bardsai_kind("POSTAL_ADDRESS"), "private_address");
        assert_eq!(normalize_bardsai_kind("DATE_OF_BIRTH"), "private_date");
        assert_eq!(normalize_bardsai_kind("PAYMENT_CARD"), "account_number");
        assert_eq!(
            normalize_bardsai_kind("ORGANIZATION_NAME"),
            "organization_name"
        );
    }

    #[test]
    fn bio_viterbi_repairs_mid_entity_label_flip() {
        let labels: Vec<String> = ["O", "B-EMAIL", "I-EMAIL", "B-ORG", "I-ORG"]
            .iter()
            .map(|label| label.to_string())
            .collect();
        // Token 1 starts an email; token 2's argmax is I-ORG, which cannot
        // follow B-EMAIL, so the decoder must pick the runner-up I-EMAIL.
        let logits = vec![
            bio_logit(&[(1, 10.0)], labels.len()),
            bio_logit(&[(4, 10.0), (2, 9.0)], labels.len()),
        ];

        let decoded = decode_bio_labels(&logits, &labels);

        assert_eq!(decoded, vec![1, 2]);
    }

    #[test]
    fn bio_viterbi_forbids_inside_after_outside() {
        let labels: Vec<String> = ["O", "B-PER", "I-PER"]
            .iter()
            .map(|label| label.to_string())
            .collect();
        let logits = vec![
            bio_logit(&[(0, 10.0)], labels.len()),
            bio_logit(&[(2, 10.0), (1, 9.0)], labels.len()),
        ];

        let decoded = decode_bio_labels(&logits, &labels);

        assert_eq!(decoded, vec![0, 1]);
    }

    fn high_logit(label_id: usize) -> Vec<f32> {
        let mut logits = vec![-10.0; PRIVACY_FILTER_LABELS.len()];
        logits[label_id] = 10.0;
        logits
    }

    fn bio_logit(scores: &[(usize, f32)], state_count: usize) -> Vec<f32> {
        let mut logits = vec![-10.0; state_count];
        for (label_id, score) in scores.iter().copied() {
            logits[label_id] = score;
        }
        logits
    }
}
