// Whole-sample reliability statistics: ICC, Cohen's/Fleiss' kappa, weighted
// kappa, and weighted Fleiss' kappa. These are intentionally separate from
// interraterAgreement.mjs, which computes lightweight percent-style agreement
// PER MEDIA FILE. The functions here instead pool every rating for a single
// question ACROSS every rated encounter in the project, which is the only way
// ICC/kappa are statistically meaningful (matching the UCAT paper's own
// methodology: one ICC per dimension across all 100 rated videos, not one
// per video).
//
// Input shape for every function here is the same: `subjectGroups`, an array
// where each entry is one "subject" (one media file / encounter) and holds
// the array of that question's raw values from every reviewer who rated it.
// Subjects with fewer than 2 raters carry no agreement information and are
// dropped before computing anything.
//
// CHANGE LOG (fixes applied 2026-08-10, see conversation for rationale):
// 1. computeFleissKappa() previously returned method: 'cohen_kappa'. Fixed —
//    it now returns 'fleiss_kappa'. computeQuestionReliability('cohen_kappa')
//    now calls the new computeCohenKappa(), a distinct function that
//    requires exactly 2 raters per subject throughout (the conventional
//    two-fixed-rater statistic), rather than silently aliasing Fleiss.
// 2. computeWeightedKappa()'s expected agreement previously averaged the
//    weight function over all distinct without-replacement pairs from the
//    flattened rating pool. That's a different (asymptotically similar, but
//    biased at small N) estimator than the standard chance-expectation
//    formula. Fixed to use the same marginal-proportion formulation
//    (Pe = sum_i sum_j p_i*p_j*w(i,j)) that the SDMo weighted-Fleiss
//    function already used correctly.
// 3. computeWeightedFleissKappaSixPointBanded() has been generalized into
//    computeWeightedFleissKappa(), which takes the category count and an
//    optional banding function as parameters instead of hardcoding SDMo's
//    6-point-to-4-band scale. The SDMo-specific behavior is now just one
//    configuration of the general function, kept as a thin wrapper for
//    backward compatibility.
// 4. Added checkRaterCountConsistency() — the pooled-pair aggregation in
//    computeFleissKappa/computeWeightedKappa/computeWeightedFleissKappa is
//    only equivalent to per-subject-averaged agreement when every subject
//    has the SAME number of raters. That holds for this project's design
//    (every encounter in a given analysis has either all-2 or all-3
//    raters), so the pooled-pair formulas were left as-is rather than
//    rewritten to per-subject averaging — but a mismatch should now be
//    flagged explicitly rather than silently pooled, in case that
//    assumption is ever violated by a future dataset.

// Labels for the Statistics / Inter-rater reliability page's method
// dropdown, deliberately separate from interraterAgreement.mjs's
// AGREEMENT_METHOD_LABELS. That file's list also includes ordinal distance,
// numeric distance, and set overlap — legitimate defaults for the per-file
// Alignment/Agreement Between Results view, but not real reliability
// statistics, and computeQuestionReliability() below has never been able to
// compute them. This list is exactly the set of methods that function
// supports, so a UI built from this constant can't offer an option that
// silently returns null.
export const RELIABILITY_METHOD_LABELS = {
  icc: 'Intraclass correlation (ICC)',
  cohen_kappa: "Cohen's kappa",
  fleiss_kappa: "Fleiss' kappa",
  weighted_kappa: 'Weighted kappa',
  weighted_fleiss_kappa: "Weighted Fleiss' kappa",
  percent: 'Percent agreement',
}

function toNumericValue(value, meta = {}) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  if (Number.isFinite(parsed)) return parsed
  if (Array.isArray(meta.options)) {
    const index = meta.options.findIndex(option => String(option).trim().toLowerCase() === String(value).trim().toLowerCase())
    if (index >= 0) return index
  }
  return null
}

function toCategoryKey(value) {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '' ? null : normalized
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return null }
}

// Subjects (media files) with < 2 usable values contribute nothing to
// agreement and are excluded rather than treated as perfect/zero agreement.
function usableGroups(subjectGroups, toValue) {
  return subjectGroups
    .map(group => group.map(v => toValue(v)).filter(v => v !== null))
    .filter(group => group.length >= 2)
}

