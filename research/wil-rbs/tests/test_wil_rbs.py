import copy
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from wil_rbs import ContractError, compare, validate  # noqa: E402

H = "a" * 64
J = "b" * 64
K = "c" * 64
U = "d" * 64


def run(rid, arm, size=100_000, seed=1):
    return {"kind": "run", "id": rid, "project_id": "language", "study_id": "baseline-001",
            "arm_id": arm, "seed": seed, "source_commit": "a" * 40,
            "checkpoint_sha256": H, "model": {"family": arm, "trainable_parameters": size, "deployed_parameters": size, "config_sha256": H},
            "data": {"dataset_id": "fixture", "dataset_sha256": H, "train_split_sha256": J,
                     "sample_order_sha256": K, "target_contract_sha256": U, "tokenizer_sha256": H, "preprocessing_sha256": J, "target_unit": "byte",
                     "train_exposure_units": 1024, "context_length": 128},
            "training": {"optimizer": "AdamW", "updates": 4, "optimizer_contract_sha256": H,
                         "tuning_policy_sha256": J, "selection_policy_sha256": K},
            "resources": {"wall_seconds": 1.5, "flop_budget": 10000,
                          "training_flops": {"value": 9999, "method": "measured_profiler", "scope": "end_to_end_training", "receipt_ref": "https://example.org/receipt"}},
            "evidence": {"level": "independently_verified", "refs": ["https://example.org/log"]}}


def evaluation(eid, rid, value):
    return {"kind": "evaluation", "id": eid, "run_id": rid, "project_id": "language", "study_id": "baseline-001",
            "checkpoint_sha256": H, "metric": {"name": "nll", "unit": "nat/byte", "direction": "min", "split": "test",
                                                   "value": value, "target_count": 512, "target_sha256": H,
                                                   "evaluator_sha256": J},
            "evidence": {"level": "independently_verified", "refs": ["https://example.org/eval"]}}


def manifest():
    return {"schema": "wil-rbs.v1", "records": [run("run-a", "A"), run("run-b", "B", 100_200),
                                             evaluation("eval-a", "run-a", 1.7),
                                             evaluation("eval-b", "run-b", 1.8)]}


class ContractTests(unittest.TestCase):
    def test_valid_independent_fixture_and_quality(self):
        m = manifest()
        self.assertEqual(validate(m)["counts"]["evaluation"], 2)
        out = compare(m, "eval-a", "eval-b")
        self.assertTrue(out["fully_controlled_candidate"])
        self.assertEqual(out["quality_ranking"], "left")
        self.assertFalse(out["scientific_superiority_authorized"])

    def test_no_aggregate_can_claim_independent_source(self):
        h = json.loads((ROOT / "examples" / "historical_aggregates.json").read_text())
        h["records"][0]["evidence"]["level"] = "independently_verified"
        with self.assertRaises(ContractError):
            validate(h)

    def test_history_does_not_fabricate_score_parity(self):
        h = json.loads((ROOT / "examples" / "historical_aggregates.json").read_text())
        out = compare(h, "tac106-four-summary", "fusion001-summary")
        self.assertTrue(out["parameter_matched_1pct"])
        self.assertFalse(out["evaluation_targets_identical"])
        self.assertFalse(out["end_to_end_compute_matched_1pct"])
        self.assertEqual(out["quality_ranking"], "NOT_COMPARABLE")

    def test_unmatched_vocab_or_data_contract(self):
        m = manifest()
        m["records"][1]["data"]["target_unit"] = "character"
        o = compare(m, "eval-a", "eval-b")
        self.assertFalse(o["data_exposure_matched"])

    def test_different_test_targets_block_ranking(self):
        m = manifest()
        m["records"][3]["metric"]["target_sha256"] = K
        o = compare(m, "eval-a", "eval-b")
        self.assertEqual(o["quality_ranking"], "NOT_COMPARABLE")

    def test_unit_mismatch_blocks_ranking(self):
        m = manifest()
        m["records"][3]["metric"]["unit"] = "nat/token"
        self.assertFalse(compare(m, "eval-a", "eval-b")["evaluation_targets_identical"])

    def test_larger_parameter_gap_blocks_full(self):
        m = manifest()
        m["records"][1]["model"]["trainable_parameters"] = 115_000
        m["records"][1]["model"]["deployed_parameters"] = 115_000
        o = compare(m, "eval-a", "eval-b")
        self.assertFalse(o["parameter_matched_1pct"])
        self.assertFalse(o["fully_controlled_candidate"])

    def test_partial_flop_census_rejected(self):
        m = manifest()
        m["records"][0]["resources"]["training_flops"]["scope"] = "linear-only"
        with self.assertRaises(ContractError):
            validate(m)

    def test_unverified_flop_receipt_disqualifies_compute_match(self):
        m = manifest()
        m["records"][0]["resources"]["training_flops"] = {"value": None, "method": "unavailable"}
        self.assertFalse(compare(m, "eval-a", "eval-b")["end_to_end_compute_matched_1pct"])

    def test_duplicate_record_and_orphan_ref_rejected(self):
        m = manifest()
        m["records"][1]["id"] = "run-a"
        with self.assertRaises(ContractError):
            validate(m)
        m = manifest()
        m["records"][2]["run_id"] = "absent"
        with self.assertRaises(ContractError):
            validate(m)

    def test_independent_evaluation_needs_independent_run(self):
        m = manifest()
        m["records"][0]["evidence"]["level"] = "reported"
        with self.assertRaises(ContractError):
            validate(m)

    def test_checkpoint_mismatch_rejected(self):
        m = manifest()
        m["records"][3]["checkpoint_sha256"] = K
        with self.assertRaises(ContractError):
            validate(m)

    def test_negative_metric_allowed(self):
        m = manifest()
        m["records"][2]["metric"].update(name="reward", unit="reward/episode", value=-0.3)
        self.assertEqual(validate(m)["status"], "VALID")

    def test_nan_and_boolean_metric_rejected(self):
        for v in (float("nan"), True):
            m = manifest()
            m["records"][2]["metric"]["value"] = v
            with self.assertRaises(ContractError):
                validate(m)

    def test_cli_validates_history(self):
        path = ROOT / "examples" / "historical_aggregates.json"
        proc = subprocess.run([sys.executable, str(ROOT / "wil_rbs.py"), "validate", str(path)], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(json.loads(proc.stdout)["counts"]["historical_aggregate"], 4)


if __name__ == "__main__":
    unittest.main()
