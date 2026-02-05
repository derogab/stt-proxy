# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Build all outputs (CJS, ESM, and types)
npm run build:cjs    # Build CommonJS output only
npm run build:esm    # Build ESM output only
npm run build:types  # Build type declarations only
```

## Test Commands

```bash
npm test              # Run all tests (unit + integration)
npm run test:unit     # Run unit tests only
npm run test:whisper  # Run Whisper.cpp integration tests only
npm run test:watch    # Run tests in watch mode
npm run test:coverage # Run tests with coverage report
```

**Important**: Always run `npm test` after making changes to verify nothing is broken. Tests are located in the `test/` folder.

Tests are written using Vitest and cover:
- Provider selection logic (Whisper.cpp priority)
- Error handling for all providers
- Audio transcription functionality
- API request formatting

## Architecture

This is a TypeScript npm package (`@derogab/stt-proxy`) that provides a unified interface for multiple STT providers. The entire implementation is in a single file: `src/index.ts`.

### Provider Selection

The `transcribe()` function automatically selects a provider based on environment variables in this priority order:
1. **Whisper.cpp** - if `WHISPER_CPP_MODEL_PATH` is set

### Build Output

The package builds to three output formats:
- `dist/cjs/` - CommonJS (for `require()`)
- `dist/esm/` - ES Modules (for `import`)
- `dist/types/` - TypeScript declarations

## Conventional Commits

This project follows [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages. Use these formats:

| Type       | Description                                      |
|------------|--------------------------------------------------|
| `feat`     | A new feature                                    |
| `fix`      | A bug fix                                        |
| `docs`     | Documentation only changes                       |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test`     | Adding missing tests or correcting existing tests |
| `chore`    | Changes to the build process or auxiliary tools  |
| `build`    | Changes that affect the build system or external dependencies |
| `perf`     | A code change that improves performance          |
| `ci`       | Changes to CI configuration files and scripts    |

**Examples:**
- `feat: add support for new STT provider`
- `fix: handle empty audio buffer edge case`
- `docs: update API reference in README`

**Breaking changes** should include `!` after the type: `feat!: change transcribe API signature`

## Proxy Collection

This package is part of a family of plug-and-play proxy packages:

- [`@derogab/llm-proxy`](https://github.com/derogab/llm-proxy) - LLM provider proxy
- [`@derogab/stt-proxy`](https://github.com/derogab/stt-proxy) - Speech-to-Text provider proxy (this package)

**Important:** When making changes, check related projects for consistency. Changes to shared patterns (API design, error handling, configuration) should be applied across all proxies where applicable
