-- Verdicts from before advisories were remembered got an empty list, which reads as "knew of
-- none" and would withdraw ones decided knowing an advisory. JSON null says "not known yet": the
-- next check takes what's known then as the baseline instead of withdrawing anything.
UPDATE verdict SET known_advisories = 'null' WHERE known_advisories = '[]';
