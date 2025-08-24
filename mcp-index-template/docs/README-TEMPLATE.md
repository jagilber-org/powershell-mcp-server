# Instruction Scaffolding Template

This directory was generated automatically.

Authoritative Sources:

- `../instructions/catalog.json` (single source of truth)
- `../instructions/gates.json` (policy gates)
- `INSTRUCTIONS.md` (GENERATED – never edit manually)

Update Flow:

1. Edit `catalog.json` (add/modify entries).
2. Run validation script (MCP tool or npm script) to enforce schema & style.
3. Run generation script to rebuild `INSTRUCTIONS.md`.
4. Commit: catalog + generated doc in same change.

Do not edit generated files directly; CI should fail if hashes drift.
