"""Server copy of the line-list normalisation rules.

The browser computes rule corrections (src/services/api/linelist-normalise.ts);
the server re-runs the named rule on the stored value before a correction
is saved, and refuses it unless the result is identical. Both are tested
against src/services/api/normalise-vectors.json so they cannot drift apart.

Python note: regular expressions use [0-9], not \\d (which matches
non-ASCII digits).
"""

from __future__ import annotations

import datetime
import re
from typing import Optional

TYPED_FIELDS = {
    "vaccination_date", "onset_date", "report_date", "state_received_date",
    "national_received_date", "date_of_birth", "vaccine_batch", "diluent_batch",
    "dose", "age", "age_months", "age_weeks", "age_days", "sex", "outcome", "serious_code", "reaction_code",
}
DATE_FIELDS = {
    "vaccination_date", "onset_date", "report_date", "state_received_date",
    "national_received_date", "date_of_birth",
}

UNITS = [
    ("minute", "minutes",
     re.compile(r"^(m|mn|mns|min|mins|minute|minutes|minit|minits|minite|minites|minut|minuts|minuite|minuites|mint|mints|mnt|mnts)$"),
     re.compile(r"^(m|min|mins|minute|minutes)$")),
    ("hour", "hours",
     re.compile(r"^(h|hr|hrs|hour|hours|hor|hors|hous|house|houres|hourse)$"),
     re.compile(r"^(h|hr|hrs|hour|hours)$")),
    ("day", "days", re.compile(r"^(d|dy|dys|day|days|dayz)$"), re.compile(r"^(d|day|days)$")),
    ("week", "weeks", re.compile(r"^(w|wk|wks|week|weeks|weekz)$"), re.compile(r"^(w|wk|wks|week|weeks)$")),
]


def _alnum(v: str) -> str:
    return re.sub(r"[^a-z0-9]", "", v.lower())


def _match_case(written: str, word: str) -> str:
    return word.upper() if written == written.upper() else word


def _ordinal(n: int) -> str:
    if 11 <= n % 100 <= 13:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def _days_in_month(y: int, m: int) -> int:
    nxt = datetime.date(y + (m == 12), m % 12 + 1, 1)
    return (nxt - datetime.timedelta(days=1)).day


def _stray_edge(value: str, field: str) -> Optional[str]:
    v = re.sub(r"'+$", "", re.sub(r"^'+", "", value.strip())).strip()
    v = re.sub(r"^[:;,]+\s*", "", v)
    if field != "reaction_code":
        v = re.sub(r"\s*[,;:]+$", "", v)
    v = v.strip()
    return v if v and v != value.strip() and _alnum(v) == _alnum(value) else None


def _date_year_repeated_digit(value: str, field: str) -> Optional[str]:
    v = value.strip()
    dmy = re.match(r"^([0-9]{1,2})([/.-])([0-9]{1,2})\2([0-9]{5})$", v)
    ymd = re.match(r"^([0-9]{5})([/.-])([0-9]{1,2})\2([0-9]{1,2})$", v)
    m = dmy or ymd
    if not m:
        return None
    day, month, year = (m.group(1), m.group(3), m.group(4)) if dmy else (m.group(4), m.group(3), m.group(1))
    if not (1 <= int(day) <= 31 and 1 <= int(month) <= 12):
        return None
    max_year = datetime.date.today().year + 1
    years = set()
    for k in range(1, len(year)):
        if year[k] == year[k - 1]:
            y = year[:k] + year[k + 1:]
            if 1900 <= int(y) <= max_year:
                years.add(y)
    if len(years) != 1:
        return None
    y = years.pop()
    sep = m.group(2)
    return f"{day}{sep}{month}{sep}{y}" if dmy else f"{y}{sep}{month}{sep}{day}"


