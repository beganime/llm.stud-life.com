# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the React/Vite client. Page-level features live in `src/pages/`, shared shell and modal components in `src/components/`, and browser/API helpers in `src/lib/`. Shared client types are defined in `src/types.ts`; global styling is in `src/styles.css`.

`server/` contains the Express API, SQLite access, authentication/cryptography, and provider adapters. Keep provider-specific streaming behavior in `server/providers.ts` rather than route handlers. Tests use the `*.test.ts` suffix beside server modules. Runtime SQLite files are created under `data/` and must remain untracked.

## Build, Test, and Development Commands

- `npm install`: install all client and server dependencies.
- `npm run dev`: run Vite on port 5173 and the API on port 3001 with reload.
- `npm test`: run Node's test runner through TypeScript.
- `npm run check`: type-check client and server projects.
- `npm run build`: type-check and generate the production client in `dist/client`.
- `npm start`: serve the API and an existing production client build.

Copy `.env.example` to `.env` before local development.

## Coding Style & Naming Conventions

Use TypeScript with strict checking, two-space indentation, semicolons, and single quotes in TypeScript. Use `PascalCase` for React components and exported types, `camelCase` for functions and variables, and descriptive route/resource names. Keep components focused; move reusable network or storage behavior into `src/lib/`. Run `npm run check` before committing.

## Testing Guidelines

Use `node:test` and `node:assert/strict`. Name tests after observable behavior, for example `parallel provider failures do not cancel a successful stream`. Mock external model APIs; never use real credentials in tests. Cover streaming parsing, cost calculations, authentication boundaries, and failure isolation when changing those areas.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects such as `Add Gemini streaming adapter`. Keep commits focused and exclude `.env`, `data/`, generated `dist/`, and API keys. Pull requests should describe the user-visible change, list verification commands, link relevant issues, and include screenshots for UI changes. Call out schema, configuration, security, or provider API changes explicitly.

## Security & Configuration

Never log or persist plaintext provider keys. Account keys must pass through the encryption helpers; guest keys remain memory-only. Preserve the server-side provider boundary and require explicit consent before sending content to an evaluator model.
