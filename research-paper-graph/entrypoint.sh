#!/bin/bash
set -e

# Create cron job log
mkdir -p /var/log
touch /var/log/paper-sync.log

# Setup cron job: Saturday at midnight UTC
# 0 0 * * 6 = every Saturday at 00:00
echo "0 0 * * 6 cd /app && python main.py >> /var/log/paper-sync.log 2>&1" | crontab -

# Log startup
echo "[$(date)] Paper sync scheduler started. Scheduled for Saturdays at 00:00 UTC" >> /var/log/paper-sync.log

# Start cron in foreground
exec crond -f
