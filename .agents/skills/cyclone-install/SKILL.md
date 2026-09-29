---
name: cyclone-install
description: Install or update the Cyclone Chrome extension for a user who asks to set up Cyclone, install it from the repository, or get the latest developer build.
compatibility: Requires access to the private e24z/cyclone GitHub repository and desktop Chrome 120 or newer. Agent-controlled Chrome extension tools are preferred.
---

# Install or update Cyclone

This skill lives in the Cyclone source repository. If the user asked you to clone Cyclone and install it, clone `e24z/cyclone` with their existing GitHub access, then follow this file. `AGENTS.md` points here so the workflow can be found even if your agent does not discover newly cloned skills during the same turn. The Vercel Skills CLI may install this skill into an agent, but that installs instructions only; it does not install the Chrome extension.

## Get a build

Read the repository's `README.md`, `PRIVACY.md`, and `LICENSE` before first installation. Prefer the newest completed `dev-<full commit SHA>` prerelease from `e24z/cyclone`; CI has already built its `Cyclone-<version>-<short SHA>-friends.zip`. Use authenticated `gh` or Git to access the private repository without exposing credentials. Download the ZIP to a temporary directory, verify it with `unzip -t`, and check that its short SHA matches the tag. Extract it and confirm `extension/manifest.json` names Cyclone, uses Manifest V3, and has a Chrome-compatible version. Friends normally do **not** need Bun or a local build.

If there is no developer release yet, check whether the release workflow has run successfully on `main` and explain what is missing. Only build from source when the user specifically wants that unreleased checkout: run `bun install --frozen-lockfile` and `bun run build` from `extension/`, then use the absolute `extension/dist` path.

## Install in Chrome

Inspect the target Chrome profile and any installed Cyclone extension. Wait for active recording or report transcription to finish; do not reload a LeetCode tab with unsaved code. For a first installation, put the unpacked `extension` directory at a stable user-owned path such as `~/.local/share/cyclone/extension`. For an update, find the existing unpacked path, stage the new contents, and keep a backup until verification passes. Reuse the same installed path so the extension ID remains stable.

Prefer Chrome DevTools MCP `list_extensions`, `install_extension`, `reload_extension`, and `trigger_extension_action`. Check that these tools control the user's intended Chrome profile rather than an isolated test browser. If they are unavailable, use available computer-control tools to install or reload the unpacked extension. Ask the user to use Chrome's Load unpacked control only when no agent-controlled path is available, and explain that blocker.

Compare Chrome's installed version with the downloaded manifest and check the popup. Report the release commit, version, profile verified, and whether installation or reload succeeded. If verification fails, restore the backup and reload the previous version. Clean up temporary downloads after success.

An unpacked extension does not update when GitHub changes. The user can ask an agent to run this skill again; the agent should not infer that a source push changed an installed copy.
