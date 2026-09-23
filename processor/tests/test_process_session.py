import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from processor.process_session import build_episodes, compress_code_states, process, select_report_states


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

    def test_episodes_join_nearby_activity_and_preserve_source_indices(self):
        events = [
            {"type": "code", "tMs": 0, "code": "a"},
            {"type": "code", "tMs": 2500, "code": "b"},
            {"type": "code", "tMs": 2600, "code": "b"},  # Raw duplicate remains traceable.
            {"type": "code", "tMs": 2700, "code": "c"},
            {"type": "code", "tMs": 16000, "code": "d"},
            {"type": "run", "tMs": 16500, "result": "Wrong Answer"},
        ]
        speech = [
            {"startMs": 1000, "endMs": 2000, "text": "Try a dictionary"},
            {"startMs": 15000, "endMs": 15800, "text": "That index is wrong"},
            {"startMs": 30000, "endMs": 32000, "text": "Need another approach"},
        ]
        states = compress_code_states(events)
        self.assertEqual([state["eventIndex"] for state in states], [0, 1, 3, 4])
        episodes = build_episodes(events, states, speech)
        self.assertEqual(len(episodes), 3)
        self.assertEqual((episodes[0]["startMs"], episodes[0]["endMs"]), (0, 2700))
        self.assertEqual(episodes[0]["speech"], ["Try a dictionary"])
        self.assertIsNone(episodes[0]["codeBefore"])
        self.assertEqual(episodes[0]["codeAfter"], "c")
        self.assertEqual(episodes[0]["source"]["transcriptSegments"], [0])
        self.assertEqual(episodes[0]["source"]["codeStates"], [0, 1, 2])
        self.assertEqual(episodes[0]["source"]["eventIndices"], [0, 1, 2, 3])
        self.assertEqual(episodes[1]["codeBefore"], "c")
        self.assertEqual(episodes[1]["codeAfter"], "d")
        self.assertEqual(episodes[1]["actions"], [{"tMs": 16500, "type": "run", "result": "Wrong Answer"}])
        self.assertEqual(episodes[1]["source"]["codeBeforeState"], 2)
        self.assertEqual(episodes[1]["source"]["codeAfterState"], 3)
        self.assertEqual(episodes[2]["codeBefore"], "d")
        self.assertEqual(episodes[2]["codeAfter"], "d")
        self.assertEqual(episodes[2]["source"]["codeStates"], [])
        self.assertEqual(episodes, build_episodes(events, states, speech))

    def test_continuous_activity_splits_after_one_minute_with_prior_code(self):
        events = [{"type": "code", "tMs": time_ms, "code": str(time_ms)}
                  for time_ms in range(0, 70000, 5000)]
        episodes = build_episodes(events, compress_code_states(events), [])
        self.assertEqual(len(episodes), 2)
        self.assertEqual((episodes[0]["startMs"], episodes[0]["endMs"]), (0, 60000))
        self.assertEqual((episodes[1]["startMs"], episodes[1]["endMs"]), (65000, 65000))
        self.assertEqual(episodes[1]["codeBefore"], "60000")
        self.assertEqual(episodes[1]["codeAfter"], "65000")

    def test_zip_processing_preserves_trace_and_writes_report_without_asr(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "capture"
            folder.mkdir()
            (folder / "session.json").write_text(json.dumps({"sessionId": "s1", "title": "Two Sum", "language": "python", "problemStatement": "Return indices for two numbers."}))
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
            original_zip = archive.read_bytes()
            process(archive, out)
            self.assertEqual(archive.read_bytes(), original_zip)
            result = json.loads((out / "analysis.json").read_text())
            self.assertEqual(len(result["events"]), 3)
            self.assertEqual(len(result["codeStates"]), 1)
            self.assertEqual(len(result["reportCodeStates"]), 1)
            self.assertEqual(result["transcript"], [])
            agent = json.loads((out / "agent.json").read_text())
            self.assertEqual(agent["metadata"]["problemStatement"], "Return indices for two numbers.")
            self.assertEqual(agent["episodes"][0]["codeAfter"], "x = 1")
            self.assertEqual(agent["episodes"][0]["source"]["eventIndices"], [0, 1, 2])
            self.assertIn("Return indices for two numbers.", (out / "agent.md").read_text())
            report = (out / "report.md").read_text()
            self.assertIn("Two Sum", report)
            self.assertIn("Accepted", report)
            self.assertIn("Transcription was not requested", report)

    def test_process_emits_speech_and_code_in_same_episode(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "session.json").write_text(json.dumps({"title": "Example", "language": "python"}))
            (root / "events.jsonl").write_text(json.dumps({"tMs": 2000, "type": "code", "code": "answer = 1"}) + "\n")
            (root / "audio.webm").write_bytes(b"placeholder")
            with patch("processor.process_session.transcribe", return_value=([{"startMs": 1000, "endMs": 1800, "text": "Set answer"}], None)):
                process(root, root / "out", do_transcribe=True)
            agent = json.loads((root / "out" / "agent.json").read_text())
            episode = agent["episodes"][0]
            self.assertEqual(episode["speech"], ["Set answer"])
            self.assertEqual(episode["codeAfter"], "answer = 1")
            self.assertEqual(episode["source"]["transcriptSegments"], [0])
            self.assertEqual(episode["source"]["codeStates"], [0])


if __name__ == "__main__":
    unittest.main()
