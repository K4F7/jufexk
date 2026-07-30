import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import ocr_manifest


class ManifestOcrTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "Sheet").mkdir()
        (self.root / "Sheet" / "a.png").write_bytes(b"one")
        (self.root / "Sheet" / "b.png").write_bytes(b"two")
        files = {
            "Sheet/a.png": ocr_manifest.sha256_file(self.root / "Sheet" / "a.png"),
            "Sheet/b.png": ocr_manifest.sha256_file(self.root / "Sheet" / "b.png"),
        }
        (self.root / "manifest.json").write_text(
            json.dumps({"batch": "test", "status": "complete", "files": files}),
            encoding="utf-8",
        )
        self.out = self.root / "out"

    def tearDown(self):
        self.temp.cleanup()

    def test_hash_mismatch_stops_before_ocr(self):
        (self.root / "Sheet" / "a.png").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            ocr_manifest.run_manifest(
                self.root / "manifest.json", self.out, lambda _: ([], "x"), provider_probe=lambda: {}
            )

    def test_failure_isolated_and_success_resumes(self):
        calls = []

        def first(image):
            calls.append(image.name)
            if image.name == "b.png":
                raise RuntimeError("boom")
            return ([ocr_manifest.Token("ok", 0.9, [[0, 0], [1, 0], [1, 1], [0, 1]])], "cuda")

        summary = ocr_manifest.run_manifest(
            self.root / "manifest.json", self.out, first, provider_probe=lambda: {}
        )
        self.assertEqual(summary["counts"], {"completed": 1, "failed": 1})

        retried = []
        summary = ocr_manifest.run_manifest(
            self.root / "manifest.json",
            self.out,
            lambda image: retried.append(image.name) or ([], "cuda"),
            provider_probe=lambda: {},
        )
        self.assertEqual(retried, ["b.png"])
        self.assertEqual(summary["counts"], {"completed": 2, "failed": 0})

    def test_provider_evidence_is_written(self):
        with patch.object(ocr_manifest, "cuda_provider_evidence", return_value={"text_det": ["CUDAExecutionProvider"]}):
            summary = ocr_manifest.run_manifest(
                self.root / "manifest.json", self.out, lambda _: ([], "rapidocr CUDA")
            )
        self.assertEqual(summary["provider_evidence"]["text_det"][0], "CUDAExecutionProvider")

    def test_targeted_file_array_is_supported(self):
        manifest_path = self.root / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["files"] = [
            {"path": path, "sha256": sha256}
            for path, sha256 in manifest["files"].items()
        ]
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        summary = ocr_manifest.run_manifest(
            manifest_path, self.out, lambda _: ([], "cuda"), provider_probe=lambda: {}
        )

        self.assertEqual(summary["counts"], {"completed": 2, "failed": 0})

    def test_pages_only_shards_are_disjoint_and_do_not_aggregate(self):
        calls = []
        first = ocr_manifest.run_manifest(
            self.root / "manifest.json",
            self.out,
            lambda image: calls.append((0, image.name)) or ([], "cuda"),
            provider_probe=lambda: {},
            shard_count=2,
            shard_index=0,
            aggregate=False,
        )
        second = ocr_manifest.run_manifest(
            self.root / "manifest.json",
            self.out,
            lambda image: calls.append((1, image.name)) or ([], "cuda"),
            provider_probe=lambda: {},
            shard_count=2,
            shard_index=1,
            aggregate=False,
        )

        self.assertEqual(first["counts"], {"completed": 1, "failed": 0})
        self.assertEqual(second["counts"], {"completed": 1, "failed": 0})
        self.assertEqual(sorted(calls), [(0, "a.png"), (1, "b.png")])
        self.assertFalse((self.out / "summary.json").exists())
        self.assertFalse((self.out / "raw_ocr_tokens.jsonl").exists())

        final = ocr_manifest.run_manifest(
            self.root / "manifest.json",
            self.out,
            lambda _: self.fail("completed page should resume"),
            provider_probe=lambda: {},
        )
        self.assertEqual(final["counts"], {"completed": 2, "failed": 0})
        self.assertTrue((self.out / "summary.json").exists())
        self.assertEqual(len((self.out / "raw_ocr_tokens.jsonl").read_text(encoding="utf-8").splitlines()), 2)

    def test_invalid_shard_parameters_are_rejected(self):
        for shard_count, shard_index in ((0, 0), (2, -1), (2, 2)):
            with self.subTest(shard_count=shard_count, shard_index=shard_index):
                with self.assertRaisesRegex(ValueError, "shard"):
                    ocr_manifest.run_manifest(
                        self.root / "manifest.json",
                        self.out,
                        lambda _: ([], "cuda"),
                        provider_probe=lambda: {},
                        shard_count=shard_count,
                        shard_index=shard_index,
                        aggregate=False,
                    )


if __name__ == "__main__":
    unittest.main()
