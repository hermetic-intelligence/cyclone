# Chrome Web Store listing — Cyclone DSA Capture

Last updated: 29 September 2026. Chrome Web Store item `ackegdhohpiodeobjabbefnhapibchji` was submitted for review and now shows **Pending review**. It is set to publish automatically after approval.

The submitted 0.2.0 package and listing below are historical. The current 0.3.3 friends build is distributed as an unpacked extension, with a two-file report (`README.md` and `timeline.json`) and opt-in private report upload. Store updates are not the active development path. Automatic publication of the old unlisted 0.2.0 package remains enabled in the dashboard until changed there.

## Store listing

**Name:** Cyclone DSA Capture

**Short description:** Record a LeetCode practice attempt and create a local report to review with your own AI coach.

**Detailed description:**

Cyclone records a LeetCode practice attempt and turns it into a report you can review with the AI coach of your choice.

Start recording on a LeetCode problem, talk through your approach, and work in the code editor. Cyclone captures your microphone audio, code changes, the problem statement, and visible Run and Submit results. Stop when you finish, or let Cyclone stop after Submit.

Cyclone saves two ZIP files to your computer: the original recording and events, and a report containing a readable timeline plus `agent.md` for your coaching model. Speech is transcribed on your computer when Chrome can use WebGPU. If transcription is unavailable, the report still includes code and actions, and the original audio remains available.

Cyclone does not provide or charge for a coaching model. It does not upload your audio, code, or report to a Cyclone server. The speech model is downloaded on first use. Recording starts only when you ask it to.

**Category:** Education (saved in the dashboard).

**Single purpose:** Capture one LeetCode problem-solving attempt and prepare a local report for review.

**Primary language:** English

## Graphics

| Asset | File | Status |
| --- | --- | --- |
| 128 × 128 store icon | `extension/icons/icon-128.png` | Uploaded to the Store draft; included in the package |
| 1280 × 800 screenshot of extension in use | `extension/store-assets/screenshot-1.png` | Uploaded to the Store draft and accepted |

The screenshot uses a clearly labelled demo problem page. It shows Cyclone's actual recording indicator without a user's private code or account details. Regenerate it with `bun run screenshot:store` from `extension/` after a visible UI change.

## Permission justifications

| Permission or host | Why Cyclone needs it |
| --- | --- |
| `storage` | Remember recording and report-download state across background worker restarts, and show an error if saving fails. |
| `offscreen` | Record microphone audio and create the report without keeping a visible tab open. |
| `downloads` | Save the raw session ZIP and the report ZIP to the user's computer. |
| `alarms` | End a recording shortly after Submit if LeetCode does not display a result. |
| `leetcode.com` and subdomains | Read the problem statement, visible editor state, and Run/Submit results only on LeetCode problem pages during a user-started recording. |
| `huggingface.co` and `*.hf.co` | Download the speech model weights and support files for local transcription. No session content is sent with these requests. |
| `dalyamgpwkllgwwfywpq.supabase.co` (0.3.0 test build) | Create an anonymous private upload identity and upload completed report ZIPs for developer feedback. Raw audio is not uploaded. |

The extension also uses `wasm-unsafe-eval` to run the ONNX WebAssembly runtime bundled in the package. JavaScript and WebAssembly code are packaged with Cyclone; model weights are downloaded separately.

## Privacy and data use

Cyclone handles microphone audio, user-written code, the problem URL and statement, timestamps, and observed Run/Submit actions and results. It stores these on the user's device for capture and report creation, then saves the two ZIP files locally. The developer does not receive session data. There is no analytics, advertising, account system, or server-side transcription. The user may independently share the report with a model of their choice.

The Chrome Web Store privacy form discloses locally handled web history (the problem URL), user activity, and website content (including code and voice recording). Cyclone does not transmit session data off-device, sell it, use it for unrelated purposes, or use it for creditworthiness. These disclosures and the permission justifications were saved in the dashboard on 26 September 2026.

**Privacy policy URL:** https://gist.github.com/e24z/ffcfffe5b0797a10648fe3596b55ba02 . `PRIVACY.md` is the source text; update the public page if that file changes.

The text above describes the submitted 0.2.0 Store build. The 0.3.0 test build uploads report ZIPs after popup disclosure and is documented in `PRIVACY.md`. Before submitting 0.3.0 to the Store, update the public policy URL, listing copy, and Store data-use disclosures to match. Do not treat the current public page as the policy for 0.3.0.

## Distribution

**Visibility:** Unlisted, saved in the dashboard on 26 September 2026. Anyone with the Store link can install it. Chrome Web Store review is required.

**Regions:** All regions. The extension is marked free of charge with no in-app purchases.

## Publisher and support

**Publisher name:** enochxxiv. Developer registration verified complete on 25 September 2026.

**Publisher ID:** `437a3f7c-73eb-497a-866a-3fc176a7435c`

**Account setup:** Non-trader saved and verified in publisher settings. The approved public contact address is verified in the publisher dashboard.

**Contact email:** prefect.bears.6y@icloud.com (iCloud Hide My Email; approved for public support and privacy contact).

**Support:** prefect.bears.6y@icloud.com

## Version history

| Version | Date | Changes | Status |
| --- | --- | --- | --- |
| 0.2.0 | 24 September 2026 | Local WebGPU transcription and report creation in the extension | Pending review; submitted 29 September 2026 |
| 0.3.0 | 29 September 2026 | Private automatic report upload for friends' test build | Built locally; not submitted to Store |
| 0.3.1 | 29 September 2026 | Try Whisper Small English locally with Base English fallback | Built locally; not submitted to Store |
| 0.3.2 | 29 September 2026 | Choose Base, Small, experimental Medium English, or experimental Large V3 Turbo in the popup | Built locally; not submitted to Store |
| 0.3.3 | 29 September 2026 | Replace four overlapping report files with a chronological README and complete timeline JSON; retire the local Python watcher | Friends package only; not submitted to Store |

## Review notes

The package is built with `bun run package:store` from `extension/`. It includes the bundled runtime and excludes tests, development dependencies, and the friend instructions. Model weights are downloaded after installation; Chrome's extension AI guidance says models are not remote-hosted code. The first report needs internet access for that download. WebGPU success and transcript quality on friends' computers are untested. The live signed-in LeetCode Submit path remains untested.

The Store dashboard shows the 0.2.0 package, accepted icon and screenshot, saved listing and privacy disclosures, and free and unlisted distribution. The public privacy URL and publisher contact were verified. Google confirmed submission on 29 September 2026, and the dashboard now shows **Pending review**. Automatic publication after approval was selected. Submitting an update later requires a higher manifest version, review, and publication; Git pushes alone do not update installed extensions.

## Build automation

`.github/workflows/extension-package.yml` checks and packages the extension on pushes to `main` and manual dispatch. On pushes to `main`, it also creates an immutable GitHub prerelease with a commit-tagged unpacked ZIP. It does not upload or submit to Chrome. The older Store package command remains available for a deliberate future release; each such update needs a higher manifest version and review.
