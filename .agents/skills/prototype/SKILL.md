---
name: prototype
description: Build a disposable prototype that answers one explicit question without contaminating production state.
---

# prototype

State the single question before writing code.

Prototype categories:
- logic/mechanism;
- state/environment semantics;
- UI/interaction.

Constraints:
- isolate on a prototype branch or scratch area;
- do not use production credentials or durable canonical data;
- do not create irreversible external effects;
- surface internal state/events needed to evaluate the question;
- make the prototype trivial to run;
- record what would have to change for productionization.

A prototype can answer feasibility or expose design risk. It is not evidence that production architecture, security, replay, migration, or verification requirements are solved.