def _date_doubled_separator(value: str, field: str) -> Optional[str]:
    v = value.strip()
    out = re.sub(r"([/.-])\1+", r"\1", v)
    if out == v:
        return None
    dmy = re.match(r"^([0-9]{1,2})([/.-])([0-9]{1,2})\2([0-9]{2}|[0-9]{4})$", out)
    ymd = re.match(r"^([0-9]{4})([/.-])([0-9]{1,2})\2([0-9]{1,2})$", out)
    if dmy:
        d, mo = dmy.group(1), dmy.group(3)
    elif ymd:
        d, mo = ymd.group(4), ymd.group(3)
    else:
        return None
    return out if 1 <= int(d) <= 31 and 1 <= int(mo) <= 12 else None


def _time_letter_for_digit(value: str, field: str) -> Optional[str]:
    v = value.strip()
    if not re.search(r"[Oo]", v) or not re.search(r"[0-9]", v):
        return None
    out = re.sub(r"(?<=[0-9:Oo])[Oo]|[Oo](?=[0-9:Oo])", "0", v)
    t = re.match(r"^([0-9]{1,2}):([0-9]{2})(\s*([AaPp])\.?[Mm]\.?)?$", out)
    if not t or out == v:
        return None
    h = int(t.group(1))
    ok = (1 <= h <= 12 if t.group(4) else h <= 23) and int(t.group(2)) <= 59
    return out if ok else None


def _unit_for(word: str):
    w = word.lower()
    for singular, plural, spellings, standard in UNITS:
        if spellings.match(w):
            return singular, plural, bool(standard.match(w))
    return None


def _interval_unit_spelling(value: str, field: str) -> Optional[str]:
    v = value.strip()
    part = re.compile(r"([0-9]+(?:\.[0-9]+)?)(\s*)([A-Za-z]+)\.?")
    state = {"changed": False, "ok": True}

    def sub(m: re.Match) -> str:
        n, gap, word = m.group(1), m.group(2), m.group(3)
        unit = _unit_for(word)
        if not unit:
            state["ok"] = False
            return m.group(0)
        singular, plural, standard = unit
        if standard:
            return f"{n}{gap}{word}"
        state["changed"] = True
        return f"{n}{gap or ' '}{_match_case(word, singular if float(n) == 1 else plural)}"

    out = part.sub(sub, v)
    leftover = re.sub(r"[\s,&]|and", "", part.sub("", v), flags=re.IGNORECASE)
    return out if state["ok"] and state["changed"] and not leftover else None


# The header states the column's unit as millilitres ("Volume (mL)").
HEADER_ML = re.compile(r"\b(ml|mls|millilit(?:re|er)s?)\b", re.IGNORECASE)


def header_states_ml(header: str) -> bool:
    """Same as the browser's headerStatesMl: underscores and hyphens separate
    words, as spaces do ("DOSE_VOL_ML")."""
    return bool(HEADER_ML.search(re.sub(r"[_-]+", " ", header or "")))


def _dose_decimal_comma(value: str, field: str, header: str = "") -> Optional[str]:
    # One or two decimal digits only: "1,000 ml" may be a thousands separator.
    m = re.match(r"^([0-9]+),([0-9]{1,2})(\s*)(ml)$", value.strip(), re.IGNORECASE)
    if m:
        return f"{m.group(1)}.{m.group(2)}{m.group(3)}{m.group(4)}"
    # No unit in the cell: only when the header makes the column a volume
    # in mL, and only one short number ("0,5", "1,0") — never "1,2,3".
    m = re.match(r"^([0-9]{1,2}),([0-9]{1,2})$", value.strip())
    return f"{m.group(1)}.{m.group(2)}" if m and header_states_ml(header) else None


def _ordinal_suffix_typo(value: str, field: str) -> Optional[str]:
    m = re.match(r"^([0-9]{1,2})([A-Za-z]{2})(\s+dose)?$", value.strip(), re.IGNORECASE)
    if not m:
        return None
    written = m.group(2)
    lower = written.lower()
    right = _ordinal(int(m.group(1)))
    if lower in {"st", "nd", "rd", "th"}:
        return None
    diff = sum(1 for i, c in enumerate(lower) if c != right[i])
    return f"{m.group(1)}{_match_case(written, right)}{m.group(3) or ''}" if diff == 1 else None


