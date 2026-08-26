import re
import csv
from datetime import datetime

# Simulated database of local Nigerian medical journal articles and local news reports
MOCK_ARTICLES = [
    {
        "id": "AJMMS-2026-004",
        "title": "A review of therapeutic outcomes and adverse profiles in hypertensive cohorts in Ibadan",
        "journal": "African Journal of Medicine and Medical Sciences",
        "date": "2026-02-14",
        "author": "Okeke et al.",
        "text": "A total of 120 patients on Amlodipine monotherapy were reviewed. Five patients reported severe peripheral edema and acute skin rash. One patient developed unexpected acute liver injury, raising potential drug safety concerns."
    },
    {
        "id": "NMJ-2026-112",
        "title": "Efficacy of novel antimalarial combinations in pediatric populations in Kano",
        "journal": "Nigerian Medical Journal",
        "date": "2026-03-01",
        "author": "Yusuf, A. & Bello, M.",
        "text": "We monitored 80 subjects undergoing therapy with Artemether-Lumefantrine. Mild nausea and headache were common, and resolved spontaneously. No severe adverse events or cardiac QT prolongation were observed."
    },
    {
        "id": "LAGOS-HEALTH-NEWS",
        "title": "Suspected counterfeit paracetamol syrup batch flags toxicity scare in Lagos state",
        "journal": "Lagos Health Watch",
        "date": "2026-03-10",
        "author": "Staff Reporter",
        "text": "The Ministry of Health has cautioned hospitals regarding a specific batch of paracetamol syrup following three cases of severe hepatotoxicity in young children. Adverse drug reactions were reported at Lagos State University Teaching Hospital (LASUTH)."
    },
    {
        "id": "AJMMS-2026-009",
        "title": "Managing diabetic neuropathy in urban clinical settings: A multi-center study",
        "journal": "African Journal of Medicine and Medical Sciences",
        "date": "2026-03-15",
        "author": "Eze, C.",
        "text": "Metformin and Gabapentin combination was well-tolerated across the 200 enrolled patients. Glycemic control was optimized with minimal gastrointestinal discomfort and no major toxicities or drug-drug interactions reported."
    }
]

# Standard Pharmacovigilance safety keywords (using non-capturing groups (?:...) to prevent findall tuple issues)
SAFETY_KEYWORDS = [
    r"adverse\s*(?:drug)?\s*reaction", r"adverse\s*event", r"side\s*effect",
    r"toxicity", r"hepatotoxicity", r"liver\s*injury", r"kidney\s*damage", r"renal\s*failure",
    r"anaphylaxis", r"edema", r"rash", r"skin\s*reaction", r"cardiac", r"arrhythmia",
    r"hospitalization", r"death", r"fatal", r"overdose", r"counterfeit", r"toxic"
]

def screen_literature(articles, keywords):
    """
    Screens medical texts for safety keywords, returning matches and high-risk signals.
    """
    signals_flagged = []
    pattern = re.compile("|".join(keywords), re.IGNORECASE)
    
    for article in articles:
        text_to_screen = f"{article['title']} {article['text']}"
        matches = [m.group(0).lower().strip() for m in pattern.finditer(text_to_screen)]
        
        if matches:
            unique_matches = sorted(list(set(matches)))
            
            # Determine risk level based on keyword severity
            is_high_risk = any(k in unique_matches for k in ["toxicity", "hepatotoxicity", "liver injury", "fatal", "death", "counterfeit", "renal failure"])
            
            signals_flagged.append({
                "Article ID": article["id"],
                "Source/Journal": article["journal"],
                "Date": article["date"],
                "Author": article["author"],
                "Title": article["title"],
                "Flagged Safety Keywords": ", ".join(unique_matches),
                "Risk Level": "HIGH" if is_high_risk else "MODERATE",
                "Flagged Snippet": extract_context(text_to_screen, unique_matches[0])
            })
            
    return signals_flagged

def extract_context(text, keyword, chars_context=80):
    """
    Extracts a small text snippet around the matched safety keyword for rapid QPPV review.
    """
    match = re.search(re.escape(keyword), text, re.IGNORECASE)
    if not match:
        return text[:chars_context] + "..."
    start = max(0, match.start() - chars_context // 2)
    end = min(len(text), match.end() + chars_context // 2)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    # Replace newlines for clean display
    return snippet.strip().replace("\n", " ")

def export_to_csv(flagged_signals, filename):
    keys = ["Article ID", "Source/Journal", "Date", "Author", "Title", "Flagged Safety Keywords", "Risk Level", "Flagged Snippet"]
    with open(filename, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=keys)
        writer.writeheader()
        writer.writerows(flagged_signals)

if __name__ == "__main__":
    print("=== MEDNOVA LIFESCIENCES: LITERATURE PV SCREENING TOOL ===")
    print(f"Screening date: {datetime.now().strftime('%Y-%m-%d')}")
    print(f"Analyzing {len(MOCK_ARTICLES)} local publications/news entries...\n")
    
    signals = screen_literature(MOCK_ARTICLES, SAFETY_KEYWORDS)
    
    print(f"✔ Screening Complete. Flagged {len(signals)} safety signals requiring QPPV review.\n")
    
    for idx, signal in enumerate(signals, 1):
        print(f"[{idx}] {signal['Source/Journal']} - {signal['Title']}")
        print(f"    Risk Level: {signal['Risk Level']}")
        print(f"    Keywords Detected: {signal['Flagged Safety Keywords']}")
        print(f"    Context: {signal['Flagged Snippet']}")
        print("-" * 60)
        
    csv_file = "/workspace/scratch/mednova_literature_safety_signals.csv"
    export_to_csv(signals, csv_file)
    print(f"\n[System Info] Exported safety signals database to: {csv_file}")
