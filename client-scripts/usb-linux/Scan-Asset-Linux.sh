#!/usr/bin/env bash
# IT Asset Manager - USB kit for Linux
# Double-click "Scan-Asset-Linux.desktop" (or: bash Scan-Asset-Linux.sh).
# Sends the scan to the first server address that answers; without network the
# scan is saved in scans/ on the USB and delivered on the next connected run.

SERVER_URLS=("http://192.168.10.194:3000")
SERVER_KEY="SET-AUTOMATICALLY-ON-DOWNLOAD"

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCAN_DIR="$KIT_DIR/scans"
SENT_DIR="$SCAN_DIR/sent"
mkdir -p "$SENT_DIR" 2>/dev/null

echo "========================================================"
echo "  IT Asset Master - USB Hardware Scanner (Linux)"
echo "========================================================"

# Reuse the full Linux scanner for the hardware part; --dry-run prints the JSON payload as its last line
PAYLOAD=$(IAM_KEY="$SERVER_KEY" bash "$KIT_DIR/linux/asset-scanner.sh" --dry-run | tee /dev/stderr | grep '^{"userName"' | tail -n 1)
if [ -z "$PAYLOAD" ]; then
  echo "[ERROR] Hardware scan failed."
  read -r -t 30 -p "Press Enter to close..." _
  exit 1
fi
PAYLOAD="${PAYLOAD%\}},\"scannedAt\":\"$(date +%Y-%m-%dT%H:%M:%S)\",\"source\":\"usb-kit\"}"

post() { # url body
  if command -v curl >/dev/null 2>&1; then
    curl -sS -m 15 -X POST "$1/api/assets/scan" -H "Content-Type: application/json; charset=utf-8" \
      -H "X-IAM-Key: $SERVER_KEY" --data-binary "$2" 2>/dev/null | grep -q '"success"[[:space:]]*:[[:space:]]*true'
  else
    wget -qO- -T 15 --header="Content-Type: application/json; charset=utf-8" --header="X-IAM-Key: $SERVER_KEY" \
      --post-data="$2" "$1/api/assets/scan" 2>/dev/null | grep -q '"success"[[:space:]]*:[[:space:]]*true'
  fi
}

reachable() {
  if command -v curl >/dev/null 2>&1; then curl -s -m 5 -o /dev/null "$1/login.html"
  else wget -q -T 5 -O /dev/null "$1/login.html"; fi
}

SERVER=""
echo "[5/5] Looking for the IT Asset Server..."
for u in "${SERVER_URLS[@]}"; do
  if reachable "$u"; then SERVER="$u"; break; fi
done

COMP=$(hostname 2>/dev/null | tr -c 'A-Za-z0-9_-' '_')
FILE="${COMP}_$(date +%Y%m%d_%H%M%S).json"

if [ -n "$SERVER" ] && post "$SERVER" "$PAYLOAD"; then
  printf '%s' "$PAYLOAD" > "$SENT_DIR/$FILE"
  echo "========================================================"
  echo "[SUCCESS] Sent to $SERVER"
  echo "Admin can now review it in the dashboard (Pending scans)."
  echo "========================================================"
  # Deliver scans saved earlier on computers without network
  for f in "$SCAN_DIR"/*.json; do
    [ -e "$f" ] || continue
    if post "$SERVER" "$(cat "$f")"; then mv -f "$f" "$SENT_DIR/" && echo "   sent: $(basename "$f")"
    else echo "   failed: $(basename "$f")"; fi
  done
else
  # Offline = bench / workshop scan: the screen attached is only a test monitor, so it is left out
  OFFLINE=$(printf '%s' "$PAYLOAD" | sed 's/"monitors":"[^"]*"/"monitors":"","offline":true/')
  printf '%s' "$OFFLINE" > "$SCAN_DIR/$FILE"
  echo "========================================================"
  echo "[SAVED ON USB] Server not reachable from this computer."
  echo "Saved to: scans/$FILE"
  echo "It is sent automatically on the next run on a connected computer,"
  echo "or import it from the panel (Tools > Import USB scans)."
  echo "========================================================"
fi
sync 2>/dev/null
read -r -t 20 -p "Done. Press Enter to close..." _
