#!/usr/bin/env bash
# Switch the live Railway service between the demo keyword scorer (mock) and Claude.
#
#   deploy/flip.sh claude   # before the demo: key → Railway, default provider claude, one redeploy
#   deploy/flip.sh mock     # right after: key removed from Railway, default provider mock
#   deploy/flip.sh status   # what the live URL runs now
#   DRY_RUN=1 deploy/flip.sh claude   # rehearsal: print the Railway commands, change nothing
#
# The key is read from CQA_ANTHROPIC_API_KEY in the environment or in backend/.env
# (git-ignored) and passed to Railway via stdin — it never appears in arguments,
# shell history or the repo. Optional: CQA_ANTHROPIC_MODEL, CQA_CLAUDE_SAMPLES.
# Needs the Railway CLI, logged in and linked to the project (railway login / railway link).
#
# Note: every redeploy wipes the SQLite data (scores, appeals) — prepare the demo AFTER flipping.
set -euo pipefail
cd "$(dirname "$0")/.."

SERVICE="${CQA_RAILWAY_SERVICE:-cqa-web}"
URL="${CQA_PUBLIC_URL:-https://cqa-web-production.up.railway.app}"

DRY_RUN="${DRY_RUN:-}"
rw() {  # mutating railway call; in DRY_RUN mode only print it (stdin, i.e. the key, is never shown)
  if [ -n "$DRY_RUN" ]; then
    case " $* " in *" --stdin "*) cat >/dev/null ;; esac  # swallow the piped key, never print it
    echo "  [dry-run] railway $*"
  else
    railway "$@" >/dev/null
  fi
}

env_get() {  # value from the environment, else from backend/.env (quotes stripped)
  local v="${!1:-}"
  if [ -z "$v" ] && [ -f backend/.env ]; then
    v="$(grep -E "^$1=" backend/.env | tail -1 | cut -d= -f2- | sed -e "s/^[\"']//" -e "s/[\"']\$//")"
  fi
  printf '%s' "$v"
}

latest_deployment() {  # "<id> <status>" of the newest deployment
  railway deployment list --service "$SERVICE" --json 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
d = d if isinstance(d, list) else d.get("deployments", [])
print("%s %s" % (d[0]["id"], d[0]["status"]) if d else "- -")'
}

wait_for_new_deployment() {  # $1 = id of the deployment that was live before
  local before="$1" id status
  printf 'Деплой'
  for _ in $(seq 1 90); do
    read -r id status <<<"$(latest_deployment)"
    if [ "$id" != "$before" ]; then
      case "$status" in
        SUCCESS) echo " — готово"; return 0 ;;
        FAILED|CRASHED|REMOVED) echo " — ошибка ($status): railway logs --service $SERVICE"; return 1 ;;
      esac
    fi
    printf '.'; sleep 4
  done
  echo " — не дождался, проверьте: railway deployment list --service $SERVICE"; return 1
}

status() {
  python3 - "$URL" <<'PY'
import json, sys, urllib.request
url = sys.argv[1]
get = lambda p: json.load(urllib.request.urlopen(url + p, timeout=30))
h = get("/api/health")
claude = next((p for p in get("/api/providers") if p["id"] == "claude"), None)
print(f"{url}\n  провайдер по умолчанию: {h['default_provider']} · диалогов: {h['dialogs']}")
print(f"  Claude: {'ВКЛЮЧЁН (' + claude.get('model', '') + ')' if claude and claude['available'] else 'выключен'}")
PY
}

has_remote_key() {
  railway variable --service "$SERVICE" --kv 2>/dev/null | grep -q '^CQA_ANTHROPIC_API_KEY='
}

case "${1:-status}" in
  claude)
    key="$(env_get CQA_ANTHROPIC_API_KEY)"
    if [ -z "$key" ]; then
      echo "Нет ключа: добавьте CQA_ANTHROPIC_API_KEY=... в backend/.env (он в .gitignore)." >&2
      exit 1
    fi
    before="$(latest_deployment | cut -d' ' -f1)"
    printf '%s' "$key" | rw variable set CQA_ANTHROPIC_API_KEY --stdin --service "$SERVICE" --skip-deploys
    extra=()
    model="$(env_get CQA_ANTHROPIC_MODEL)";   [ -n "$model" ]   && extra+=("CQA_ANTHROPIC_MODEL=$model")
    samples="$(env_get CQA_CLAUDE_SAMPLES)";  [ -n "$samples" ] && extra+=("CQA_CLAUDE_SAMPLES=$samples")
    rw variable set CQA_DEFAULT_PROVIDER=claude ${extra[@]+"${extra[@]}"} --service "$SERVICE" --skip-deploys
    rw redeploy --service "$SERVICE" --yes
    [ -n "$DRY_RUN" ] && { echo "  (dry-run: ничего не изменено)"; exit 0; }
    wait_for_new_deployment "$before"
    status
    echo "Важно: на демо-машине выберите «Облако · Claude» в переключателе модели (браузер помнит прошлый выбор)."
    ;;
  mock)
    before="$(latest_deployment | cut -d' ' -f1)"
    rw variable set CQA_DEFAULT_PROVIDER=mock --service "$SERVICE" --skip-deploys
    if has_remote_key; then
      rw variable delete CQA_ANTHROPIC_API_KEY --service "$SERVICE"  # triggers the redeploy itself
    else
      rw redeploy --service "$SERVICE" --yes
    fi
    [ -n "$DRY_RUN" ] && { echo "  (dry-run: ничего не изменено)"; exit 0; }
    wait_for_new_deployment "$before"
    status
    ;;
  status)
    status
    ;;
  *)
    echo "Использование: deploy/flip.sh claude | mock | status" >&2
    exit 2
    ;;
esac
