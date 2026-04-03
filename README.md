# Diff Checker

Text diff checker with side-by-side comparison, inline word-level highlighting, line numbers and unified diff output. Client-side only.

**Live:** https://gmowses.github.io/diff-checker

## Features

- Side-by-side diff view with line numbers
- Added lines (green), removed lines (red), changed lines (yellow)
- Word-level inline highlighting on changed lines
- Unified diff output (git-style) with copy button
- Diff statistics: added / removed / changed / unchanged lines
- Swap and Clear actions
- LCS-based line diff algorithm — no external library
- Dark / Light mode (auto-detect from system preference)
- i18n: English and Portuguese (BR, auto-detect from browser)

## Tech

- React 19 + TypeScript
- Tailwind CSS v4
- Vite
- Lucide React icons

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Static files are generated in `dist/`.

## License

[MIT](LICENSE) -- Gabriel Mowses
