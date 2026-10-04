"""
Retrieval of real, citable sources for the PSUR assessment memo.

The memo's researched criteria (7, 8, 10, 11) carry external sources inline
in the supplied NAFDAC example: DailyMed, NCBI, a gov.uk Drug Safety Update,
a DOI. This module fetches exactly that kind of source from public
registries. It never asks a model to remember a study: a model that drafts
from memory invents references (see the spec's section 3, on FDA's Elsa),
and an invented reference on a signed regulatory memo is the worst outcome
this feature could produce.

So the citation on every candidate comes from HERE, from what a registry
actually returned. The model, when it is used at all, may only summarise a
source it was handed and must name that source by id; anything naming an id
that was not handed to it is dropped (see summarise_with_ai in
routes/ai_psur.py).

Every fetch is best-effort: one registry failing never fails the search,
and the response says which registries answered and which did not, so an
empty result is distinguishable from an unreachable one.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Optional

import httpx
from defusedxml import ElementTree as ET

logger = logging.getLogger(__name__)

PUBMED_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
PUBMED_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
OPENFDA_LABEL = "https://api.fda.gov/drug/label.json"
GOVUK_SEARCH = "https://www.gov.uk/api/search.json"

HTTP_TIMEOUT = 20.0
MAX_PUBMED_RESULTS = 6
MAX_DSU_RESULTS = 5
# Long label sections are cut so one source cannot crowd the others out of
# the model's context, and so a candidate stays readable on screen.
MAX_EXCERPT_CHARS = 1500

# The researched memo criteria, and which registries answer each. Criterion
# 9 (patient exposure) is absent on purpose: its source is NAFDAC's own
# VigiFlow, which has no programmatic access yet (spec section 7), so it is
# entered by hand rather than "researched" from somewhere it does not live.
RESEARCH_CRITERIA = {
    "RSI_CHANGES": ("label", "dsu"),
    "WORLDWIDE_ACTIONS": ("dsu", "label"),
    "RELEVANT_STUDIES": ("pubmed",),
    "OVERALL_SAFETY_EVALUATION": ("label", "pubmed_reviews"),
}


@dataclass
class Source:
    """One retrieved document. `citation` is what the memo prints."""

    id: str
    source_type: str  # an EvidenceSourceType value
    registry: str
    title: str
    citation: str
    url: str
    excerpt: str
    published: str = ""
    in_interval: Optional[bool] = None


@dataclass
class RegistryResult:
    name: str
    query: str
    count: int = 0
    error: Optional[str] = None


@dataclass
class ResearchResult:
    sources: list[Source] = field(default_factory=list)
    registries: list[RegistryResult] = field(default_factory=list)


def _clip(text: str, limit: int = MAX_EXCERPT_CHARS) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def parse_date(value: str) -> Optional[str]:
    """Normalise the date shapes the registries and PSURs use to YYYY-MM-DD.

    Returns None when the value cannot be read, rather than guessing: an
    interval bound read wrongly would silently filter out real evidence.
    """
    value = (value or "").strip()
    if not value:
        return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", value)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{4})(\d{2})(\d{2})$", value)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    months = {
        m: i + 1
        for i, m in enumerate(
            ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
        )
    }
    m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3})[A-Za-z]*\.?,?\s+(\d{4})$", value)
    if m and m.group(2).lower() in months:
        return f"{m.group(3)}-{months[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    m = re.match(r"^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$", value)
    if m and m.group(1).lower() in months:
        return f"{m.group(3)}-{months[m.group(1).lower()]:02d}-{int(m.group(2)):02d}"
    m = re.match(r"^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$", value)
    if m:
        # Day first: the convention on NAFDAC and EU submissions.
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    return None


def split_interval(interval: str) -> tuple[Optional[str], Optional[str]]:
    """'12 November 2021 to 12 November 2024' -> ('2021-11-12', '2024-11-12')."""
    parts = re.split(r"\s+(?:to|until|through|–|—|-)\s+", (interval or "").strip(), maxsplit=1)
    if len(parts) != 2:
        return None, None
    return parse_date(parts[0]), parse_date(parts[1])


# Salt and hydrate words that name a form of the molecule, not the
# molecule. Registries index "amoxicillin", not "amoxicillin trihydrate".
_SALT_WORDS = {
    "hydrochloride", "hcl", "potassium", "sodium", "calcium", "magnesium", "trihydrate",
    "dihydrate", "monohydrate", "anhydrous", "maleate", "sulfate", "sulphate", "phosphate",
    "acetate", "citrate", "tartrate", "mesylate", "besylate", "succinate", "fumarate",
    "bromide", "chloride", "hyclate", "hydrobromide", "as", "base",
}


def substance_terms(substance: str) -> list[str]:
    """'Amoxicillin (as trihydrate) / Clavulanate potassium' -> ['amoxicillin', 'clavulanate'].

    A combination product is searched as all of its components together;
    a literal search for the whole label string finds nothing.
    """
    text = re.sub(r"\([^)]*\)", " ", substance or "").lower()
    parts = re.split(r"\s*(?:/|\+|,|;|\band\b|&)\s*", text)
    terms: list[str] = []
    for part in parts:
        words = [w for w in re.findall(r"[a-z][a-z\-]+", part) if w not in _SALT_WORDS]
        if words:
            term = " ".join(words[:2]) if len(words) > 1 and len(words[0]) < 4 else words[0]
            if term not in terms:
                terms.append(term)
    return terms or ([substance.strip().lower()] if substance.strip() else [])


def _within(date: Optional[str], start: Optional[str], end: Optional[str]) -> Optional[bool]:
    if not date or not (start or end):
        return None
    if start and date < start:
        return False
    if end and date > end:
        return False
    return True


def _year_within(year: str, start: Optional[str], end: Optional[str]) -> Optional[bool]:
    """For a year-only date: decided only when the whole year is clearly in
    or out. A year the interval starts or ends in could be either."""
    if not (year.isdigit() and start and end):
        return None
    if start[:4] < year < end[:4]:
        return True
    if year < start[:4] or year > end[:4]:
        return False
    return None


# ------------------------------------------------------------------ PubMed --


def parse_pubmed_xml(xml_text: str) -> list[dict]:
    """The fields a citation needs, per article, from an efetch response."""
    articles: list[dict] = []
    root = ET.fromstring(xml_text)
    for art in root.findall(".//PubmedArticle"):
        pmid = (art.findtext(".//MedlineCitation/PMID") or "").strip()
        title = "".join(art.find(".//ArticleTitle").itertext()).strip() if art.find(".//ArticleTitle") is not None else ""
        journal = (art.findtext(".//Journal/Title") or art.findtext(".//Journal/ISOAbbreviation") or "").strip()
        year = (
            art.findtext(".//Journal/JournalIssue/PubDate/Year")
            or (art.findtext(".//Journal/JournalIssue/PubDate/MedlineDate") or "")[:4]
            or art.findtext(".//ArticleDate/Year")
            or ""
        ).strip()
        month = (art.findtext(".//ArticleDate/Month") or "").strip()
        day = (art.findtext(".//ArticleDate/Day") or "").strip()
        published = f"{year}-{int(month):02d}-{int(day):02d}" if year and month.isdigit() and day.isdigit() else year
        authors = []
        for a in art.findall(".//AuthorList/Author"):
            last = (a.findtext("LastName") or "").strip()
            initials = (a.findtext("Initials") or "").strip()
            if last:
                authors.append(f"{last} {initials}".strip())
            elif a.findtext("CollectiveName"):
                authors.append(a.findtext("CollectiveName").strip())
        doi = ""
        for aid in art.findall(".//ArticleIdList/ArticleId"):
            if aid.get("IdType") == "doi" and aid.text:
                doi = aid.text.strip()
        abstract = " ".join(
            ("".join(p.itertext())).strip() for p in art.findall(".//Abstract/AbstractText")
        ).strip()
        pub_types = [(p.text or "").strip() for p in art.findall(".//PublicationTypeList/PublicationType")]
        if pmid and title:
            articles.append(
                dict(
                    pmid=pmid,
                    title=title,
                    journal=journal,
                    year=year,
                    published=published,
                    authors=authors,
                    doi=doi,
                    abstract=abstract,
                    pub_types=pub_types,
                )
            )
    return articles


def pubmed_citation(a: dict) -> str:
    authors = a["authors"]
    who = ", ".join(authors[:3]) + (" et al." if len(authors) > 3 else "") if authors else "Anonymous"
    parts = [f"{who} ({a['year']}). {a['title'].rstrip('.')}." if a["year"] else f"{who}. {a['title'].rstrip('.')}."]
    if a["journal"]:
        parts.append(f"{a['journal']}.")
    if a["doi"]:
        parts.append(f"doi:{a['doi']}.")
    parts.append(f"PMID: {a['pmid']}. https://pubmed.ncbi.nlm.nih.gov/{a['pmid']}/")
    return " ".join(parts)


async def search_pubmed(
    client: httpx.AsyncClient,
    substance: str,
    start: Optional[str],
    end: Optional[str],
    reviews_only: bool = False,
) -> tuple[list[Source], RegistryResult]:
    focus = (
        "(adverse effects[sh] OR toxicity[sh] OR safety[tiab] OR adverse[tiab] OR poisoning[sh])"
        if not reviews_only
        else "(adverse effects[sh] OR safety[tiab]) AND (review[pt] OR systematic review[pt] OR meta-analysis[pt])"
    )
    term = " AND ".join(f'"{t}"[tiab]' for t in substance_terms(substance)) + f" AND {focus}"
    params = {"db": "pubmed", "term": term, "retmode": "json", "retmax": MAX_PUBMED_RESULTS, "sort": "relevance"}
    dated = dict(params)
    if start or end:
        dated.update(
            datetype="pdat",
            mindate=(start or "1900-01-01").replace("-", "/"),
            maxdate=(end or "3000-01-01").replace("-", "/"),
        )
    name = "PubMed (systematic reviews)" if reviews_only else "PubMed"
    result = RegistryResult(name=name, query=term)
    try:
        r = await client.get(PUBMED_ESEARCH, params=dated)
        r.raise_for_status()
        ids = r.json().get("esearchresult", {}).get("idlist", [])
        if not ids and dated is not params:
            # Nothing published inside the interval: widen to all dates so
            # the assessor still sees the evidence base, each item marked
            # with its own date against the interval.
            result.query = term + " (no results within the reporting interval; all dates shown)"
            r = await client.get(PUBMED_ESEARCH, params=params)
            r.raise_for_status()
            ids = r.json().get("esearchresult", {}).get("idlist", [])
        if not ids:
            return [], result
        r = await client.get(PUBMED_EFETCH, params={"db": "pubmed", "id": ",".join(ids), "retmode": "xml"})
        r.raise_for_status()
        articles = parse_pubmed_xml(r.text)
    except Exception as exc:  # noqa: BLE001 — best effort, reported below
        logger.warning("PubMed search failed: %s", exc)
        result.error = "PubMed could not be reached."
        return [], result
    # Keep relevance order from esearch.
    order = {pmid: i for i, pmid in enumerate(ids)}
    articles.sort(key=lambda a: order.get(a["pmid"], 99))
    sources = [
        Source(
            id="",
            source_type="PUBLISHED_LITERATURE",
            registry=name,
            title=a["title"],
            citation=pubmed_citation(a),
            url=f"https://pubmed.ncbi.nlm.nih.gov/{a['pmid']}/",
            excerpt=_clip(a["abstract"] or a["title"]),
            published=a["published"],
            in_interval=_within(a["published"], start, end)
            if len(a["published"]) == 10
            else _year_within(a["year"], start, end),
        )
        for a in articles
    ]
    result.count = len(sources)
    return sources, result


# ------------------------------------------------------- openFDA / DailyMed --


def label_sources(label: dict, substance: str, start: Optional[str], end: Optional[str]) -> list[Source]:
    """One source per safety-relevant section of an FDA label.

    The citation is the DailyMed page for the label's set id — the same
    source the supplied NAFDAC memo cites for its RSI row.
    """
    set_id = label.get("set_id", "")
    effective = parse_date(label.get("effective_time", "")) or ""
    brand = ", ".join((label.get("openfda", {}) or {}).get("brand_name", [])[:2])
    who = ", ".join((label.get("openfda", {}) or {}).get("manufacturer_name", [])[:1])
    url = f"https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid={set_id}" if set_id else ""
    base = f"US FDA prescribing information for {substance}"
    if brand:
        base += f" ({brand}"
        base += f", {who})" if who else ")"
    base += f", label effective {effective or 'date not stated'}. DailyMed, US National Library of Medicine."
    sections = [
        ("recent_major_changes", "Recent major changes"),
        ("boxed_warning", "Boxed warning"),
        ("warnings_and_cautions", "Warnings and precautions"),
        ("warnings", "Warnings"),
        ("adverse_reactions", "Adverse reactions"),
    ]
    out: list[Source] = []
    for key, heading in sections:
        text = " ".join(label.get(key) or [])
        if not text.strip():
            continue
        out.append(
            Source(
                id="",
                source_type="REFERENCE_SAFETY_INFORMATION",
                registry="DailyMed / openFDA",
                title=f"{heading} — {base.split(',')[0]}",
                citation=f"{base} Section: {heading}. {url}".strip(),
                url=url,
                excerpt=_clip(text),
                published=effective,
                # A label's effective date is when this copy was published,
                # not when any change in it was made — the changes carry
                # their own dates in the text. So no interval verdict here.
                in_interval=None,
            )
        )
    return out


async def search_label(
    client: httpx.AsyncClient, substance: str, start: Optional[str], end: Optional[str]
) -> tuple[list[Source], RegistryResult]:
    query = " AND ".join(f'openfda.generic_name:"{t}"' for t in substance_terms(substance))
    result = RegistryResult(name="DailyMed / openFDA drug labels", query=query)
    try:
        r = await client.get(OPENFDA_LABEL, params={"search": query, "limit": 25, "sort": "effective_time:desc"})
        if r.status_code == 404:
            return [], result
        r.raise_for_status()
        labels = r.json().get("results", [])
    except Exception as exc:  # noqa: BLE001
        logger.warning("openFDA label search failed: %s", exc)
        result.error = "openFDA could not be reached."
        return [], result
    # Many labels for one substance are repackagers' copies. The one that
    # lists its own recent safety changes is the one that answers "did the
    # reference safety information change"; failing that, the most recent.
    labels.sort(key=lambda lb: (0 if lb.get("recent_major_changes") else 1, -int(lb.get("effective_time") or 0)))
    sources = label_sources(labels[0], substance, start, end) if labels else []
    result.count = len(sources)
    return sources, result


# ------------------------------------------------- MHRA Drug Safety Update --


async def search_drug_safety_update(
    client: httpx.AsyncClient, substance: str, start: Optional[str], end: Optional[str]
) -> tuple[list[Source], RegistryResult]:
    terms = substance_terms(substance)
    result = RegistryResult(name="MHRA Drug Safety Update (gov.uk)", query=" ".join(terms))
    try:
        r = await client.get(
            GOVUK_SEARCH,
            params={
                "filter_format": "drug_safety_update",
                "q": " ".join(terms),
                "count": 20,
                "fields": "title,link,public_timestamp,description",
            },
        )
        r.raise_for_status()
        rows = r.json().get("results", [])
    except Exception as exc:  # noqa: BLE001
        logger.warning("gov.uk DSU search failed: %s", exc)
        result.error = "gov.uk could not be reached."
        return [], result
    # Full-text search also matches articles that merely list the substance
    # among many; keep the ones actually about it.
    rows = [
        r
        for r in rows
        if any(t in (r.get("title", "") + " " + r.get("description", "")).lower() for t in terms)
    ]
    sources: list[Source] = []
    for row in rows:
        published = parse_date(row.get("public_timestamp", "")) or ""
        sources.append(
            Source(
                id="",
                source_type="WORLDWIDE_REGULATORY_ACTIONS",
                registry="MHRA Drug Safety Update",
                title=row.get("title", ""),
                citation=(
                    f"Medicines and Healthcare products Regulatory Agency (MHRA). "
                    f"{row.get('title', '').rstrip('.')}. Drug Safety Update, {published or 'date not stated'}. "
                    f"https://www.gov.uk{row.get('link', '')}"
                ),
                url=f"https://www.gov.uk{row.get('link', '')}",
                excerpt=_clip(row.get("description", "")),
                published=published,
                in_interval=_within(published or None, start, end),
            )
        )
    # Interval first, then most recent: the memo asks what happened during
    # the reporting interval, but an action just before it is still relevant.
    sources = sorted(sources, key=lambda s: (0 if s.in_interval else 1, -(int(s.published[:4]) if s.published[:4].isdigit() else 0)))
    sources = sources[:MAX_DSU_RESULTS]
    result.count = len(sources)
    return sources, result


# ------------------------------------------------------------------ driver --


async def research(criterion: str, substance: str, interval: str) -> ResearchResult:
    """Query every registry that answers this criterion, in parallel."""
    registries = RESEARCH_CRITERIA.get(criterion)
    if not registries:
        raise ValueError(f"Criterion {criterion} is not researched from public sources.")
    start, end = split_interval(interval)
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers={"User-Agent": "SafetyInsightHub/1.0 (PSUR assessment)"}) as client:
        tasks = []
        for reg in registries:
            if reg == "pubmed":
                tasks.append(search_pubmed(client, substance, start, end))
            elif reg == "pubmed_reviews":
                tasks.append(search_pubmed(client, substance, start, end, reviews_only=True))
            elif reg == "label":
                tasks.append(search_label(client, substance, start, end))
            elif reg == "dsu":
                tasks.append(search_drug_safety_update(client, substance, start, end))
        results = await asyncio.gather(*tasks)
    out = ResearchResult()
    seen: set[str] = set()
    for sources, reg in results:
        out.registries.append(reg)
        for s in sources:
            if s.url and s.url + s.title in seen:
                continue
            seen.add(s.url + s.title)
            out.sources.append(s)
    for i, s in enumerate(out.sources, start=1):
        s.id = f"S{i}"
    return out
