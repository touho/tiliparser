# tiliparser: project guide

## Folder structure

- `src/` — TypeScript source
    - `src/web/` — Svelte 5 UI (main app at `App.svelte`)
    - `src/core/` — parsing/analysis/recurring logic shared by UI + CLI
- `src/parsers/` — bank-specific CSV parsers
    - `src/cli/` — command-line entry (runs core logic via `tsx`)
- `samples/` — example CSV files used by the dev server
- `dist/` — Vite build output
- `legacy/` — older implementation kept for reference
- `index.html` — Vite HTML entry

## Technology

- Svelte 5 + TypeScript UI built with Vite
- ECharts + `svelte-echarts` for charts
- `@svar-ui/svelte-*` for UI components
- CLI uses `tsx` to run `src/cli/index.ts`

## Parsers

If a bank parser is missing, add a new one in `src/parsers/` and wire it into the parser selection.

## Commands

- `npm run dev` — start Vite dev server
- `npm run build` — production build
- `npm run preview` — preview production build
- `npm run cli` — run CLI parser
- `npm run format` — run Prettier across the repo
- `npm run typecheck` — run TypeScript typecheck
