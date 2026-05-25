#!/bin/bash
set -e

# Allow overriding cron schedule/timezone from environment.
CRON_SCHEDULE="${PAPER_SYNC_CRON:-0 0 * * 6}"
CRON_TZ="${TZ:-UTC}"

# Create cron job log
mkdir -p /var/log
touch /var/log/paper-sync.log

# Setup cron job for paper sync (default: Saturday 00:00 UTC)
printf "CRON_TZ=%s\n%s cd /app && python main.py >> /var/log/paper-sync.log 2>&1\n" "$CRON_TZ" "$CRON_SCHEDULE" | crontab -

# Log startup
echo "[$(date)] Paper sync scheduler started. Schedule: $CRON_SCHEDULE TZ: $CRON_TZ" >> /var/log/paper-sync.log

# Start cron in foreground
exec cron -f
