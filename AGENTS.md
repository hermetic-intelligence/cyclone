# Cyclone agent workflow

Keep technical explanations readable in paragraphs. Use tables for comparisons and simple Mermaid diagrams for processes.

For a user's first installation or update, follow the Friend releases section. The Extension development section is for changing and testing source code.

## Extension development

Handle extension builds, installation in isolated test browsers, reloads, and verification for the developer. Do not make the developer use Chrome's Load unpacked or Reload controls for routine work.

For interactive development, run `bun run build` from `extension/`, then use Chrome DevTools MCP `install_extension` with the absolute `extension/dist` path for the first installation. After subsequent builds, use `reload_extension` with the installed extension ID, then `trigger_extension_action` to exercise the popup. Use `list_extensions` to check installation and version. This is the official agent development workflow: https://developer.chrome.com/docs/devtools/agents/extensions . Prefer these purpose-built tools over automating the extensions menu.

After changing extension code, run the checks relevant to the change: `bun run typecheck`, `bun run test:reports`, and `bun run smoke` from `extension/`. The smoke script builds and loads Cyclone in an isolated Chromium profile without touching the developer's Chrome tabs.

For a live signed-in LeetCode check in the developer's Chrome, inspect the current browser state first. Do not reload an active recording, report, or unsaved code. Use the available computer-use tools to reload the extension and the LeetCode tab when safe. If browser control is unavailable, report the specific blocker rather than asking the developer to operate Chrome's extension menu.

## Friend releases

When a user asks to install or update Cyclone after cloning this repository, read `.agents/skills/cyclone-install/SKILL.md` and follow it. Prefer the prebuilt developer release: friends should not have to install Bun or build the extension. Changes to `extension/` or the release workflow on `main` create a commit-tagged GitHub prerelease; README and skill changes alone do not. Users need access to this private repository. For a local development package, run `bun run package:friends` from `extension/`.
