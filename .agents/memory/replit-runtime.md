---
name: Replit runtime constraints
description: Why the imported package-manager pin was changed
---

Use the environment-compatible pnpm 10 pin until a runtime upgrade is explicitly tested.

**Why:** The imported pnpm 11 pin made the environment's pnpm recursively attempt to install itself and fail. The branch's pnpm 10 pin installed the unchanged lockfile successfully.

**How to apply:** Check the installed pnpm before bumping the package-manager pin; do not let an import restore the incompatible pin.