def _code_list_delimiters(value: str, field: str) -> Optional[str]:
    v = value.strip()
    if not re.match(r"^[0-9]+(\s*(,|;|/|&)\s*[0-9]+)*\s*[,;/]?\s*$", v):
        return None
    out = re.sub(r"\s*&\s*", ", ", re.sub(r"\s*[,;/]\s*$", "", v))
    return out if out != v else None


def _unit_in_own_column(value: str, field: str) -> Optional[str]:
    pattern = (r"^([0-9]{1,3})\s*(months?|mths?|mos?)\.?$" if field == "age_months"
               else r"^([0-9]{1,3})\s*(years?|yrs?)\.?$")
    m = re.match(pattern, value.strip(), re.IGNORECASE)
    return m.group(1) if m else None


def _slips(a: str, b: str) -> int:
    """Typing slips between two words: a letter added, missing or wrong, or
    two neighbouring letters swapped, each counting one."""
    d = [[i if j == 0 else j if i == 0 else 0 for j in range(len(b) + 1)] for i in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] != b[j - 1]))
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


def _only_near(written: str, choices):
    """The one choice `written` is within a slip of (two for spellings of
    eight letters or more), or None when no choice is, or more than one."""
    near = [value for value, words in choices
            if any(_slips(written, w) <= (2 if len(w) >= 8 else 1) for w in words)]
    return near[0] if len(near) == 1 else None


def _letter_words(v: str) -> str:
    return re.sub(r"[^a-z]", "", v.lower())


# The spellings the app already reads (mapAgeUnit / mapSex in mapping.ts).
AGE_UNIT_WORDS = {
    "DECADE", "DECADES", "Y", "YR", "YRS", "YEAR", "YEARS", "YEAROLD", "YEARSOLD", "A",
    "M", "MO", "MOS", "MTH", "MTHS", "MONTH", "MONTHS", "W", "WK", "WKS", "WEEK", "WEEKS",
    "D", "DY", "DAY", "DAYS", "H", "HR", "HRS", "HOUR", "HOURS",
}
SEX_WORDS = {
    "M", "MALE", "MAN", "BOY", "F", "FEMALE", "WOMAN", "GIRL", "U", "UNK", "UNKNOWN",
    "UNSPECIFIED", "NOTSPECIFIED", "NOTKNOWN", "NOTREPORTED", "NOTSTATED", "NOTRECORDED", "NA",
}
AGE_UNITS = [
    ("Days", ("day", "days")),
    ("Weeks", ("week", "weeks")),
    ("Months", ("month", "months")),
    ("Years", ("year", "years")),
    ("Hours", ("hour", "hours")),
]


def _key(v: str) -> str:
    return re.sub(r"[\s._-]+", "", v.strip().upper())


def _stray_edge_asterisk(value: str, field: str) -> Optional[str]:
    v = re.sub(r"\s*\*+$", "", re.sub(r"^\*+\s*", "", value.strip()))
    return v if v and v != value.strip() and _alnum(v) == _alnum(value) else None


def _date_letter_for_digit(value: str, field: str) -> Optional[str]:
    v = value.strip()
    if not re.search(r"[OoIl]", v) or not re.search(r"[0-9]", v):
        return None
    part = "[0-9OoIl]"
    shape = (rf"^(?:{part}{{1,2}}([/.-]){part}{{1,2}}\1(?:{part}{{2}}|{part}{{4}})"
             rf"|{part}{{4}}([/.-]){part}{{1,2}}\2{part}{{1,2}})$")
    if not re.match(shape, v):
        return None
    out = re.sub(r"[Il]", "1", re.sub(r"[Oo]", "0", v))
    dmy = re.match(r"^([0-9]{1,2})[/.-]([0-9]{1,2})[/.-]([0-9]{2}|[0-9]{4})$", out)
    ymd = re.match(r"^([0-9]{4})[/.-]([0-9]{1,2})[/.-]([0-9]{1,2})$", out)
    if dmy:
        d, m, y = dmy.group(1), dmy.group(2), dmy.group(3)
    elif ymd:
        d, m, y = ymd.group(3), ymd.group(2), ymd.group(1)
    else:
        return None
    year_ok = len(y) == 2 or 1900 <= int(y) <= datetime.date.today().year + 1
    return out if 1 <= int(d) <= 31 and 1 <= int(m) <= 12 and year_ok else None