/**
 * Checks whether every subject in this analysis has the same number of
 * usable raters. The pooled-pair aggregation used by computeFleissKappa,
 * computeWeightedKappa, and computeWeightedFleissKappa is mathematically
 * equivalent to averaging each subject's own agreement proportion ONLY when
 * rater counts are constant across subjects. If counts vary (e.g. 80
 * encounters with 2 raters, 20 with 3), subjects with more raters silently
 * contribute more weight to the pooled result. Call this before trusting a
 * kappa-family statistic, and surface a warning in the UI if consistent is
 * false rather than reporting the number unqualified.
 */
export function checkRaterCountConsistency(subjectGroups, toValue = toCategoryKey) {
  const groups = usableGroups(subjectGroups, toValue)
  const counts = groups.map(g => g.length)
  const distinctCounts = [...new Set(counts)]
  return {
    consistent: distinctCounts.length <= 1,
    raterCounts: distinctCounts.sort((a, b) => a - b),
    subjectCount: groups.length,
    // Histogram of how many subjects had each rater count, e.g. {2: 80, 3: 20}
    countsBySubjectCount: counts.reduce((acc, k) => { acc[k] = (acc[k] || 0) + 1; return acc }, {}),
  }
}

/**
 * One-way random-effects ICC, generalized for an unbalanced design (a
 * different number — and different identities — of raters per subject).
 * This is deliberately the one-way model (Shrout & Fleiss ICC(1,1)) rather
 * than the two-way model: the two-way model assumes a fixed panel of raters
 * who rate every subject, which doesn't hold here since encounters can be
 * rated by whichever reviewers happened to review that file. If your
 * reviewer assignment is actually a fixed panel rating every encounter,
 * confirm ICC(1,1) is still the right choice before relying on this for
 * publication — the two-way models (ICC(2,1)/ICC(3,1)) have different
 * substantive assumptions and can give materially different values.
 */
export function computeICC(subjectGroups, meta = {}) {
  const groups = usableGroups(subjectGroups, v => toNumericValue(v, meta))
  const n = groups.length
  if (n < 2) return null

  const kList = groups.map(g => g.length)
  const sumK = kList.reduce((a, b) => a + b, 0)
  const dfWithin = sumK - n
  if (dfWithin <= 0) return null

  const grandMean = groups.flat().reduce((a, b) => a + b, 0) / sumK

  let ssBetween = 0
  let ssWithin = 0
  const subjectMeans = groups.map(g => g.reduce((a, b) => a + b, 0) / g.length)
  groups.forEach((g, i) => {
    ssBetween += g.length * (subjectMeans[i] - grandMean) ** 2
    ssWithin += g.reduce((sum, v) => sum + (v - subjectMeans[i]) ** 2, 0)
  })

  const dfBetween = n - 1
  const bms = ssBetween / dfBetween
  const wms = ssWithin / dfWithin

  // Harmonic-mean-style correction factor for unequal group sizes (n0),
  // reduces to the plain k when every subject has the same rater count.
  const sumKSquared = kList.reduce((a, b) => a + b * b, 0)
  const n0 = (sumK - sumKSquared / sumK) / dfBetween
  if (!Number.isFinite(n0) || n0 <= 0) return null

  const denominator = bms + (n0 - 1) * wms
  if (denominator === 0) return null
  const icc = (bms - wms) / denominator

  return {
    method: 'icc',
    value: Math.max(-1, Math.min(1, icc)),
    subjectCount: n,
    ratingCount: sumK,
  }
}

/**
 * Cohen's kappa — the conventional statistic for exactly two fixed,
 * identifiable raters rating every subject. Requires every usable subject
 * to have EXACTLY 2 ratings; if any subject has a different count, this
 * returns null with a reason so the caller can fall back to Fleiss' kappa
 * (which is the correct choice once there are more than 2 raters, or raters
 * are not the same fixed pair throughout).
 */
