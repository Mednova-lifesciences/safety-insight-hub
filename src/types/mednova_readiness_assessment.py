import streamlit as st

st.set_page_config(
    page_title="MedNova - NAFDAC PV Readiness",
    page_icon="🏥",
    layout="centered"
)

# Custom Styling
st.markdown("""
<style>
    .main-title {
        font-size: 32px;
        font-weight: bold;
        color: #0F52BA;
        margin-bottom: 10px;
    }
    .subtitle {
        font-size: 18px;
        color: #555555;
        margin-bottom: 30px;
    }
    .card {
        padding: 20px;
        border-radius: 10px;
        background-color: #F8F9FA;
        border-left: 5px solid #0F52BA;
        margin-bottom: 20px;
    }
    .cta-box {
        padding: 20px;
        border-radius: 10px;
        background-color: #EBF3FC;
        border: 1px solid #B9D6F2;
        margin-top: 30px;
    }
</style>
""", unsafe_html=True)

st.markdown('<div class="main-title">MedNova Lifesciences</div>', unsafe_html=True)
st.markdown('<div class="subtitle">Interactive NAFDAC QPPV & PV Compliance Readiness Assessment</div>', unsafe_html=True)

st.write(
    "Under **NAFDAC's pharmacovigilance guidelines (reinforced by Nigeria's WHO ML3 status)**, "
    "Marketing Authorization Holders (MAHs) must maintain strict, continuous, and in-country safety monitoring. "
    "Take this quick 2-minute assessment to identify gaps in your Nigerian PV compliance."
)

st.divider()

# Questions and scoring model
questions = {
    "q1": {
        "text": "1. Do you have a permanently resident, qualified QPPV physically located in Nigeria?",
        "critical": True,
        "advice": "NAFDAC requires a permanently resident, qualified QPPV in-country. Outsourcing this to MedNova ensures immediate, continuous compliance."
    },
    "q2": {
        "text": "2. Do you have a formally designated deputy/backup QPPV in Nigeria to ensure continuous coverage?",
        "critical": True,
        "advice": "Continuous PV coverage is legally mandated. You must have backup provisions in place for when your primary QPPV is unavailable."
    },
    "q3": {
        "text": "3. Is there a named Local Safety Officer (LSO) or Local Contact Person for PV registered with NAFDAC?",
        "critical": False,
        "advice": "Having an explicit, registered in-country point of contact streamlines regulatory queries and prevents administrative delays."
    },
    "q4": {
        "text": "4. Is your Pharmacovigilance System Master File (PSMF) fully localized and regularly updated for Nigerian operations?",
        "critical": True,
        "advice": "A global PSMF is not enough. NAFDAC expects local annexes or a localized PSMF detailing Nigerian safety infrastructure."
    },
    "q5": {
        "text": "5. Do you have an active, validated pathway for capturing and processing local Adverse Drug Reactions (ADRs)?",
        "critical": True,
        "advice": "You must be able to ingest, process, and report local spontaneous ADR cases (ICSRs) within NAFDAC's strict timelines."
    },
    "q6": {
        "text": "6. Do you conduct weekly literature monitoring across local Nigerian medical journals and news sources?",
        "critical": False,
        "advice": "Global literature databases often miss regional Nigerian publications. MedNova offers automated local screening to solve this exact bottleneck."
    },
    "q7": {
        "text": "7. Are you actively tracking and submitting PSURs/PBRERs in alignment with NAFDAC regulatory cycles?",
        "critical": False,
        "advice": "Periodic safety reports must be synchronized with NAFDAC schedules. MedNova manages the entire authoring and submission cycle."
    },
    "q8": {
        "text": "8. Have you submitted product-specific Risk Management Plans (RMP) or educational materials to NAFDAC?",
        "critical": False,
        "advice": "Products with specific risk profiles require customized RMPs and localized risk minimization measures (aRMMs)."
    },
    "q9": {
        "text": "9. Do you have a formalized process for safety signal detection and escalation of safety concerns in Nigeria?",
        "critical": True,
        "advice": "NAFDAC expects proactive safety screening, not just passive reporting. Signal management is a core QPPV requirement."
    },
    "q10": {
        "text": "10. Are your local PV SOPs and training records audit-ready for a surprise NAFDAC inspection?",
        "critical": True,
        "advice": "Inspection readiness is key. MedNova conducts gap analyses and pre-audit dry runs to protect your marketing authorization."
    }
}

# Collect Answers
answers = {}
score = 0
critical_gaps = []
general_gaps = []

for key, q in questions.items():
    ans = st.radio(q["text"], ["Yes", "No", "In Progress"], index=1, key=key)
    answers[key] = ans
    if ans == "Yes":
        score += 10
    elif ans == "No":
        if q["critical"]:
            critical_gaps.append(q["advice"])
        else:
            general_gaps.append(q["advice"])
    elif ans == "In Progress":
        score += 5
        if q["critical"]:
            critical_gaps.append(f"(In Progress) {q['advice']}")

st.divider()

# Results Header
st.subheader("Your Compliance Score")

col1, col2 = st.columns([1, 2])

with col1:
    if score >= 80:
        st.metric(label="Status", value=f"{score}%", delta="Low Risk", delta_color="normal")
    elif score >= 50:
        st.metric(label="Status", value=f"{score}%", delta="Moderate Risk", delta_color="off")
    else:
        st.metric(label="Status", value=f"{score}%", delta="High Risk", delta_color="inverse")

with col2:
    if score == 100:
        st.success("Excellent! Your pharmacovigilance system is fully robust and aligned with NAFDAC guidelines.")
    elif score >= 80:
        st.info("Good foundation, but a few gaps remain to guarantee absolute compliance and audit readiness.")
    else:
        st.warning("Action Required! Your PV framework has significant exposure areas that could trigger regulatory audits or license issues.")

# Gaps Analysis
if critical_gaps or general_gaps:
    st.subheader("Actionable Recommendations")
    
    if critical_gaps:
        st.markdown("### 🛑 Critical Compliance Exposure Points")
        for gap in critical_gaps:
            st.error(gap)
            
    if general_gaps:
        st.markdown("### ⚠️ Process Optimization Gaps")
        for gap in general_gaps:
            st.info(gap)

# CTA
st.markdown('<div class="cta-box">', unsafe_html=True)
st.markdown("### 🚀 Close Your Compliance Gaps with MedNova Lifesciences")
st.markdown(
    "Don't leave your marketing authorization to chance. MedNova provides "
    "**fully outsourced, NAFDAC-compliant resident QPPV services, Local Safety Officers (LSOs), "
    "local literature monitoring, and turn-key inspection-readiness support.**"
)
st.markdown("**[Request a QPPV Retainer Proposal](mailto:info@mednovalife.com?subject=NAFDAC%20Ready%20Proposal%20Request)**")
st.markdown('</div>', unsafe_html=True)
