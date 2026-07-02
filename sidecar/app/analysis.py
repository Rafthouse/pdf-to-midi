"""Score analysis & editing helpers operating on the internal model.

- compute_measure_issues: flag measures whose durations don't fill the meter.
- measure_length_ql / recompute_measure: support manual note correction by
  re-sequencing a measure's voices after an edit.
"""
from __future__ import annotations

from collections import defaultdict

from .models import NoteEvent, ScoreMeta, MeasureIssue

TOL = 1e-6


def measure_length_ql(meta: ScoreMeta) -> float:
    """Quarter-lengths per measure from the first time signature (assumes a
    constant meter, the common case; refined per-measure later if needed)."""
    if meta.time_signatures:
        ts = meta.time_signatures[0]
        return ts.numerator * (4.0 / ts.denominator)
    return 4.0


def _by_measure_part_voice(events: list[NoteEvent]):
    groups: dict[tuple[int, int, str], list[NoteEvent]] = defaultdict(list)
    for e in events:
        groups[(e.measure, e.part, e.voice or "1")].append(e)
    return groups


def compute_measure_issues(events: list[NoteEvent], meta: ScoreMeta) -> list[MeasureIssue]:
    """A measure+part is suspect if its fullest voice does not sum to the
    expected measure length (incomplete) or any voice overflows it."""
    expected = measure_length_ql(meta)
    groups = _by_measure_part_voice(events)

    # voice sums per (measure, part)
    per_mp: dict[tuple[int, int], list[float]] = defaultdict(list)
    for (measure, part, _voice), evs in groups.items():
        s = sum(e.duration_ql for e in evs)
        per_mp[(measure, part)].append(s)

    issues: list[MeasureIssue] = []
    for (measure, part), sums in sorted(per_mp.items()):
        fullest = max(sums)
        if fullest > expected + TOL:
            issues.append(MeasureIssue(measure=measure, part=part,
                                       filled_ql=round(fullest, 4),
                                       expected_ql=expected, kind="overfull"))
        elif fullest < expected - TOL:
            issues.append(MeasureIssue(measure=measure, part=part,
                                       filled_ql=round(fullest, 4),
                                       expected_ql=expected, kind="short"))
    return issues


def auto_fix_dropped_dots(events: list[NoteEvent], meta: ScoreMeta) -> list[int]:
    """Audiveris frequently drops the augmentation dot on a dotted-eighth that
    sits next to a sixteenth (the '16th + dotted-eighth' / 'dotted-eighth + 16th'
    figure), leaving the measure exactly one sixteenth short. When a measure's
    fullest voice is short by ~0.25 and contains a 16th adjacent to an eighth,
    promote that eighth to a dotted-eighth (0.5 -> 0.75) so the bar fills.

    Conservative: only acts when it makes the bar exactly full. Returns the list
    of corrected measure numbers (surfaced to the user, who can still override).
    """
    expected = measure_length_ql(meta)
    groups = _by_measure_part_voice(events)

    mp_voices: dict[tuple[int, int], dict[str, list[NoteEvent]]] = defaultdict(dict)
    for (measure, part, voice), evs in groups.items():
        mp_voices[(measure, part)][voice] = evs

    fixed: list[int] = []
    for (measure, _part), voices in mp_voices.items():
        # the fullest voice in this measure/part is the one that should fill it
        vid, evs = max(voices.items(), key=lambda kv: sum(e.duration_ql for e in kv[1]))
        deficit = expected - sum(e.duration_ql for e in evs)
        if not (0.2 < deficit < 0.3):  # one sixteenth short
            continue
        seq = sorted(evs, key=lambda e: e.onset_ql)
        for i, e in enumerate(seq):
            if abs(e.duration_ql - 0.25) >= 1e-6:
                continue
            for j in (i + 1, i - 1):  # prefer the note after the 16th, else before
                if 0 <= j < len(seq) and abs(seq[j].duration_ql - 0.5) < 1e-6:
                    seq[j].duration_ql = 0.75
                    fixed.append(measure)
                    break
            if measure in fixed:
                break

    for m in sorted(set(fixed)):
        recompute_measure_onsets(events, m, meta)
    return sorted(set(fixed))


def recompute_measure_onsets(events: list[NoteEvent], measure: int, meta: ScoreMeta) -> None:
    """Re-sequence each (part, voice) in `measure` after a duration edit:
    lay notes end-to-end from the measure's start onset. Mutates events in place
    (onset_ql + onset/duration seconds via the tempo map)."""
    from .parsing import TempoMap

    tmap = TempoMap([(t.onset_ql, t.bpm) for t in meta.tempos])
    mlen = measure_length_ql(meta)
    measure_start = (measure - 1) * mlen

    groups = _by_measure_part_voice([e for e in events if e.measure == measure])
    for (_m, _p, _v), evs in groups.items():
        evs.sort(key=lambda e: e.onset_ql)
        cursor = measure_start
        for e in evs:
            e.onset_ql = round(cursor, 6)
            e.onset_sec = round(tmap.seconds_at(e.onset_ql), 4)
            e.duration_sec = round(tmap.seconds_at(e.onset_ql + e.duration_ql) - e.onset_sec, 4)
            cursor += e.duration_ql
