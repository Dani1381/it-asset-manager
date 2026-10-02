# 📦 IT Asset Master

A modern, lightweight, self-hosted **IT Hardware & Asset Management System** designed for IT Managers and Sysadmins. 

Track every PC, monitor, laptop, and piece of IT equipment across your organization with **property IDs, full hardware specifications, device photos taken directly from your phone camera, printable QR code asset stickers, and automated Windows inventory scripts with Bale Messenger Bot alerts**.

---

## ✨ Features

- **📱 Mobile Camera Photo Capture**:
  - Open the inventory on your phone while walking through the office, warehouse, or server room.
  - Snap photos of devices, serial stickers, ports, or damage with a single tap.
  - Automatically resizes and optimizes high-res phone photos before uploading.
- **📦 Manage Old / Offline / Broken Equipment**:
  - For loose monitors, decommissioned computers, or spare parts where scripts cannot run, easily register them manually via the **"+ Add Device"** page.
- **🤖 Automated Windows PC Scanner (`.bat` / `.ps1`)**:
  - Employees or admins run a 5-second script on Windows PCs.
  - Automatically captures CPU, RAM, Disks, Free C: Space, GPU, Serial Number, OS, IP, and connected monitors.
  - Posts data directly into your central Web App and sends instant notifications to your **Bale Messenger Bot**!
- **🏷️ Printable QR Code Asset Stickers**:
  - Generate and print durable asset tags formatted for label printers or standard paper.
  - Contains Property ID, Company Name, Serial Number, and a QR code linking directly to the device profile.
- **🔍 Instant Live Search & Filters**:
  - Search by Property ID, Serial Number, User, Computer Name, IP, CPU, or Model.
  - Filter by category (*PCs, Laptops, Monitors, Printers, Network*) and status (*Active, In Storage, In Repair, Retired*).
- **💬 Bale Messenger Bot Integration**:
  - Sends immediate notifications whenever a new asset is scanned or registered.
  - Built-in Bale test button in Settings.
- **📥 One-Click CSV / Excel Export**:
  - Download your complete inventory anytime for audits and reporting.
- **⚡ Zero External Dependencies**:
  - Built with pure modern Node.js (`node:http`, `node:sqlite`).
  - No `npm install` hassles or native C++ compilation errors on Windows!

---

## 🚀 Quick Start (Windows)

### 1. Requirements
- [Node.js](https://nodejs.org) v18+ (Node 20, 22, or 24 recommended).

### 2. Start the Server
Double-click `run.bat` or run:
```cmd
cd it-asset-manager
node server.js
```

You will see:
```text
=======================================================
🚀 IT Asset Manager Server is running!
💻 Local Workstation: http://localhost:3000
📱 Mobile / LAN Access:
   👉 http://192.168.10.194:3000
📷 Camera ready: Open on your phone to snap photos
=======================================================
```

Open **`http://localhost:3000`** in your browser.

---

## 📱 How to Take Photos with Your Phone

1. Ensure your phone is connected to the same office Wi-Fi or local network as your server.
2. In the web dashboard on your computer, click **"📱 Mobile Link"**.
3. Point your phone camera at the QR code on your monitor to open the web app on your phone.
4. On any device card, tap the **📷** camera button to snap photos of:
   - The device itself
   - The serial number sticker on the back
   - The monitor model tag
5. Photos appear immediately in the web gallery and system profile.

---

## 🖥️ Automated PC Scanning (`AssetScanner.bat`)

For active employee computers:
1. Copy `client-scripts/AssetScanner.bat` to a shared network drive or USB flash drive.
2. Open `AssetScanner.bat` in Notepad and set your server's IP address:
   ```powershell
   $SERVER_URL = "http://192.168.10.194:3000"
   ```
3. Run `AssetScanner.bat` on any Windows computer.
4. It prompts for the employee's name, scans all hardware specifications, and:
   - Registers/updates the PC in IT Asset Master.
   - Assigns a Property ID (e.g. `AST-0001`).
   - Sends a report to your **Bale Bot**.
   - Appends to the local `system_specs.csv`.

---

## 🏷️ Adding Old Equipment & Monitors (Manual Entry)

For hardware that cannot run scripts (monitors, offline laptops, broken towers, printers):
1. Click **"+ Add Device"** in the top navigation.
2. Fill in:
   - **Property ID**: Auto-suggests the next number (e.g. `AST-0002`) or enter your custom code.
   - **Category**: Select `Monitor`, `PC`, `Laptop`, `Printer`, etc.
   - **Model & Serial Number**: Enter the information from the sticker on the device.
   - **Status**: Mark as `In Storage`, `Needs Repair`, or `Retired`.
   - **Photos**: Tap the photo upload area to snap pictures of the front and serial sticker.
3. Tap **Save Device**.

---

## 🐳 Docker Deployment (Optional)

Run as a Docker container on Linux or Windows:

```bash
docker compose up -d
```

The database and uploaded photos persist in the `./uploads` and `./inventory.db` directories.

---

## ⚙️ Configuration & Bale Messenger Settings

Click the **⚙️ Settings** icon in the dashboard to set:
- **Company Name**: Printed on your asset tag stickers.
- **Asset Tag Prefix**: Default prefix for numbering (e.g. `AST-`, `IT-`).
- **Bale Bot Token & Chat ID**: Automatically sends notifications to your Bale bot channel or chat.

---

## 🔐 Security & Access

- **Login is enforced by the server.** Every page, photo and API call needs a signed, HttpOnly session cookie (30 days). Passwords are stored as salted `scrypt` hashes.
- **Roles:** `viewer` accounts are read-only. Changing data, and reading settings, users, logs, backups and scanner downloads, is admin-only.
- **Default accounts:** `admin / admin` and `viewer / 123`. A red banner is shown to admins until the admin password is changed — change it before exposing the server to the internet.
- **Scanners** authenticate with a random scanner key that is embedded automatically when an admin downloads `AssetScanner.bat` / `asset-scanner.sh`. Scanners downloaded before this version must be downloaded again. Setting the `SITE_PASSWORD` environment variable adds a second accepted scanner key.
- **AI gateway (9Router):** set the address, API key and model in **Settings → 9Router** and press **Test connection**. Values are stored only in the server database (environment variables `NINE_ROUTER_URL`, `DANI_API_KEY`, `NINE_ROUTER_MODEL` are used as fallback); no key is stored in the code.
- Failed logins are rate-limited (10 attempts per 15 minutes per IP).

## 📁 Project Structure

```text
it-asset-manager/
├── server.js              # High-performance zero-dependency HTTP server & REST API
├── database.js            # SQLite database schema, auto-incrementing property IDs & queries
├── run.bat                # One-click Windows starter script
├── Dockerfile             # Container configuration
├── docker-compose.yml     # Docker compose service setup
├── public/
│   ├── index.html         # Main dashboard with search, filters, and stats
│   ├── add.html           # Manual entry form for old hardware & monitors
│   ├── asset.html         # Asset detail page, photo gallery, specs & sticker preview
│   ├── app.js             # Client-side logic & camera image compression
│   ├── qrcode.js          # Offline QR code generator for stickers
│   └── style.css          # Modern dark/light responsive CSS
├── client-scripts/
│   ├── AssetScanner.bat   # Enhanced batch script for Windows clients
│   └── Scan-Asset.ps1     # Pure PowerShell script for enterprise deployment
└── uploads/               # Stored device photos
```

---

## 📄 License

MIT License. Free for commercial and personal use.
