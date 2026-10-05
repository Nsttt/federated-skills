---
name: release-checklist
description: Use when preparing, approving or shipping a release. Walks through the release gates and checks the release with the releases tools.
allowed-tools: list_releases lookup_release
metadata:
  owner: release-engineering
  contact: '#release-eng'
---

# Release checklist

1. Call `list_releases` to see what is live and what is staged.
2. Call `lookup_release` with the version you are about to ship and read its
   notes.
3. Go through every gate in `references/gates.md`. Stop at the first gate that
   fails and report it.
4. When every gate passes, summarize the release in three lines: version,
   what changes for users, and the rollback plan.
