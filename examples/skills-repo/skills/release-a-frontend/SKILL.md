---
name: release-a-frontend
description: Release a frontend version through Zephyr environments. Use when asked to ship, promote or roll back a web app.
license: MIT
metadata:
  owner: platform
  contact: '#platform'
---

# Release a frontend

1. Check the [release gates](references/gates.md) are green.
2. Deploy with `ze-cli deploy`, then release the version to `staging`.
3. Promote the same version to `production` once staging looks healthy.

If anything goes wrong, use the `rollback-a-release` skill.
