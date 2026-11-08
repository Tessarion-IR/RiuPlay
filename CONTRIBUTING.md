# Contributing to RiuPlay

Thanks for helping. RiuPlay aims to be a welcoming, community-driven project.

## Ground rules
- Be respectful. See the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/), which applies here.
- By contributing, you agree that your contribution is licensed under **GPL-3.0-only**, the project license.
- Don't submit code copied from projects whose license is incompatible with GPL-3.0. If you port code from another project, name the source and its license in the PR and in a file header.
- Never commit secrets, personal data or user databases.

## Getting started
1. Install **Node.js 22 LTS or newer** and **Git** on Windows 10/11.
2. Fork the repo, then run `git clone`, `npm ci` and `npm run dev`.
3. Create a branch: `feat/<short-name>`, `fix/<short-name>` or `docs/<short-name>`.

## Before opening a pull request
```bat
npm run typecheck
npm test
npm run test:main
```
- Add or update tests for behaviour you change. Core logic belongs in `src/core` with a `*.test.ts` file beside it.
- Keep the layers clean: `core/` must not import Electron, the renderer must not import Node, and new IPC goes through `src/shared/ipc.ts` and `src/preload`.
- Validate untrusted data (anything from the network or from extensions) before using it.
- User-visible text goes in `src/renderer/src/locales/en.json`. Other languages may lag behind.
- Write clear commit messages. Use the imperative mood, with a short summary line and a body that explains why.

## Reporting bugs and requesting features
Use the issue templates. For bugs, include your Windows version, the RiuPlay version, steps to reproduce, and relevant lines from `%APPDATA%\RiuPlay\logs\riuplay.log` with any personal data removed.

## Extensions
Source extensions live in separate repositories, not in this one. See `docs/M1_EXTENSION_LIFECYCLE.md` (manifest, permissions and trust) and `docs/M2_SANDBOX.md` (what an extension can and cannot do at runtime).
