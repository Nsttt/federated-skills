---
name: rollback-a-release
description: Roll an environment back to its previous version. Use when a release breaks production.
metadata:
  owner: platform
  contact: '#platform'
---

# Roll back a release

1. Find the previous version of the app in the environment's history.
2. Release that version to the environment; it serves immediately.
3. Post the rollback in `#incidents` with the version you rolled back from.
