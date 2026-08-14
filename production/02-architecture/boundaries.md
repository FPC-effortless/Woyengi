# Runtime boundaries

The first deployment is a modular monolith with two processes: Platform API and Platform Worker. `services/*/index.ts` is the only public service import surface. Packages remain in-process modules; internal HTTP calls are prohibited. PostgreSQL, object storage, and search are replaceable persistence adapters, while the canonical ledger remains replayable.
