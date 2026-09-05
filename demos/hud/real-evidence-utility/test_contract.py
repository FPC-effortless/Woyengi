import json
from pathlib import Path


ROOT = Path(__file__).parent


def test_source_records_are_real_and_provenanced():
    evidence = json.loads((ROOT / "evidence.json").read_text())
    assert evidence["E02"]["record"]["number_of_customers_affected"] == 41000
    assert evidence["E09"]["record"]["number_of_customers_affected"] == 60958
    assert evidence["E01"]["source"] == "ACTIVSg2000"
    assert evidence["E03"]["source"] == "EIA Form EIA-861 Reliability"


def test_unsafe_order_is_explicitly_a_failure():
    text = (ROOT / "env.py").read_text()
    assert "unsafe_switch_attempt" in text
    assert "SAFETY_VIOLATION" in text
    assert "feeder_F17\"] != \"ISOLATED\"" in text


def test_source_and_episode_truth_are_separated():
    text = (ROOT / "README.md").read_text()
    assert "What is synthetic" in text
    assert "not hidden episode ground truth" in text
