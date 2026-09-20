/**
 * Country codes, for the three places E2B(R3) asks for one and means three
 * different things:
 *
 *  - C.2.r.3  the reporter's / primary source's country
 *  - E.i.9    the country the reaction/event occurred in
 *  - C.1.1    whose country component is the primary source's country
 *
 * They are deliberately not one value. A reporter in Kenya may report a
 * reaction that happened in Nigeria; both facts are true and both belong in
 * the message. Nothing in this module copies one into another — callers ask
 * for the country they mean.
 *
 * ICH E2B(R3) Q&A correction, applied here: E.i.9 is NOT an alternative to
 * the reporter's country code, and a change of E.i.9 must never change the
 * Sender's (Case) Safety Report Unique Identifier. Older E2B(R3) wording
 * suggesting E.i.9 could supply C.1.1's country when the primary source's
 * country is unknown is withdrawn, so no such fallback exists in this code.
 *
 * Validation is offline and deterministic: the assigned ISO 3166-1 alpha-2
 * codes below. "XX" and "ZZ" are user-assigned ranges, not assigned codes,
 * so they are rejected like any other two letters that mean nothing.
 */

/** The 249 officially assigned ISO 3166-1 alpha-2 codes. */
const ISO_3166_1_ALPHA_2 = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO " +
    "BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ " +
    "DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP " +
    "GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG " +
    "KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML " +
    "MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE " +
    "PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL " +
    "SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM " +
    "US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

/**
 * Country names this application accepts in a source column, mapped to
 * their code. Deliberately not exhaustive: a name nobody listed here
 * resolves to nothing rather than to a guess, and the caller's fallback
 * applies. Covers the countries this deployment actually sees plus the
 * spellings and abbreviations line lists commonly use.
 */
const COUNTRY_NAME_TO_CODE: Readonly<Record<string, string>> = {
  NIGERIA: "NG",
  FEDERALREPUBLICOFNIGERIA: "NG",
  BENIN: "BJ",
  BURKINAFASO: "BF",
  CAMEROON: "CM",
  CHAD: "TD",
  COTEDIVOIRE: "CI",
  IVORYCOAST: "CI",
  EGYPT: "EG",
  ETHIOPIA: "ET",
  GAMBIA: "GM",
  THEGAMBIA: "GM",
  GHANA: "GH",
  GUINEA: "GN",
  KENYA: "KE",
  LIBERIA: "LR",
  MALAWI: "MW",
  MALI: "ML",
  MOROCCO: "MA",
  MOZAMBIQUE: "MZ",
  NAMIBIA: "NA",
  NIGER: "NE",
  RWANDA: "RW",
  SENEGAL: "SN",
  SIERRALEONE: "SL",
  SOUTHAFRICA: "ZA",
  SOUTHSUDAN: "SS",
  SUDAN: "SD",
  TANZANIA: "TZ",
  UNITEDREPUBLICOFTANZANIA: "TZ",
  TOGO: "TG",
  UGANDA: "UG",
  ZAMBIA: "ZM",
  ZIMBABWE: "ZW",
  UNITEDKINGDOM: "GB",
  UNITEDKINGDOMOFGREATBRITAINANDNORTHERNIRELAND: "GB",
  UK: "GB",
  GREATBRITAIN: "GB",
  ENGLAND: "GB",
  UNITEDSTATES: "US",
  UNITEDSTATESOFAMERICA: "US",
  USA: "US",
  CANADA: "CA",
  FRANCE: "FR",
  GERMANY: "DE",
  IRELAND: "IE",
  ITALY: "IT",
  NETHERLANDS: "NL",
  SPAIN: "ES",
  SWEDEN: "SE",
  SWITZERLAND: "CH",
  BELGIUM: "BE",
  DENMARK: "DK",
  NORWAY: "NO",
  PORTUGAL: "PT",
  INDIA: "IN",
  CHINA: "CN",
  JAPAN: "JP",
  BRAZIL: "BR",
  AUSTRALIA: "AU",
  NEWZEALAND: "NZ",
  SAUDIARABIA: "SA",
  UNITEDARABEMIRATES: "AE",
};

/**
 * MedNova application fallback — NOT an ICH requirement.
 *
 * ICH does not name a default country for an ICSR; a country that cannot be
 * established is genuinely unknown. This product serves Nigerian reporting,
 * and the organization's decision is that a case whose country cannot be
 * determined from the source is reported as Nigerian rather than blocked.
 * It applies only where nothing in the data answers the question.
 */
export const MEDNOVA_COUNTRY_FALLBACK = "NG";

/**
 * A source value -> an ISO 3166-1 alpha-2 code, or undefined when the value
 * names no country this module knows. Accepts a code in any case, or one of
 * the names above. Never guesses from a name, a city, a phone number or an
 * organisation: a value that is not recognisably a country returns nothing.
 */
export function resolveCountryCode(value: string | undefined | null): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  const upper = raw.toUpperCase();
  if (upper.length === 2 && ISO_3166_1_ALPHA_2.has(upper)) return upper;

  // Otherwise a name. Spacing and punctuation vary wildly between line
  // lists ("Cote d'Ivoire", "COTE D IVOIRE", "United-Kingdom"), so the
  // lookup is on letters alone. Two letters that are not an assigned code
  // still reach this — "UK" is a name people write, not an ISO code.
  const letters = upper.replace(/[^A-Z]/g, "");
  return COUNTRY_NAME_TO_CODE[letters];
}

/** True for an assigned ISO 3166-1 alpha-2 code, in any case. */
export function isIsoCountryCode(value: string | undefined | null): boolean {
  const upper = value?.trim().toUpperCase();
  return !!upper && upper.length === 2 && ISO_3166_1_ALPHA_2.has(upper);
}

/**
 * C.2.r.3 — the reporter's / primary source's country, resolved in the only
 * order that is defensible:
 *
 *   1. what the row itself says, when the line list has such a column
 *   2. the source profile's country, when that profile stands for one
 *      country's reporting (an Ondo AEFI form is always reported from NG)
 *   3. the application fallback above
 *
 * The country the reaction occurred in (E.i.9) is never consulted here: it
 * answers a different question, and the ICH Q&A is explicit that it is not
 * an alternative to this field.
 */
export function resolveReporterCountry(sources: {
  row?: string | undefined;
  profile?: string | undefined;
}): { code: string; from: "row" | "profile" | "fallback" } {
  const row = resolveCountryCode(sources.row);
  if (row) return { code: row, from: "row" };
  const profile = resolveCountryCode(sources.profile);
  if (profile) return { code: profile, from: "profile" };
  return { code: MEDNOVA_COUNTRY_FALLBACK, from: "fallback" };
}

/**
 * E.i.9 — the country the reaction/event occurred in. Only ever what the
 * source actually says: there is no fallback, because a fabricated place of
 * occurrence is a clinical claim this pipeline has no basis to make. When
 * the source is silent the element is simply not emitted.
 */
export function resolveReactionCountry(value: string | undefined): string | undefined {
  return resolveCountryCode(value);
}
