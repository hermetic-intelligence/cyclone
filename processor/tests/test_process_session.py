import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from processor.process_session import compress_code_states, process, select_report_states


class ProcessorTest(unittest.TestCase):
    def test_compresses_only_repeated_adjacent_code(self):
        events = [
            {"type": "code", "tMs": 1, "code": "a"},
            {"type": "code", "tMs": 2, "code": "a"},
            {"type": "run", "tMs": 3},
            {"type": "code", "tMs": 4, "code": "b"},
            {"type": "code", "tMs": 5, "code": "a"},
        ]
        self.assertEqual([s["code"] for s in compress_code_states(events)], ["a", "b", "a"])

    def test_report_keeps_initial_state_and_last_state_before_pauses(self):
        states = [
            {"tMs": 0, "code": "initial"},
            {"tMs": 100, "code": "typing"},
            {"tMs": 200, "code": "first pause"},
            {"tMs": 5000, "code": "typing again"},
            {"tMs": 5100, "code": "final"},
        ]
        self.assertEqual(
            [s["code"] for s in select_report_states(states)],
            ["initial", "first pause", "final"],
        )

    def test_zip_processing_preserves_trace_and_writes_report_without_asr(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "capture"
            folder.mkdir()
            (folder / "session.json").write_text(json.dumps({"sessionId": "s1", "title": "Two Sum", "language": "python"}))
            raw_events = [
                {"tMs": 10, "type": "code", "code": "x = 1", "language": "python"},
                {"tMs": 20, "type": "code", "code": "x = 1", "language": "python"},
                {"tMs": 30, "type": "submit", "result": "Accepted"},
            ]
            (folder / "events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in raw_events))
            (folder / "audio.webm").write_bytes(b"audio")
            archive = root / "capture.zip"
            with zipfile.ZipFile(archive, "w") as zf:
                for path in folder.iterdir():
                    zf.write(path, f"capture/{path.name}")
            out = root / "out"
            process(archive, out)
            result = json.loads((out / "analysis.json").read_text())
            self.assertEqual(len(result["events"]), 3)
            self.assertEqual(len(result["codeStates"]), 1)
            self.assertEqual(len(result["reportCodeStates"]), 1)
            self.assertEqual(result["transcript"], [])
            report = (out / "report.md").read_text()
            self.assertIn("Two Sum", report)
            self.assertIn("Accepted", report)
            self.assertIn("Transcription was not requested", report)


if __name__ == "__main__":
    unittest.main()