export function computeCohenKappa(subjectGroups) {
  const groups = usableGroups(subjectGroups, toCategoryKey)
  const n = groups.length
  if (n < 1) return null

  const nonPairSubjects = groups.filter(g => g.length !== 2).length
  if (nonPairSubjects > 0) {
    return { method: 'cohen_kappa', value: null, reason: 'requires_exactly_two_raters', subjectCount: n, ratingCount: groups.flat().length }
  }

  const categoryTotals = new Map()
  let agree = 0
  for (const [a, b] of groups) {
    categoryTotals.set(a, (categoryTotals.get(a) || 0) + 1)
    categoryTotals.set(b, (categoryTotals.get(b) || 0) + 1)
    if (a === b) agree += 1
  }
  const sumK = n * 2
  const pObserved = agree / n

  let pExpected = 0
  for (const count of categoryTotals.values()) {
    const p = count / sumK
    pExpected += p * p
  }
  if (pExpected >= 1) return { method: 'cohen_kappa', value: null, reason: 'no_variance', subjectCount: n, ratingCount: sumK }

  const kappa = (pObserved - pExpected) / (1 - pExpected)
  return {
    method: 'cohen_kappa',
    value: kappa,
    subjectCount: n,
    ratingCount: sumK,
    categoryCount: categoryTotals.size,
  }
}

/**
 * Fleiss' kappa, generalized for unequal raters per subject via pairwise
 * pooling: observed agreement is the pooled proportion of agreeing rater
 * PAIRS across every subject (rather than averaging each subject's own
 * agreement proportion unweighted), so subjects with more raters correctly
 * contribute more pairs of evidence. This is mathematically EQUIVALENT to
 * averaging each subject's own agreement proportion when every subject has
 * the same rater count — call checkRaterCountConsistency() first and treat
 * this result cautiously if it reports mixed counts, since that's the one
 * condition where pooled-pair and per-subject-averaged aggregation diverge.
 * Reduces to standard Cohen's kappa when every subject has exactly 2 raters
 * (though computeCohenKappa() above is the more conventionally-labeled
 * choice for that specific case).
 */
export function computeFleissKappa(subjectGroups) {
  const groups = usableGroups(subjectGroups, toCategoryKey)
  const n = groups.length
  // Unlike computeICC, this doesn't need 2+ subjects mathematically — both
  // pObserved and pExpected below are computed from pooled ratings, not
  // between-subject variance, so a single subject with 2+ raters is a
  // perfectly well-defined (if noisier) estimate.
  if (n < 1) return null

  const categoryTotals = new Map()
  let sumK = 0
  let agreeingPairs = 0
  let totalPairs = 0

  for (const group of groups) {
    const counts = new Map()
    for (const value of group) counts.set(value, (counts.get(value) || 0) + 1)
    const k = group.length
    sumK += k
    totalPairs += (k * (k - 1))
    for (const [category, count] of counts) {
      categoryTotals.set(category, (categoryTotals.get(category) || 0) + count)
      agreeingPairs += count * (count - 1)
    }
  }
  if (totalPairs === 0) return null

  const pObserved = agreeingPairs / totalPairs
  let pExpected = 0
  for (const count of categoryTotals.values()) {
    const p = count / sumK
    pExpected += p * p
  }
  // pExpected === 1 means every single rating across every subject fell into
  // the same category — zero variance. Kappa's denominator (1 - pExpected)
  // is then exactly zero, making it mathematically undefined, not merely
  // "not enough data" — worth a distinct signal so the UI can explain this
  // correctly instead of showing an unexplained blank result.
  if (pExpected >= 1) return { method: 'fleiss_kappa', value: null, reason: 'no_variance', subjectCount: n, ratingCount: sumK }

  const kappa = (pObserved - pExpected) / (1 - pExpected)
  return {
    method: 'fleiss_kappa',
    value: kappa,
    subjectCount: n,
    ratingCount: sumK,
    categoryCount: categoryTotals.size,
  }
}

/**
 * Multi-rater weighted kappa, using the same pairwise-pooling generalization
 * as computeFleissKappa above for observed agreement, but with quadratic
 * distance weights over a numeric/ordinal scale instead of exact category
 * matches. Expected agreement now uses the standard marginal-proportion
 * formulation (Pe = sum_i sum_j p_i*p_j*w(i,j)) rather than averaging the
 * weight function over flattened without-replacement pairs — this matches
 * the convention already used correctly by the weighted Fleiss function
 * below, and matches conventional weighted-kappa formulations generally.
 * Reduces to standard quadratic-weighted Cohen's kappa when every subject
 * has exactly 2 raters.
 */
