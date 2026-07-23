// Whole-sample reliability statistics: ICC, Fleiss' kappa, and a multi-rater
// weighted-kappa generalization. These are intentionally separate from
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
 * One-way random-effects ICC, generalized for an unbalanced design (a
 * different number — and different identities — of raters per subject).
 * This is deliberately the one-way model (Shrout & Fleiss ICC(1,1)) rather
 * than the two-way model: the two-way model assumes a fixed panel of raters
 * who rate every subject, which doesn't hold here since encounters can be
 * rated by whichever reviewers happened to review that file.
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
 * Fleiss' kappa, generalized for unequal raters per subject via pairwise
 * pooling: observed agreement is the pooled proportion of agreeing rater
 * PAIRS across every subject (rather than averaging each subject's own
 * agreement proportion unweighted), so subjects with more raters correctly
 * contribute more pairs of evidence. This reduces to standard Fleiss' kappa
 * when every subject has the same rater count, and to standard Cohen's kappa
 * when every subject has exactly 2 raters.
 */
export function computeFleissKappa(subjectGroups) {
  const groups = usableGroups(subjectGroups, toCategoryKey)
  const n = groups.length
  if (n < 2) return null

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
  if (pExpected >= 1) return null

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
 * Multi-rater weighted kappa, using the same pairwise-pooling generalization
 * as computeFleissKappa above, but with quadratic distance weights over a
 * numeric/ordinal scale instead of exact category matches. Reduces to
 * standard quadratic-weighted Cohen's kappa when every subject has exactly
 * 2 raters.
 */
export function computeWeightedKappa(subjectGroups, meta = {}) {
  const groups = usableGroups(subjectGroups, v => toNumericValue(v, meta))
  const n = groups.length
  if (n < 2) return null

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

  // Expected weighted agreement from the pooled marginal distribution of
  // all ratings for this question (every unordered pair of distinct ratings
  // in the full pool, weighted the same way).
  let pExpectedSum = 0
  let pExpectedPairs = 0
  for (let i = 0; i < allValues.length; i++) {
    for (let j = i + 1; j < allValues.length; j++) {
      pExpectedSum += weight(allValues[i], allValues[j])
      pExpectedPairs += 1
    }
  }
  const pExpected = pExpectedPairs > 0 ? pExpectedSum / pExpectedPairs : 0
  if (pExpected >= 1) return null

  const kappa = (pObserved - pExpected) / (1 - pExpected)
  return {
    method: 'weighted_kappa',
    value: kappa,
    subjectCount: n,
    ratingCount: sumK,
  }
}

export function computeQuestionReliability(method, subjectGroups, meta = {}) {
  if (method === 'icc') return computeICC(subjectGroups, meta)
  if (method === 'cohen_kappa') return computeFleissKappa(subjectGroups)
  if (method === 'weighted_kappa') return computeWeightedKappa(subjectGroups, meta)
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
