"""The research feature's one promise: every citation came from a registry.

A remark the model writes about a source that was never retrieved must not
survive, because its citation could only be invented. These tests pin that,
plus the date and interval parsing that decides "within the reporting
interval" — read wrongly, it would quietly sort real evidence out of view.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from server.ai.research import (  # noqa: E402
    Source,
    label_sources,
    parse_date,
    parse_pubmed_xml,
    pubmed_citation,
    split_interval,
)
from server.ai.schemas import AiEvidenceRoute, AiResearchSummary  # noqa: E402
from server.routes.ai_psur_memo import keep_grounded, route_by_keywords  # noqa: E402


def _source(i: int) -> Source:
    return Source(
        id=f"S{i}",
        source_type="PUBLISHED_LITERATURE",
        registry="PubMed",
        title=f"Study {i}",
        citation=f"Author {i} (2023). Study {i}. PMID: {i}. https://pubmed.ncbi.nlm.nih.gov/{i}/",
        url=f"https://pubmed.ncbi.nlm.nih.gov/{i}/",
        excerpt=f"Abstract {i}",
    )


def test_a_remark_naming_an_unretrieved_source_is_dropped():
    sources = [_source(1), _source(2)]
    summary = AiResearchSummary.model_validate(
        {
            "candidates": [
                {"source_id": "S2", "remark": "Seizures reported.", "relevance": "high"},
                {"source_id": "S9", "remark": "An invented study found X.", "relevance": "HIGH"},
            ]
        }
    )
    kept = keep_grounded(summary, sources)
    assert [c.source_id for c in kept] == ["S2"]
    assert kept[0].citation == sources[1].citation
    assert kept[0].summarised_by_ai is True


def test_the_citation_is_the_registrys_never_the_models():
    summary = AiResearchSummary.model_validate(
        {"candidates": [{"source_id": "s1", "remark": "See doi:10.9999/fake", "relevance": "LOW"}]}
    )
    kept = keep_grounded(summary, [_source(1)])
    assert kept[0].citation.startswith("Author 1 (2023)")
    assert "fake" not in kept[0].citation


def test_a_source_is_summarised_once_and_empty_remarks_are_dropped():
    summary = AiResearchSummary.model_validate(
        {
            "candidates": [
                {"source_id": "S1", "remark": "First."},
                {"source_id": "S1", "remark": "Second."},
                {"source_id": "S2", "remark": "   "},
            ]
        }
    )
    assert [c.content for c in keep_grounded(summary, [_source(1), _source(2)])] == ["First."]


def test_malformed_candidates_do_not_cost_the_others():
    summary = AiResearchSummary.model_validate(
        {"candidates": [{"remark": "no id"}, {"source_id": "S1", "remark": "ok"}, "junk"]}
    )
    assert len(summary.candidates) == 1


def test_dates_in_the_shapes_psurs_and_registries_use():
    assert parse_date("12 November 2021") == "2021-11-12"
    assert parse_date("1st Jan 2020") == "2020-01-01"
    assert parse_date("November 12, 2024") == "2024-11-12"
    assert parse_date("20251120") == "2025-11-20"
    assert parse_date("2024-06-20T10:11:09Z") == "2024-06-20"
    assert parse_date("03/09/2026") == "2026-09-03"  # day first
    assert parse_date("sometime in 2020") is None


def test_the_reporting_interval_splits_into_bounds():
    assert split_interval("12 November 2021 to 12 November 2024") == ("2021-11-12", "2024-11-12")
    assert split_interval("2021-11-12 - 2024-11-12") == ("2021-11-12", "2024-11-12")
    assert split_interval("") == (None, None)


PUBMED_XML = """<?xml version="1.0"?>
<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>12345</PMID><Article>
<Journal><JournalIssue><PubDate><Year>2023</Year></PubDate></JournalIssue><Title>Pain Medicine</Title></Journal>
<ArticleTitle>Tramadol and seizure risk: a cohort study.</ArticleTitle>
<Abstract><AbstractText Label="RESULTS">Seizures were more frequent.</AbstractText></Abstract>
<AuthorList><Author><LastName>Okafor</LastName><Initials>A</Initials></Author>
<Author><LastName>Bello</LastName><Initials>T</Initials></Author></AuthorList>
<ArticleDate><Year>2023</Year><Month>05</Month><Day>02</Day></ArticleDate>
</Article></MedlineCitation>
<PubmedData><ArticleIdList><ArticleId IdType="doi">10.1000/xyz</ArticleId></ArticleIdList></PubmedData>
</PubmedArticle></PubmedArticleSet>"""


def test_pubmed_records_become_full_citations():
    [a] = parse_pubmed_xml(PUBMED_XML)
    assert a["published"] == "2023-05-02"
    cite = pubmed_citation(a)
    assert cite.startswith("Okafor A, Bello T (2023). Tramadol and seizure risk: a cohort study.")
    assert "doi:10.1000/xyz" in cite
    assert "https://pubmed.ncbi.nlm.nih.gov/12345/" in cite


def test_label_sections_cite_dailymed_and_know_their_date():
    label = {
        "set_id": "abc-123",
        "effective_time": "20230215",
        "openfda": {"brand_name": ["Ultram"], "manufacturer_name": ["Janssen"]},
        "recent_major_changes": ["Boxed Warning 02/2023"],
        "boxed_warning": ["WARNING: ADDICTION"],
    }
    out = label_sources(label, "tramadol", "2021-11-12", "2024-11-12")
    assert [s.title.split(" — ")[0] for s in out] == ["Recent major changes", "Boxed warning"]
    assert all("dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=abc-123" in s.citation for s in out)
    # The effective date is publication, not change: no interval verdict.
    assert all(s.in_interval is None for s in out)


def test_pasted_text_routes_by_its_own_words_without_ai():
    r = route_by_keywords("3 ADR reports on VigiFlow from Nigeria during the interval")
    assert r.criterion == "PATIENT_EXPOSURE"
    assert r.ai_used is False
    assert route_by_keywords("hello").confidence == 0.0


def test_the_model_cannot_route_to_a_criterion_that_does_not_exist():
    import pytest

    with pytest.raises(Exception):
        AiEvidenceRoute.model_validate({"criterion": "PRODUCT_IDENTITY", "confidence": 0.9, "reason": "x"})


def test_combination_products_search_each_component():
    from server.ai.research import substance_terms

    assert substance_terms("Amoxicillin (as trihydrate) / Clavulanate potassium") == ["amoxicillin", "clavulanate"]
    assert substance_terms("Tramadol hydrochloride") == ["tramadol"]
    assert substance_terms("Artemether + Lumefantrine") == ["artemether", "lumefantrine"]
    assert substance_terms("tramadol") == ["tramadol"]
