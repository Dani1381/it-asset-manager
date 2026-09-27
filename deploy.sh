#!/bin/bash
# One-Click Deployment Script for IT Asset Manager
# Works on Ubuntu / Debian / CentOS / Alpine

set -e

echo "=================================================="
echo "🚀 Deploying IT Asset Manager Server..."
echo "=================================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs || yum install -y nodejs
fi

# Ensure uploads directory exists
mkdir -p uploads

# Create Systemd Service
echo "Configuring Systemd service 'it-asset-manager'..."
cat << 'EOF' > /etc/systemd/system/it-asset-manager.service
[Unit]
Description=IT Asset Manager Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/it-asset-manager
ExecStart=/usr/bin/node /opt/it-asset-manager/server.js
Restart=always
RestartSec=5
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable it-asset-manager
systemctl restart it-asset-manager

echo "=================================================="
echo "✅ Deployment Successful!"
echo "Server is running on port 3000"
echo "Check status: systemctl status it-asset-manager"
echo "=================================================="
