# Management integration

This application owns `integration/`: its management profile, resource plan, setup contract and host-factory implementation. Management adopts a reviewed immutable copy with explicit static imports; it does not execute arbitrary registration code.

`node management/tooling/refresh-recipe.mjs` compiles the recipe from this application's current declared resources and SQL. Review changes and run source/behavior checks, then commit the integration before exporting it using management's `scripts/projects/integrations.mjs export` command with this checkout, repository identity and full commit SHA. Adoption receipts retain exact original paths and hashes. No publication or deployment is implied.
