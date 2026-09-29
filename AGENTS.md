# Cyclone agent workflow

Keep technical explanations readable in paragraphs. Use tables for comparisons and simple Mermaid diagrams for processes.

## Extension development

Handle extension builds, installation in isolated test browsers, reloads, and verification for the developer. Do not make the developer use Chrome's Load unpacked or Reload controls for routine work.

For interactive development, run `bun run build` from `extension/`, then use Chrome DevTools MCP `install_extension` with the absolute `extension/dist` path for the first installation. After subsequent builds, use `reload_extension` with the installed extension ID, then `trigger_extension_action` to exercise the popup. Use `list_extensions` to check installation and version. This is the official agent development workflow: https://developer.chrome.com/docs/devtools/agents/extensions . Prefer these purpose-built tools over automating the extensions menu.

After changing extension code, run the checks relevant to the change: `bun run typecheck`, `bun run test:reports`, and `bun run smoke` from `extension/`. The smoke script builds and loads Cyclone in an isolated Chromium profile without touching the developer's Chrome tabs.

For a live signed-in LeetCode check in the developer's Chrome, inspect the current browser state first. Do not reload an active recording, report, or unsaved code. Use the available computer-use tools to reload the extension and the LeetCode tab when safe. If browser control is unavailable, report the specific blocker rather than asking the developer to operate Chrome's extension menu.

## Friend releases

Use the unpacked developer build for the current friends test. Run `bun run package:friends` to prepare the ZIP; it contains an `extension` directory to install. Each push to `main` creates a commit-tagged GitHub prerelease and attaches that ZIP. Friends need access to this private repository. Unpacked installations require replacing the files and reloading the extension; handle that through Chrome DevTools MCP where available. The older unlisted Chrome Web Store 0.2.0 submission is pending review and is not the current test release. Do not submit Store updates unless the user chooses that path again.
