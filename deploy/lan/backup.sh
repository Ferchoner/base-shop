#!/bin/sh
# Daily backup of the local network server (T-331, ADR-0171): a pg_dump in custom format at BACKUP_HOUR, local time,
# into /backups, keeping the last BACKUP_KEEP_DAYS days. Restore: docs/LAN_SERVER.md.
set -eu

backup() {
  name="base-shop-$(date +%Y-%m-%d_%H%M).dump"
  # Written under a hidden name first, so an interrupted dump never looks like a good backup.
  if pg_dump --format=custom --file="/backups/.$name"; then
    mv "/backups/.$name" "/backups/$name"
    echo "backup: $name"
  else
    echo "backup: pg_dump failed" >&2
  fi
  find /backups -name 'base-shop-*.dump' -mtime +"$BACKUP_KEEP_DAYS" -delete
}

# One at start, so a new server has a backup from day one; then one a day at BACKUP_HOUR.
backup
while true; do
  # Until the next o'clock, so no hour is skipped.
  sleep $((3600 - $(date +%-M) * 60 - $(date +%-S)))
  if [ "$(date +%-H)" = "$BACKUP_HOUR" ]; then
    backup
  fi
done