export function computeWeightedKappa(subjectGroups, meta = {}) {
  const groups = usableGroups(subjectGroups, v => toNumericValue(v, meta))
  const n = groups.length
  if (n < 1) return null

  const allValues = groups.flat()
  const configuredRange = Number(meta.max) - Number(meta.min)
  const observedRange = Math.max(...allValues) - Math.min(...allValues)
  const range = Number.isFinite(configuredRange) && configuredRange > 0
    ? configuredRange
    : Math.max(1, observedRange)

  const weight = (a, b) => 1 - Math.min(1, ((a - b) ** 2) / (range ** 2))

  let sumK = 0
  let weightedAgreeingPairs = 0
  let totalPairs = 0
  for (const group of groups) {
    const k = group.length
    sumK += k
    for (let i = 0; i < k; i++) {
      for (let j = i + 1; j < k; j++) {
        weightedAgreeingPairs += weight(group[i], group[j])
        totalPairs += 1
      }
    }
  }
  if (totalPairs === 0) return null
  const pObserved = weightedAgreeingPairs / totalPairs

  // FIXED: expected weighted agreement from the pooled MARGINAL distribution
  // of ratings for this question (each distinct value's proportion of the
  // total pool), not from enumerating distinct observed pairs. This is the
  // standard chance-expectation formula and matches the SDMo weighted
  // Fleiss function's convention.
  const marginalCounts = new Map()
  for (const v of allValues) marginalCounts.set(v, (marginalCounts.get(v) || 0) + 1)
  const marginalEntries = [...marginalCounts.entries()].map(([value, count]) => ({ value: Number(value), p: count / sumK }))

  let pExpected = 0
  for (const a of marginalEntries) {
    for (const b of marginalEntries) {
      pExpected += a.p * b.p * weight(a.value, b.value)
    }
  }
  if (pExpected >= 1) return { method: 'weighted_kappa', value: null, reason: 'no_variance', subjectCount: n, ratingCount: sumK }

  const kappa = (pObserved - pExpected) / (1 - pExpected)
  return {
    method: 'weighted_kappa',
    value: kappa,
    subjectCount: n,
    ratingCount: sumK,
  }
}

/**
 * Plain (uncorrected) percent agreement, pooled across every rated encounter
 * for a single question — this is the per-subject "Pbar" mechanism (average
 * each subject's own agreement proportion, one subject = one vote),
 * reported directly rather than chance-corrected. Used for SDMo's binary
 * yes/no questions ("Did SDM likely occur?" and each category's
 * "present/not present"), where a plain percentage is what's wanted rather
 * than a kappa-style statistic. Categories are matched by exact value
 * (case-insensitive for strings).
 *
 * NOTE: this uses per-subject averaging, while computeFleissKappa above
 * uses global pair-pooling. These two are only guaranteed to agree on
 * observed agreement when rater counts are constant across subjects — check
 * checkRaterCountConsistency() if you need the two to be directly
 * comparable on the same data.
 */
export function computePooledPercentAgreement(subjectGroups) {
  const groups = usableGroups(subjectGroups, toCategoryKey)
  const n = groups.length
  // This is Pbar only — no chance-correction term — so it never needed
  // between-subject comparison to begin with. A single subject with 2+
  // raters is a completely valid (if small) percent-agreement estimate.
  if (n < 1) return null

  let sumK = 0
  let subjectAgreementSum = 0
  for (const group of groups) {
    const counts = new Map()
    for (const value of group) counts.set(value, (counts.get(value) || 0) + 1)
    const k = group.length
    sumK += k
    let agreeingPairs = 0
    for (const count of counts.values()) agreeingPairs += count * (count - 1)
    subjectAgreementSum += agreeingPairs / (k * (k - 1))
  }

  const pbar = subjectAgreementSum / n
  return {
    method: 'percent',
    value: pbar,
    subjectCount: n,
    ratingCount: sumK,
  }
}

