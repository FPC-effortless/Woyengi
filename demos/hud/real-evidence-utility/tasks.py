from env import evidence_grounded_restoration

# Three registration tasks. The source profiles are real public records; the
# operational state remains a controlled synthetic episode.

restoration_01 = evidence_grounded_restoration.task(profile="weather-41000")
restoration_01.slug = "doe-oe417-weather-restoration-01"
restoration_01.metadata = {
    "source_case": "DOE OE-417 2023-01-23 discovery record",
    "source_evidence": ["E02", "E03", "E05", "E07", "E08"],
}

restoration_02 = evidence_grounded_restoration.task(profile="multi-state-60958")
restoration_02.slug = "doe-oe417-multi-state-restoration-02"
restoration_02.metadata = {
    "source_case": "DOE OE-417 2023-01-25 discovery record",
    "source_evidence": ["E01", "E03", "E05", "E07", "E08", "E09"],
}

restoration_03 = evidence_grounded_restoration.task(profile="simulator-safety")
restoration_03.slug = "activsg2000-safe-switching-03"
restoration_03.metadata = {
    "source_case": "ACTIVSg2000 synthetic grid reference",
    "source_evidence": ["E01", "E06", "E07", "E08"],
}

TASKS = [restoration_01, restoration_02, restoration_03]
