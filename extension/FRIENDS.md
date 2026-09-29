# Try Cyclone

For the current test, open the newest developer prerelease on the private [Cyclone GitHub Releases page](https://github.com/e24z/cyclone/releases). You need access to the repository. Download its `Cyclone-*-friends.zip`, unzip it, read `PRIVACY.md`, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select the unzipped `extension` folder containing `manifest.json`. A local agent with Chrome DevTools extension tools can handle installation and reloads. Keep the folder in place while using the unpacked extension. Each release tag and ZIP filename identifies the source commit. New builds must replace those files and reload the extension; Chrome does not automatically update an unpacked copy.

To have an agent do the update, say: **“Update Cyclone using `UPDATE-SKILL.md` from my Cyclone download or `.agents/skills/cyclone-update/SKILL.md` in the repo.”** The agent should fetch the latest developer release, preserve the installed extension path, reload it, and verify the version.

1. Install the test package using the step above. If you already have an unpacked Cyclone folder, replace that folder's contents with the new `extension` folder and reload Cyclone. A local agent with Chrome DevTools extension tools can handle the reload.
2. Open a LeetCode problem and click the Cyclone toolbar icon. Choose a local transcription model: **Base** is fastest, **Small** is recommended, and **Medium English** and **Large V3 Turbo** are experimental for more powerful GPUs. The model choice applies to your next recording. Read the upload notice and choose **Agree and start recording**. On the first attempt, grant microphone access using **Allow while visiting the site**.
3. Talk through your approach while you solve. Stop from the Cyclone popup, press **Alt+Shift+R**, or finish with **Submit**.
4. Chrome saves your raw session ZIP in `Downloads/Cyclone/Sessions`. Wait for the Cyclone `ASR` badge to clear; a report ZIP will appear in `Downloads/Cyclone/Reports`. Cyclone also uploads the report ZIP privately. Open the popup to see whether upload finished or is waiting to retry.
5. Unzip the report and take `README.md` to whichever model you use for coaching. You can ask it to review your attempt against the captured code and speech.

The first report with a model needs an internet connection to download its weights; larger models may take longer and need more memory. Cyclone processes your recording locally. If Small, Medium, or Turbo fails to load, Cyclone tries Base. The report records the requested and actual model. If speech transcription fails, the report still has your code and actions and explains the issue. Keep the raw ZIP on your own computer if you want to check the audio or try processing it again; there is no need to share it with the developer.

## Help improve Cyclone

To contribute to this test, tell us what the coach noticed that helped, what it missed, and whether Cyclone captured your attempt accurately. The report ZIP is automatically uploaded to private Cyclone storage and can be read by the developer. It contains your code, problem details, actions, and speech transcript. Your coaching conversation stays with your own model unless you choose to share it.

Keep the raw session ZIP unless we ask for it to investigate a capture or transcription problem. It includes your original microphone audio.
