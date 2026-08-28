---
name: ponytail-debt
description: Harvest deliberate `ponytail:` simplification comments into a read-only debt ledger.
---
# ponytail-debt
Search language-appropriate source comments for `ponytail:` excluding VCS/dependency/build output. One row: `<file>:<line>, <simplification>. ceiling: <limit>. upgrade: <trigger/path>.` Missing trigger -> `no-trigger`; optional ownership from blame/history. End with `<N> markers, <M> with no trigger.` None: `No ponytail: debt. Clean ledger.` Persist a ledger only when explicitly requested.
