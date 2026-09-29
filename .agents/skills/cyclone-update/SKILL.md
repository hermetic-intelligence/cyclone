---
name: cyclone-update
description: Install or update Cyclone's unpacked Chrome extension from this repository's GitHub developer releases when a user asks an agent to update Cyclone.
---

# Update Cyclone

Cyclone's current developer distribution is the private `e24z/cyclone` repository, not its older Chrome Web Store draft. A push to `main` creates a `dev-<full commit SHA>` prerelease with a `Cyclone-<version>-<short SHA>-friends.zip` asset. CI adds a numeric build component to the extension's manifest version so Chrome can show which release is installed. The user needs repository access; never ask for a token in chat or change repository visibility to make an update work.

1. Inspect the current browser and any installed Cyclone extension. If recording or report transcription is active, wait for it to finish before replacing files or reloading. Do not reload an unsaved LeetCode tab.
2. Use `gh` to find the newest successful `dev-*` release in `e24z/cyclone`, inspect its tag and asset, and download that asset to a temporary directory. Verify the ZIP with `unzip -t`. The tag's full commit SHA and the asset's short SHA must agree. Extract it and confirm the contained `extension/manifest.json` names Cyclone and uses Manifest V3. Do not use a Store ZIP or an Actions artifact as the update source.
3. Keep a stable absolute unpacked-extension path. On first install, use a user-owned folder such as `~/.local/share/cyclone/extension`. For an existing unpacked installation, find its actual folder and replace that folder with the new `extension` contents, keeping a backup until the new build is verified. Do not switch the installed path or uninstall a working copy just to update it.
4. Prefer Chrome DevTools MCP `list_extensions`, `install_extension` for first install, `reload_extension` for an update, and `trigger_extension_action` to inspect the popup. Verify Cyclone is enabled and the expected manifest version appears. If those tools are unavailable, use available browser control; report a specific blocker only after attempting the agent-controlled path.
5. Report the release commit, installed version, and verification result. Delete the temporary download after success; keep the backup until verification succeeds. If verification fails, restore the previous folder and reload it.

An unpacked Chrome extension does not update itself when GitHub changes. This skill gives the user's agent the repeatable update procedure; it does not imply access to a friend's machine or GitHub account from another machine.
