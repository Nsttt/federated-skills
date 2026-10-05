---
name: incident-response
description: Use when production is broken or customers report errors. Coordinates the first ten minutes of an incident.
allowed-tools: list_releases lookup_release list_teams
metadata:
  owner: platform
  contact: '#platform'
---

# Incident response

1. Open an incident channel and page on call, following the `on-call` skill.
2. Call `list_releases`. If a release went live in the last 24 hours, it is
   the first suspect: read its notes with `lookup_release`.
3. If the release is the cause, follow the `rollback` skill. Release
   Engineering owns it.
4. Call `list_teams` to find the team that owns the broken area and bring
   them into the channel.
5. Post a status update every 30 minutes until the incident is resolved.