def _seriousness_spelling(value: str, field: str) -> Optional[str]:
    l = _letter_words(value)
    if not l or l in {"serious", "nonserious", "yes", "no", "y", "n"}:
        return None
    word = "Non-serious" if l == "notserious" else _only_near(
        l, [("Serious", ("serious",)), ("Non-serious", ("nonserious",))])
    return _match_case(value.strip(), word) if word else None


def _age_unit_spelling(value: str, field: str) -> Optional[str]:
    if _key(value) in AGE_UNIT_WORDS:
        return None
    l = _letter_words(value)
    if len(l) < 2:
        return None
    unit = _only_near(l, AGE_UNITS)
    return _match_case(value.strip(), unit) if unit else None


def _sex_spelling(value: str, field: str) -> Optional[str]:
    if _key(value) in SEX_WORDS:
        return None
    l = _letter_words(value)
    if len(l) < 3:
        return None
    sex = _only_near(l, [("Male", ("male",)), ("Female", ("female",))])
    return _match_case(value.strip(), sex) if sex else None


SERIOUS_WORDS = {"serious", "yes", "y"}
NON_SERIOUS_WORDS = {"nonserious", "no", "n", "notserious"}


def fatal_outcome_serious(before: str, after: str) -> bool:
    """The fatal-outcome rule's only change: a non-serious word made a
    serious one (a death is serious by definition). The outcome is read in
    the browser; here the change is checked to go only towards serious."""
    return _letter_words(before) in NON_SERIOUS_WORDS and _letter_words(after) in SERIOUS_WORDS


# (id, version, fields, apply) — the same order as NORMALISATION_RULES.
RULES = [
    ("stray-edge-character", "1", TYPED_FIELDS, _stray_edge),
    ("date-year-repeated-digit", "1", DATE_FIELDS, _date_year_repeated_digit),
    ("date-doubled-separator", "1", DATE_FIELDS, _date_doubled_separator),
    ("time-letter-for-digit", "1", {"vaccination_time"}, _time_letter_for_digit),
    ("stray-edge-asterisk", "1", TYPED_FIELDS, _stray_edge_asterisk),
    ("date-letter-for-digit", "1", DATE_FIELDS, _date_letter_for_digit),
    ("seriousness-spelling", "1", {"seriousness"}, _seriousness_spelling),
    ("age-unit-spelling", "1", {"age_unit"}, _age_unit_spelling),
    ("sex-spelling", "1", {"sex"}, _sex_spelling),
    ("interval-unit-spelling", "1", {"onset_interval"}, _interval_unit_spelling),
    ("dose-decimal-comma", "3", {"dose"}, _dose_decimal_comma),
    ("ordinal-suffix-typo", "1", {"dose"}, _ordinal_suffix_typo),
    ("code-list-delimiters", "1", {"reaction_code"}, _code_list_delimiters),
    ("unit-in-own-column", "1", {"age", "age_months"}, _unit_in_own_column),
]


def normalise(field: str, value: str, header: str = "") -> Optional[tuple]:
    """(new value, rule id, version) of the first rule that applies, or None.
    `header` is the column's own header text, for rules that read a unit
    the header states."""
    if not value.strip():
        return None
    for rule_id, version, fields, apply in RULES:
        if field not in fields:
            continue
        out = apply(value, field, header) if apply is _dose_decimal_comma else apply(value, field)
        if out is not None and out != value:
            return out, rule_id, version
    return None


def unestablished_decimal_comma(field: str, before: str, after: str, header: str) -> bool:
    """True when `after` only turns a decimal comma in `before` into a point
    in a dose, and the rule dose-decimal-comma would not: the unit is stated
    neither in the cell nor in the column header. Same as the browser's
    unestablishedDecimalComma."""
    if field != "dose":
        return False
    b, a = (before or "").strip(), (after or "").strip()
    if "," not in b or a != b.replace(",", "."):
        return False
    got = normalise(field, b, header)
    return not got or got[0] != a
