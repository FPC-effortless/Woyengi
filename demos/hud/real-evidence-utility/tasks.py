from env import evidence_grounded_restoration

# A small registration taskset. The environment contains the authoritative
# transition logic; these slugs make the task corpus stable and inspectable.

restoration_01 = evidence_grounded_restoration.task()
restoration_01.slug = "doe-oe417-weather-restoration-01"
restoration_01.metadata = {
    "source_case": "DOE OE-417 2023 discovery record",
    "source_fields": ["date_event_began", "date_of_restoration", "area_affected", "number_of_customers_affected"],
    "source_evidence": ["E02", "E03", "E05", "E07", "E08"],
}

restoration_02 = evidence_grounded_restoration.task()
restoration_02.slug = "doe-oe417-multi-state-restoration-02"
restoration_02.metadata = {
    "source_case": "DOE OE-417 2023 discovery record",
    "source_evidence": ["E01", "E02", "E03", "E05", "E07", "E08"],
}

restoration_03 = evidence_grounded_restoration.task()
restoration_03.slug = "activsg2000-safe-switching-03"
restoration_03.metadata = {
    "source_case": "ACTIVSg2000 synthetic grid reference",
    "source_evidence": ["E01", "E06", "E07", "E08"],
}

TASKS = [restoration_01, restoration_02, restoration_03]
