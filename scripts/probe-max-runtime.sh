#!/usr/bin/env bash
set -euo pipefail

MODEL="${MAX_MODEL:-Qwen/Qwen3-8B}"
HOST="${MAX_SERVE_HOST:-127.0.0.1}"
PORT="${MAX_SERVE_PORT:-8000}"
BASE_URL="${LOCAL_INFERENCE_BASE_URL:-http://${HOST}:${PORT}}"
RUNTIME="${LOCAL_INFERENCE_RUNTIME:-max}"
NODE_LABEL="${LOCAL_INFERENCE_NODE:-leased-node-max-01}"
RUNS="${BENCHMARK_RUNS:-5}"
OUTPUT_DIR="${PROBE_OUTPUT_DIR:-outputs/artifacts}"
MANAGE_SERVER="${MAX_MANAGE_SERVER:-1}"

if [[ "${HOST}" != "127.0.0.1" && "${HOST}" != "localhost" && "${HOST}" != "::1" ]]; then
  echo "Refusing to run: MAX_SERVE_HOST must be loopback for this gate; received '${HOST}'." >&2
  exit 2
fi

if [[ "${BASE_URL}" != http://127.0.0.1:* && "${BASE_URL}" != http://localhost:* && "${BASE_URL}" != "http://[::1]:"* ]]; then
  echo "Refusing to run: LOCAL_INFERENCE_BASE_URL must be loopback for this gate; received '${BASE_URL}'." >&2
  exit 2
fi

command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "node is required." >&2; exit 2; }
command -v npm >/dev/null 2>&1 || { echo "npm is required." >&2; exit 2; }

mkdir -p "${OUTPUT_DIR}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SERVER_LOG="${OUTPUT_DIR}/max-serve-${STAMP}.log"
PROBE_JSON="${OUTPUT_DIR}/max-real-model-probe-${STAMP}.json"
BENCH_JSON="${OUTPUT_DIR}/max-runtime-benchmark-${STAMP}.json"

MAX_PID=""

cleanup() {
  if [[ -n "${MAX_PID}" ]] && kill -0 "${MAX_PID}" 2>/dev/null; then
    kill "${MAX_PID}" 2>/dev/null || true
    wait "${MAX_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ "${MANAGE_SERVER}" == "1" ]]; then
  command -v max >/dev/null 2>&1 || {
    echo "MAX CLI not found. Install/configure MAX first, or set MAX_MANAGE_SERVER=0 and launch MAX separately." >&2
    exit 2
  }

  echo "Starting MAX on loopback only: ${HOST}:${PORT}"
  MAX_SERVE_HOST="${HOST}" MAX_SERVE_PORT="${PORT}"     max serve --model "${MODEL}" >"${SERVER_LOG}" 2>&1 &
  MAX_PID="$!"
else
  echo "MAX_MANAGE_SERVER=0: expecting an existing loopback MAX server at ${BASE_URL}"
fi

echo "Waiting for MAX health endpoint..."
READY=0
for _ in $(seq 1 120); do
  if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if [[ -n "${MAX_PID}" ]] && ! kill -0 "${MAX_PID}" 2>/dev/null; then
    echo "MAX exited before becoming ready. See ${SERVER_LOG}" >&2
    exit 1
  fi
  sleep 2
done

if [[ "${READY}" != "1" ]]; then
  echo "MAX did not become ready within the probe window." >&2
  [[ -f "${SERVER_LOG}" ]] && tail -n 80 "${SERVER_LOG}" >&2 || true
  exit 1
fi

echo "Checking /v1/models..."
curl -fsS "${BASE_URL}/v1/models" >/dev/null

echo "Checking direct chat completion evidence..."
DIRECT_RESPONSE="$(curl -fsS "${BASE_URL}/v1/chat/completions"   -H 'Content-Type: application/json'   -d "$(node -e '
    const model = process.argv[1];
    process.stdout.write(JSON.stringify({
      model,
      messages: [{ role: "user", content: "Return exactly: sovereign local inference complete" }],
      stream: false
    }));
  ' "${MODEL}")")"

DIRECT_RESPONSE="${DIRECT_RESPONSE}" node -e '
  const payload = JSON.parse(process.env.DIRECT_RESPONSE || "{}");
  const content = payload?.choices?.[0]?.message?.content;
  if (!payload.id) {
    console.error("Direct MAX completion is missing a completion id.");
    process.exit(1);
  }
  if (!content) {
    console.error("Direct MAX completion is missing assistant content.");
    process.exit(1);
  }
  console.log(JSON.stringify({
    completion_id: payload.id,
    model: payload.model,
    assistant_content_present: true
  }, null, 2));
'

export LOCAL_INFERENCE_BASE_URL="${BASE_URL}"
export LOCAL_INFERENCE_MODEL="${MODEL}"
export LOCAL_INFERENCE_RUNTIME="${RUNTIME}"
export LOCAL_INFERENCE_NODE="${NODE_LABEL}"
export LOCAL_INFERENCE_PROMPT="${LOCAL_INFERENCE_PROMPT:-Return exactly: sovereign local inference complete}"
export BENCHMARK_RUNS="${RUNS}"

echo "Running repository tests..."
npm install
npm test

echo "Running AVOT real-model round trip..."
npm run probe:local | tee "${PROBE_JSON}"

echo "Running comparative benchmark harness..."
npm run probe:benchmark | tee "${BENCH_JSON}"

echo
echo "MAX execution gate completed."
echo "Probe evidence: ${PROBE_JSON}"
echo "Benchmark evidence: ${BENCH_JSON}"
[[ -f "${SERVER_LOG}" ]] && echo "MAX server log: ${SERVER_LOG}"
