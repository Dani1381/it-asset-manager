#!/usr/bin/env bash
# IT Asset Manager - USB kit for Linux
# Double-click "Scan-Asset-Linux.desktop" (or: bash Scan-Asset-Linux.sh).
# Sends the scan to the first server address that answers; without network the
# scan is saved in scans/ on the USB and delivered on the next connected run.
# Everything is logged to scan-log.txt (on the USB, or ~/ and /tmp if the USB is read-only).

SERVER_URLS=("http://192.168.10.194:3000")
SERVER_KEY="SET-AUTOMATICALLY-ON-DOWNLOAD"

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---- Log file: first writable place wins ----
LOG=""
for candidate in "$KIT_DIR/scan-log.txt" "$HOME/arka-scan-log.txt" "/tmp/arka-scan-log.txt"; do
  if ( : >> "$candidate" ) 2>/dev/null; then LOG="$candidate"; break; fi
done
[ -z "$LOG" ] && LOG="/dev/null"
# Show everything on screen and append it to the log
exec > >(tee -a "$LOG") 2>&1

log() { echo "[$(date '+%H:%M:%S')] $*"; }
on_exit() {
  local rc=$?
  log "Script finished with exit code $rc. Log file: $LOG"
}
trap on_exit EXIT

echo
echo "========================================================"
echo "  IT Asset Master - USB Hardware Scanner (Linux)"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================================"
log "Kit folder: $KIT_DIR"
log "Log file:   $LOG"
log "User: $(id -un 2>/dev/null)  Host: $(hostname 2>/dev/null)  Shell: $BASH_VERSION"
log "Tools: curl=$(command -v curl || echo none)  wget=$(command -v wget || echo none)"
log "IP addresses: $(hostname -I 2>/dev/null || ip -4 -o addr show 2>/dev/null | awk '{print $4}' | tr '\n' ' ')"

SCAN_DIR="$KIT_DIR/scans"
SENT_DIR="$SCAN_DIR/sent"
USB_WRITABLE=1
if ! mkdir -p "$SENT_DIR" 2>/dev/null || ! ( : > "$SCAN_DIR/.write-test" ) 2>/dev/null; then
  USB_WRITABLE=0
  # USB is read-only (e.g. booted from this same stick): keep offline scans in the home folder
  SCAN_DIR="$HOME/arka-scans"; SENT_DIR="$SCAN_DIR/sent"
  mkdir -p "$SENT_DIR" 2>/dev/null
  log "USB folder is READ-ONLY -> offline scans go to $SCAN_DIR"
fi
rm -f "$KIT_DIR/scans/.write-test" 2>/dev/null

if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  log "ERROR: neither curl nor wget is installed - cannot talk to the server."
fi

http_get_ok() { # url
  if command -v curl >/dev/null 2>&1; then curl -s -m 5 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null
  else wget -q -T 5 -O /dev/null --server-response "$1" 2>&1 | awk '/HTTP\//{c=$2} END{print c}'; fi
}

post() { # url body -> prints server reply
  if command -v curl >/dev/null 2>&1; then
    curl -sS -m 20 -X POST "$1" -H "Content-Type: application/json; charset=utf-8" \
      -H "X-IAM-Key: $SERVER_KEY" --data-binary "$2" 2>&1
  else
    wget -qO- -T 20 --header="Content-Type: application/json; charset=utf-8" --header="X-IAM-Key: $SERVER_KEY" \
      --post-data="$2" "$1" 2>&1
  fi
}

json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\r' | tr '\n' ' '; }

# Short status line in the server's system logs, so the admin can follow the run remotely
report() { # stage message
  [ -n "$SERVER" ] || return 0
  post "$SERVER/api/scanner/log" "{\"stage\":\"$(json_str "$1")\",\"message\":\"$(json_str "$2")\",\"computer\":\"$(json_str "$(hostname)")\",\"os\":\"linux\"}" >/dev/null 2>&1
}

# ---- 1) Find the server ----
SERVER=""
log "Looking for the IT Asset Server..."
for u in "${SERVER_URLS[@]}"; do
  code=$(http_get_ok "$u/login.html")
  log "  $u -> HTTP ${code:-no answer}"
  if [ "$code" = "200" ]; then SERVER="$u"; break; fi
