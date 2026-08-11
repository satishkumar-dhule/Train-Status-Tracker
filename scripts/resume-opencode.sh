#!/usr/bin/env bash
#
# resume-opencode.sh
#
# Start opencode in detached mode and resume conversations that still have
# outstanding (unfinished) todos.
#
# For each of the N most recently updated opencode sessions (default: the last
# 5), if the session has at least one todo whose status is not "completed" or
# "canceled" and the session is not already being processed, this script
# launches `opencode run --session <id>` as a fully detached background process
# (setsid + nohup) so the work continues without holding up a terminal.
#
# Dependencies: opencode, jq
#
# Usage:
#   scripts/resume-opencode.sh [options]
#
# Options:
#   -n, --max <N>        Consider the N most recent sessions (default: 5)
#   -m, --message <txt>  Custom resume prompt. Default: a prompt auto-built
#                        from the session's outstanding todos
#       --no-auto        Do NOT auto-approve permissions for the resumed runs.
#                        Auto-approval is on by default so detached runs can
#                        proceed unattended; disabling it may stall (or deny
#                        tools) when a tool needs approval
#       --force          Resume even if the session looks like it is currently
#                        being processed (its last step is a step-start)
#       --dry-run        Print what would be resumed without launching anything
#       --log-dir <dir>  Directory for per-session logs and PID files
#                        (default: ~/.local/share/opencode/resume)
#       --delay <secs>   Pause between launching sessions (default: 5)
#   -h, --help           Show this help and exit
#
# Examples:
#   scripts/resume-opencode.sh                      # resume last 5 with todos
#   scripts/resume-opencode.sh --max 10             # scan 10 sessions
#   scripts/resume-opencode.sh --no-auto            # require explicit approval
#   scripts/resume-opencode.sh --dry-run            # preview, do not launch
#
set -euo pipefail

OPENCODE_BIN="${OPENCODE_BIN:-$(command -v opencode || true)}"
if [[ -z "$OPENCODE_BIN" ]]; then
  echo "error: opencode binary not found in PATH (set OPENCODE_BIN to override)" >&2
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

MAX=5
MESSAGE=""
AUTO=1
FORCE=0
DRY_RUN=0
DELAY=5
LOG_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/opencode/resume"

usage() {
  sed -n 's/^# \{0,1\}//p' "$0" | sed -n '2,38p'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--max)        MAX="$2"; shift 2 ;;
    -m|--message)    MESSAGE="$2"; shift 2 ;;
    --no-auto)       AUTO=0; shift ;;
    --force)         FORCE=1; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --log-dir)       LOG_DIR="$2"; shift 2 ;;
    --delay)         DELAY="$2"; shift 2 ;;
    -h|--help)       usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! "$MAX" =~ ^[0-9]+$ ]] || (( MAX < 1 )); then
  echo "error: --max must be a positive integer, got '$MAX'" >&2
  exit 2
fi
if [[ ! "$DELAY" =~ ^[0-9]+$ ]]; then
  echo "error: --delay must be a positive integer, got '$DELAY'" >&2
  exit 2
fi

QUERY="SELECT id, title, directory, agent, provider, model_id, variant, outstanding, last_step FROM (
  SELECT s.id,
         s.title,
         s.directory,
         s.agent,
         json_extract(s.model,'\$.providerID') AS provider,
         json_extract(s.model,'\$.id') AS model_id,
         json_extract(s.model,'\$.variant') AS variant,
         (SELECT COUNT(*) FROM todo t
            WHERE t.session_id = s.id
              AND t.status IN ('pending','in_progress')) AS outstanding,
         (SELECT json_extract(p.data,'\$.type') FROM part p
            WHERE p.session_id = s.id
              AND json_extract(p.data,'\$.type') LIKE 'step-%'
            ORDER BY p.time_updated DESC LIMIT 1) AS last_step
  FROM session s
  WHERE s.time_archived IS NULL
  ORDER BY s.time_updated DESC
  LIMIT ${MAX}
) WHERE outstanding > 0"

readarray -t ROWS < <(
  "$OPENCODE_BIN" db --format json "$QUERY" | jq -c '.[]'
)

if (( ${#ROWS[@]} == 0 )); then
  echo "No sessions with outstanding todos among the last ${MAX} conversations."
  exit 0
fi

build_message() {
  local id="$1"
  if [[ -n "$MESSAGE" ]]; then
    printf '%s' "$MESSAGE"
    return
  fi
  local todos
  todos="$("$OPENCODE_BIN" db --format json \
    "SELECT status, content FROM todo WHERE session_id='$id' ORDER BY position")"
  printf 'Continue the work in this session. These todos are still outstanding:\n\n'
  jq -r '.[] | "- [" + .status + "] " + .content' <<<"$todos"
  printf '\nWork through the list autonomously, marking todos done as you finish.\n'
  printf 'When every todo is completed, stop and summarize what changed.\n'
}

resume_count=0
skip_count=0

for row in "${ROWS[@]}"; do
  id="$(jq -r '.id' <<<"$row")"
  title="$(jq -r '.title' <<<"$row")"
  directory="$(jq -r '.directory' <<<"$row")"
  agent="$(jq -r '.agent' <<<"$row")"
  provider="$(jq -r '.provider' <<<"$row")"
  model_id="$(jq -r '.model_id' <<<"$row")"
  variant="$(jq -r '.variant' <<<"$row")"
  outstanding="$(jq -r '.outstanding' <<<"$row")"
  last_step="$(jq -r '.last_step' <<<"$row")"

  if [[ "$last_step" == "step-start" && "$FORCE" -ne 1 ]]; then
    echo "[skip] $id ($title): session is currently being processed (use --force to resume)"
    (( skip_count++ )) || true
    continue
  fi
  if pgrep -f -- "--session $id" >/dev/null 2>&1; then
    echo "[skip] $id ($title): a live process is already continuing this session"
    (( skip_count++ )) || true
    continue
  fi
  pidfile="$LOG_DIR/$id.pid"
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "[skip] $id ($title): already resumed (pid $(cat "$pidfile")), use --force to relaunch"
    (( skip_count++ )) || true
    continue
  fi

  args=(run --session "$id" --dir "$directory")
  [[ -n "$agent" ]] && args+=(--agent "$agent")
  if [[ -n "$provider" && -n "$model_id" ]]; then
    args+=(--model "$provider/$model_id")
    [[ -n "$variant" ]] && args+=(--variant "$variant")
  fi
  (( AUTO )) && args+=(--auto)

  message="$(build_message "$id")"

  if (( DRY_RUN )); then
    echo "[dry-run] would resume $id ($title) - ${outstanding} outstanding todo(s):"
    printf '  %s\n' "${args[@]}" "$message"
    (( resume_count++ )) || true
    continue
  fi

  mkdir -p "$LOG_DIR"
  logfile="$LOG_DIR/$id.log"
  setsid nohup "$OPENCODE_BIN" "${args[@]}" "$message" >"$logfile" 2>&1 < /dev/null &
  pid=$!
  echo "$pid" > "$pidfile"
  echo "[resumed] $id ($title) - ${outstanding} outstanding todo(s), pid=$pid, log=$logfile"
  (( resume_count++ )) || true
  (( resume_count < ${#ROWS[@]} )) && sleep "$DELAY"
done

echo
echo "Done. resumed=${resume_count} skipped=${skip_count}"
if (( DRY_RUN )); then
  echo "Logs and PID files will be written to: $LOG_DIR"
fi