// Collapses SDMo's raw 1–6 "SDM Occurrence" rating into the 4 ordinal bands
// the scale is actually built around: 1 = Definitely not, 2–3 = Probably
// not, 4–5 = Probably yes, 6 = Definitely yes. Kept as the SDMo-specific
// banding function passed into the generalized computeWeightedFleissKappa
// below.
function mapSixPointToFourBand(value) {
  if (value === 1) return 1
  if (value === 2 || value === 3) return 2
  if (value === 4 || value === 5) return 3
  if (value === 6) return 4
  return null
}

// Standard quadratic similarity weights over k ordinal categories:
// w(i,j) = 1 - (i-j)^2 / (k-1)^2. For k=4 this was verified numerically
// against the reference weighted-Fleiss-kappa calculator's own weight
// matrix (0.889/0.556/0 for distances of 1/2/3 categories).
function buildQuadraticWeights(k) {
  const w = []
  for (let i = 1; i <= k; i++) {
    const row = []
    for (let j = 1; j <= k; j++) row.push(1 - ((i - j) ** 2) / ((k - 1) ** 2))
    w.push(row)
  }
  return w
}

/**
 * GENERALIZED weighted Fleiss' kappa for any k-category ordinal scale (k >=
 * 2), with an optional banding function to collapse a finer raw scale into
 * k bands first (e.g. SDMo's 6-point -> 4-band collapse below). This
 * replaces the previous hardcoded-to-SDMo implementation: category count,
 * weight matrix, and banding are now parameters rather than baked in, so
 * any ordinal question type (likert, rating, or a custom banded scale) can
 * use the same, single implementation instead of a bespoke one per scale.
 *
 * Matched term-for-term against the reference weighted-Fleiss-kappa
 * calculator for the k=4 case: the per-encounter observed weighted
 * agreement uses category counts (not pairwise enumeration), and expected
 * agreement is computed from the pooled marginal proportions across every
 * encounter (Pe = sum_i sum_j p_i*p_j*w(i,j)) — the same convention now
 * also used by computeWeightedKappa above.
 *
 * @param subjectGroups raw values per subject, same shape as other functions
 * @param meta question meta (min/max/options/scale), passed to toNumericValue
 * @param options.categoryCount number of ordinal bands (k). Required.
 * @param options.bandingFn optional (rawValue) => bandedValue in [1..k].
 *   If omitted, raw values (rounded) are used directly as the k categories.
 */
export function computeWeightedFleissKappa(subjectGroups, meta = {}, options = {}) {
  const { categoryCount, bandingFn = null } = options
  const k = categoryCount
  if (!Number.isFinite(k) || k < 2) return null

  const bandedGroups = subjectGroups
    .map(group => group
      .map(v => toNumericValue(v, meta))
      .map(v => v == null ? null : (bandingFn ? bandingFn(v) : Math.round(v)))
      .filter(v => v !== null && v >= 1 && v <= k))
    .filter(group => group.length >= 2)
  const n = bandedGroups.length
  // Same reasoning as computeFleissKappa/computeWeightedKappa — Pbar and Pe
  // are both computed from pooled ratings, not between-subject variance, so
  // one subject with 2+ raters is mathematically sufficient.
  if (n < 1) return null

  const w = buildQuadraticWeights(k)
  const categoryTotals = new Map(Array.from({ length: k }, (_, i) => [i + 1, 0]))
  let sumK = 0
  let subjectAgreementSum = 0

  for (const group of bandedGroups) {
    const counts = new Map(Array.from({ length: k }, (_, i) => [i + 1, 0]))
    for (const value of group) counts.set(value, (counts.get(value) || 0) + 1)
    const kSubj = group.length
    sumK += kSubj
    for (const [cat, count] of counts) categoryTotals.set(cat, categoryTotals.get(cat) + count)

    // Per-encounter weighted observed agreement — for each category ki, the
    // weighted sum of all counts against ki's weight row, times n(ki),
    // summed over all ki, minus kSubj (self-pairs), divided by kSubj*(kSubj-1).
    let weightedSum = 0
    for (let ki = 1; ki <= k; ki++) {
      let rowSum = 0
      for (let kj = 1; kj <= k; kj++) rowSum += counts.get(kj) * w[ki - 1][kj - 1]
      weightedSum += rowSum * counts.get(ki)
    }
    subjectAgreementSum += (weightedSum - kSubj) / (kSubj * (kSubj - 1))
  }

  const pbar = subjectAgreementSum / n
  const proportions = Array.from({ length: k }, (_, i) => (categoryTotals.get(i + 1) || 0) / sumK)

  let pe = 0
  for (let ki = 0; ki < k; ki++) {
    for (let kj = 0; kj < k; kj++) {
      pe += proportions[ki] * proportions[kj] * w[ki][kj]
    }
  }
  if (pe >= 1) return { method: 'weighted_fleiss_kappa', value: null, reason: 'no_variance', subjectCount: n, ratingCount: sumK }

  const kappa = (pbar - pe) / (1 - pe)
  return {
    method: 'weighted_fleiss_kappa',
    value: kappa,
    subjectCount: n,
    ratingCount: sumK,
    categoryCount: k,
  }
}

