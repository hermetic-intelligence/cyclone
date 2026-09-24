import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from processor.watch_downloads import STATUS_FILE, scan


class WatchDownloadsTest(unittest.TestCase):
    def make_capture(self, downloads: Path, name: str = "cyclone-test.zip") -> Path:
        archive = downloads / name
        with zipfile.ZipFile(archive, "w") as zf:
            zf.writestr("session.json", json.dumps({"title": "Two Sum", "problemStatement": "Find two indices."}))
            zf.writestr("events.jsonl", json.dumps({"type": "code", "tMs": 1200, "code": "return []"}) + "\n")
            zf.writestr("audio.webm", b"placeholder")
        return archive

    def test_only_new_downloads_are_processed_once_with_speech(self):
        with tempfile.TemporaryDirectory() as tmp:
            downloads = Path(tmp)
            archive = self.make_capture(downloads)
            cutoff = archive.stat().st_mtime_ns + 1
            with patch("processor.process_session.transcribe", return_value=([{"startMs": 1000, "endMs": 1500, "text": "Start with a list"}], None)) as transcribe:
                self.assertEqual(scan(downloads, since_ns=cutoff), (0, 0))
                os.utime(archive, ns=(cutoff + 1, cutoff + 1))
                self.assertEqual(scan(downloads, since_ns=cutoff), (1, 0))
                self.assertEqual(scan(downloads, since_ns=cutoff), (0, 0))
            self.assertEqual(transcribe.call_count, 1)
            output = downloads / "Reports" / archive.stem
            agent = json.loads((output / "agent.json").read_text())
            status = json.loads((output / STATUS_FILE).read_text())
            self.assertEqual(agent["episodes"][0]["speech"], ["Start with a list"])
            self.assertEqual(status["status"], "complete")
            self.assertIn("Find two indices.", (output / "agent.md").read_text())
            self.assertTrue(archive.is_file())

    def test_transcription_failure_is_visible_and_retryable(self):
        with tempfile.TemporaryDirectory() as tmp:
            downloads = Path(tmp)
            archive = self.make_capture(downloads)
            with patch("processor.process_session.transcribe", return_value=([], "model unavailable")) as transcribe:
                self.assertEqual(scan(downloads), (0, 1))
                self.assertEqual(scan(downloads), (0, 0))
                self.assertEqual(scan(downloads, retry_failed=True), (0, 1))
            self.assertEqual(transcribe.call_count, 2)
            status = json.loads((downloads / "Reports" / archive.stem / STATUS_FILE).read_text())
            self.assertEqual(status["status"], "failed")
            self.assertEqual(status["warning"], "model unavailable")


if __name__ == "__main__":
    unittest.main()
