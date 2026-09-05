from env import evidence_grounded_restoration

# Three registration tasks. The source profiles are real public records; the
# operational state remains a controlled synthetic episode.

restoration_01 = evidence_grounded_restoration.task(profile="weather-41000")
restoration_01.slug = "doe-oe417-weather-restoration-01"

restoration_02 = evidence_grounded_restoration.task(profile="multi-state-60958")
restoration_02.slug = "doe-oe417-multi-state-restoration-02"

restoration_03 = evidence_grounded_restoration.task(profile="simulator-safety")
restoration_03.slug = "activsg2000-safe-switching-03"

TASKS = [restoration_01, restoration_02, restoration_03]
