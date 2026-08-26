---
name: domain-modeling
description: Sharpen domain language and boundaries without allowing product concepts to leak into the Woyengi kernel.
---

# domain-modeling

Use `/CONTEXT.md` only for stable vocabulary and distinctions. Put decisions in ADRs/specs.

Actively test whether two terms are being used for different concepts or one term for several concepts. In Woyengi, preserve at least:
- observation vs claim vs projected state;
- valid time vs transaction time;
- confidence vs authority;
- evidence vs provenance;
- computation/runtime effects vs semantic state changes vs external effects;
- platform kernel vs Domain Package.

Cross-check proposed vocabulary against code and canonical architecture. If a domain term is needed only by a product/environment, keep it in that domain package or spec rather than promoting it into the kernel.