/**
 * SDMo-specific configuration of computeWeightedFleissKappa: collapses the
 * raw 1-6 "SDM Occurrence" scale into 4 ordinal bands before scoring. Kept
 * as a named wrapper for backward compatibility and readability at call
 * sites, but no longer duplicates any calculation logic.
 */
export function computeWeightedFleissKappaSixPointBanded(subjectGroups, meta = {}) {
  return computeWeightedFleissKappa(subjectGroups, meta, { categoryCount: 4, bandingFn: mapSixPointToFourBand })
}

export function computeQuestionReliability(method, subjectGroups, meta = {}) {
  if (method === 'icc') return computeICC(subjectGroups, meta)
  // Dial/slider-type questions are numeric/continuous, not categorical or
  // ordinal-banded — ICC is the correct pooled reliability statistic for
  // this kind of data, same as it is for likert/rating questions configured
  // with agreement_method 'icc'. computeICC already labels its own output
  // 'icc' (not 'numeric'), which is accurate — that's genuinely the
  // statistic being computed, just applied to a numeric-typed question.
  if (method === 'numeric') return computeICC(subjectGroups, meta)
  if (method === 'cohen_kappa') return computeCohenKappa(subjectGroups)
  if (method === 'fleiss_kappa') return computeFleissKappa(subjectGroups)
  if (method === 'weighted_kappa') return computeWeightedKappa(subjectGroups, meta)
  if (method === 'percent') return computePooledPercentAgreement(subjectGroups)
  if (method === 'weighted_fleiss_kappa') {
    // meta.categoryCount / meta.bandingFn let a caller use the generalized
    // function directly for a non-SDMo ordinal scale; otherwise default to
    // the SDMo 6-point banding for backward compatibility.
    if (Number.isFinite(meta.categoryCount)) {
      return computeWeightedFleissKappa(subjectGroups, meta, { categoryCount: meta.categoryCount, bandingFn: meta.bandingFn || null })
    }
    return computeWeightedFleissKappaSixPointBanded(subjectGroups, meta)
  }
  return null
}

// Interpretation bands, cited directly from the same sources the UCAT paper
// itself uses, so labels shown in the app match the paper's own language.
export function iccInterpretation(value) {
  if (value == null) return null
  if (value < 0.40) return { label: 'Poor', source: 'Cicchetti, 1994' }
  if (value < 0.60) return { label: 'Fair', source: 'Cicchetti, 1994' }
  if (value < 0.75) return { label: 'Good', source: 'Cicchetti, 1994' }
  return { label: 'Excellent', source: 'Cicchetti, 1994' }
}

export function kappaInterpretation(value) {
  if (value == null) return null
  if (value < 0) return { label: 'Poor', source: 'Landis & Koch, 1977' }
  if (value < 0.20) return { label: 'Slight', source: 'Landis & Koch, 1977' }
  if (value < 0.40) return { label: 'Fair', source: 'Landis & Koch, 1977' }
  if (value < 0.60) return { label: 'Moderate', source: 'Landis & Koch, 1977' }
  if (value < 0.80) return { label: 'Substantial', source: 'Landis & Koch, 1977' }
  return { label: 'Almost perfect', source: 'Landis & Koch, 1977' }
}