done
if [ -n "$SERVER" ]; then
  log "Using server: $SERVER"
  report "started" "Linux USB scanner started (log: $LOG)"
else
  log "No server answered - the scan will be saved offline."
fi

# ---- 2) Hardware scan (the full Linux scanner, in dry-run mode it prints the JSON) ----
# The scanner's own name prompt would be invisible inside $(...), so ask here
EMP_NAME="$(id -un 2>/dev/null)"
if [ -t 0 ]; then
  read -r -t 60 -p "Employee / user name [$EMP_NAME]: " _in && [ -n "$_in" ] && EMP_NAME="$_in"
  echo
fi
log "Scanning hardware for user: $EMP_NAME ..."
SCAN_OUT=$(IAM_KEY="$SERVER_KEY" bash "$KIT_DIR/linux/asset-scanner.sh" --dry-run --name "$EMP_NAME" 2>&1)
SCAN_RC=$?
echo "$SCAN_OUT" | grep -v '^{"userName"'
PAYLOAD=$(printf '%s\n' "$SCAN_OUT" | grep '^{"userName"' | tail -n 1)
log "Hardware scanner exit code: $SCAN_RC, payload: ${#PAYLOAD} bytes"
if [ -z "$PAYLOAD" ]; then
  log "ERROR: hardware scan produced no data. Full scanner output is above."
  report "error" "hardware scan produced no data (exit $SCAN_RC)"
  exit 1
fi
PAYLOAD="${PAYLOAD%\}},\"scannedAt\":\"$(date +%Y-%m-%dT%H:%M:%S)\",\"source\":\"usb-kit\"}"

COMP=$(hostname 2>/dev/null | tr -c 'A-Za-z0-9_-' '_')
FILE="${COMP}_$(date +%Y%m%d_%H%M%S).json"

# ---- 3) Send, or save offline ----
SENT=0
if [ -n "$SERVER" ]; then
  REPLY=$(post "$SERVER/api/assets/scan" "$PAYLOAD")
  log "Server reply: ${REPLY:0:300}"
  if printf '%s' "$REPLY" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then SENT=1; fi
fi

if [ "$SENT" = "1" ]; then
  printf '%s' "$PAYLOAD" > "$SENT_DIR/$FILE" 2>/dev/null
  echo "========================================================"
  echo "[SUCCESS] Sent to $SERVER"
  echo "Admin can now review it in the dashboard (Pending scans)."
  echo "========================================================"
  # Deliver scans saved earlier on computers without network
  for d in "$KIT_DIR/scans" "$HOME/arka-scans"; do
    for f in "$d"/*.json; do
      [ -e "$f" ] || continue
      R=$(post "$SERVER/api/assets/scan" "$(cat "$f")")
      if printf '%s' "$R" | grep -q '"success"[[:space:]]*:[[:space:]]*true'; then
        mkdir -p "$d/sent" 2>/dev/null; mv -f "$f" "$d/sent/" 2>/dev/null; log "   sent saved scan: $(basename "$f")"
      else
        log "   failed: $(basename "$f") -> ${R:0:200}"
      fi
    done
  done
else
  [ -n "$SERVER" ] && report "error" "server rejected the scan: ${REPLY:0:200}"
  # Offline = bench / workshop scan: the screen attached is only a test monitor, so it is left out
  OFFLINE=$(printf '%s' "$PAYLOAD" | sed 's/"monitors":"[^"]*"/"monitors":"","offline":true/')
  if printf '%s' "$OFFLINE" > "$SCAN_DIR/$FILE" 2>/dev/null; then
    echo "========================================================"
    echo "[SAVED] Not sent to the server. Saved to: $SCAN_DIR/$FILE"
    echo "It is sent automatically on the next run on a connected computer,"
    echo "or import it from the panel (Tools > Import USB scans)."
    echo "========================================================"
  else
    log "ERROR: could not save the scan to $SCAN_DIR"
  fi
fi
sync 2>/dev/null
