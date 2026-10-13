# RapidInsightStudio — AI/Developer Working Agreement (AGENT.md)

---

## 1. Operating Principles & Working Rules

1. **Analyze before modifying:** Thoroughly inspect existing code, dependencies, and configuration before authoring code changes.
2. **Do not introduce unnecessary technologies:** Use existing libraries, frameworks, and patterns already established in the codebase.
3. **Follow the existing architecture:** Honor the 9-microservice topology, API Gateway proxying, and internal service key contracts unless there is a formal architectural decision to revise them.
4. **Do not invent credentials:** Never fake API keys, secrets, or database connection strings. Use `.env.example` templates and notify the developer of required variables.
5. **Never commit secrets:** Never hardcode passwords, Supabase service role keys, or LLM tokens into source code, logs, tests, or documentation.
6. **Keep frontend/backend contracts synchronized:** Ensure endpoint paths, HTTP verbs, and payload schemas match exactly between client API clients and backend controllers.
7. **Update documentation when architecture changes:** Update `PRD.md`, `ARCHITECTURE.md`, `DESIGN.md`, and `MEMORY.md` immediately upon approved modifications.
8. **Test changes before declaring completion:** Verify that builds pass, services start, and endpoints respond.
9. **Do not modify unrelated functionality:** Keep edits localized to targeted bug fixes or approved features.
10. **Ask for approval before major architectural changes:** STOP and solicit user consent before commencing new subsystems (e.g., Catalog Service).
11. **Maintain backward compatibility:** Preserve existing database tables, routes, and UI flows unless explicit migration approval is granted.
12. **Keep changes small and traceable:** Maintain atomic, easily verifiable code diffs.

---

## 2. Development Commands & Operations

### 2.1 Backend Commands
All backend commands run with `--prefix backend` from the `RapidInsight-Backend` directory or via root npm:
```bash
# Install all backend dependencies across all services:
npm run postinstall --prefix backend

# Setup Python SDV environment:
npm run setup:sdv --prefix backend

# Start all backend services concurrently (Gateway, Project, Schema, Table, Datagen, AI, SDV):
npm run dev --prefix backend

# Start SDV service independently:
npm run dev:sdv --prefix backend

# Health check SDV service:
npm run check:sdv --prefix backend
```

### 2.2 Frontend Commands
Run from the `RapidInsight-Frontend` directory:
```bash
# Install frontend dependencies:
npm install

# Start Vite development server (Port 3006):
npm run dev

# Build production bundle:
npm run build

# Preview production build:
npm run preview
```

---

## 3. Directory Conventions

- `RapidInsight-Frontend/`:
  - `src/components/`: Reusable React components organized by feature (`tables`, `reports`, `schema`, `playground`, `layout`).
  - `src/pages/`: Route-level container components.
  - `src/api/`: Typed HTTP request clients using `apiRequest` wrapper.
  - `src/context/`: React context providers (`AuthContext`, `ThemeContext`, `ProjectRefreshContext`).
- `RapidInsight-Backend/backend/`:
  - `services/<service-name>/`: Isolated microservice packages with their own `package.json`, `.env.example`, and `src/`.
  - `scripts/`: Cross-service orchestrators (`setup-sdv.js`, `run-sdv.js`, `resolve-sdv-python.js`).
  - `migrations/`: Idempotent SQL schema migrations.
