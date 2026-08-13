# Agent Guide

Read `CONSTITUTION.md`, `prd.json`, `progress.txt`, and `research.md` before changing code.

## Delivery loop

1. Choose the highest-priority ticket with no unresolved blockers.
2. Announce the ticket.
3. Add one failing public-behavior test.
4. Make the smallest implementation pass.
5. Refactor while green and run the complete suite.
6. Append the result and commands to `progress.txt`.
7. Keep `passes` false until automated checks pass and a human confirms acceptance.

## Boundaries

- Keep canonical records immutable and append-oriented.
- Keep valid time separate from transaction time.
- Do not add product-specific entities or predicates to kernel packages.
- Keep storage, search, graph, and model providers behind ports.
- Do not let confidence substitute for authority.
- Do not hide conflicts in projections.
- Use explicit `.ts` extensions in runtime ESM imports.
- Avoid TypeScript syntax that requires code generation while source runs through Node type stripping.
