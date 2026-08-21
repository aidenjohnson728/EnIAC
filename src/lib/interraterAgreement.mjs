export const DEFAULT_AGREEMENT_WEIGHTS = {
  default: 1,
  multiple_choice: 1,
  multiselect: 1,
  likert: 1,
  rating: 1,
  checkbox: 1,
  slider: 1,
  dial: 1,
  vertical_slider: 1,
  timestamp_select: 1,
  short_answer: 0.8,
  paragraph: 0.8,
  table: 0.6,
}

// CHANGE (2026-08-10): ordinal distance, numeric distance, and set overlap
// removed from the offered/default method list per request — this project
// wants plain percent (exact-match) agreement for likert/rating, slider-type,
// and multiselect questions instead of a partial-credit distance metric.
// The underlying agreementForOrdinal/agreementForNumeric/agreementForMultiselect
// functions are NOT deleted below: agreementForObject (used for 'item_group',
// i.e. table/likert_group questions) still calls them internally to score
// each row/item of a table, and agreementForWeightedKappa still needs
// ordinalValue/getOrdinalRange. This change only affects what a standalone
// question defaults to and what's offered as an explicit choice — it does
// not touch how table/likert_group sub-items are scored.
export const AGREEMENT_METHOD_LABELS = {
  auto: 'Auto',
  percent: 'Percent agreement',
  icc: 'Intraclass correlation (ICC)',
  cohen_kappa: "Cohen's kappa",
  weighted_kappa: 'Weighted kappa',
  weighted_fleiss_kappa: "Weighted Fleiss' kappa",
  timestamp: 'Timestamp tolerance',
  exact_text: 'Exact text match',
  item_group: 'Item-level agreement',
}

export function defaultAgreementEnabledForType(type) {
  return !['text_block', 'short_answer', 'paragraph'].includes(type)
}

export function defaultAgreementMethodForType(type) {
  if (type === 'timestamp_select') return 'timestamp'
  if (type === 'likert_group' || type === 'table') return 'item_group'
  if (type === 'short_answer' || type === 'paragraph') return 'exact_text'
  // multiselect (was 'set_overlap'), likert/rating (was 'ordinal'), and
  // slider/dial/vertical_slider (was 'numeric') now all fall through to the
  // default below and use plain percent/exact-match agreement.
  return 'percent'
}

function getTypeWeightsInput(weights = {}) {
  if (weights && typeof weights === 'object' && !Array.isArray(weights) && ('questionTypeWeights' in weights || 'questionWeights' in weights || 'perQuestion' in weights)) {
    return weights.questionTypeWeights || weights.typeWeights || {}
  }
  return weights || {}
}

export function normalizeAgreementWeights(weights = {}) {
  const next = { ...DEFAULT_AGREEMENT_WEIGHTS }
  const typeWeights = getTypeWeightsInput(weights)
  for (const [key, value] of Object.entries(typeWeights || {})) {
    if (typeof value === 'number' && Number.isFinite(value)) next[key] = Math.max(0, value)
  }
  return next
}

export function normalizeQuestionWeights(weights = {}) {
  const raw = weights?.questionWeights || weights?.perQuestion || {}
  const normalized = {}
  for (const [formId, questions] of Object.entries(raw || {})) {
    if (!questions || typeof questions !== 'object' || Array.isArray(questions)) continue
    const formWeights = {}
    for (const [questionId, value] of Object.entries(questions)) {
      if (typeof value === 'number' && Number.isFinite(value)) formWeights[String(questionId)] = Math.max(0, value)
    }
    if (Object.keys(formWeights).length > 0) normalized[String(formId)] = formWeights
  }
  return normalized
}

function toComparableValue(value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized === '' ? null : normalized.toLowerCase()
  }
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value
  if (Array.isArray(value)) return value.map(v => toComparableValue(v)).filter(v => v !== null)
  if (typeof value === 'object') {
    if (value && value.__na === true) return null
    return value
  }
  return null
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function averagePairwise(values, scorePair) {
  const scores = []
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) {
      const score = scorePair(values[i], values[j])
      if (score != null && Number.isFinite(score)) scores.push(Math.max(0, Math.min(1, score)))
    }
  }
  if (scores.length === 0) return null
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

function stableComparableKey(value) {
  return JSON.stringify(toComparableValue(value))
}

function agreementForCategorical(values) {
  const normalized = values.map(v => toComparableValue(v)).filter(v => v !== null)
  if (normalized.length < 2) return null
  return averagePairwise(normalized, (a, b) => stableComparableKey(a) === stableComparableKey(b) ? 1 : 0)
}

function numericValues(values) {
  return values
    .map(v => {
      if (typeof v === 'number' && Number.isFinite(v)) return v
      const parsed = Number(v)
      return Number.isFinite(parsed) ? parsed : null
    })
    .filter(v => v !== null)
}

// Still used internally by agreementForObject() for scoring individual
// numeric-typed columns/rows inside a table or likert_group. No longer used
// as a standalone question's default or offered method (see change note at
// top of file).
function agreementForNumeric(values, meta = {}) {
  const numeric = values
    .map(v => Array.isArray(v) ? v.map(item => numericValues([item])[0]).filter(v => v !== undefined) : numericValues([v])[0])
    .filter(v => v != null && (!Array.isArray(v) || v.length > 0))
  if (numeric.length < 2) return null

  const configuredRange = Number(meta.max) - Number(meta.min)
  const observedNumbers = numeric.flatMap(v => Array.isArray(v) ? v : [v])
  const observedRange = Math.max(...observedNumbers) - Math.min(...observedNumbers)
  const range = Number.isFinite(configuredRange) && configuredRange > 0
    ? configuredRange
    : Math.max(1, observedRange)

  return averagePairwise(numeric, (a, b) => {
    const aValues = Array.isArray(a) ? a : [a]
    const bValues = Array.isArray(b) ? b : [b]
    const length = Math.max(aValues.length, bValues.length)
    if (length === 0) return null
    const scores = []
    for (let i = 0; i < length; i++) {
      const av = aValues[i]
      const bv = bValues[i]
      if (!Number.isFinite(av) || !Number.isFinite(bv)) continue
      scores.push(1 - Math.min(1, Math.abs(av - bv) / range))
    }
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null
  })
}

function getOrdinalRange(meta = {}) {
  if (Number.isFinite(Number(meta.scale)) && Number(meta.scale) > 1) return Number(meta.scale) - 1
  if (Array.isArray(meta.options) && meta.options.length > 1) return meta.options.length - 1
  return null
}

function ordinalValue(value, meta = {}) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  const parsed = Number(value)
  if (Number.isFinite(parsed)) return Math.round(parsed)
  if (Array.isArray(meta.options)) {
    const index = meta.options.findIndex(option => String(option).trim().toLowerCase() === String(value || '').trim().toLowerCase())
    if (index >= 0) return index
  }
  return null
}

// Still used internally by agreementForObject() for scoring individual
// ordinal-typed columns/rows inside a table or likert_group, and by
// agreementForWeightedKappa(). No longer used as a standalone question's
// default or offered method (see change note at top of file).
function agreementForOrdinal(values, meta = {}) {
  const numeric = values.map(v => ordinalValue(v, meta)).filter(v => v !== null)
  if (numeric.length < 2) return null
  const observedRange = Math.max(...numeric) - Math.min(...numeric)
  const range = getOrdinalRange(meta) || Math.max(1, observedRange)
  return averagePairwise(numeric, (a, b) => 1 - Math.min(1, Math.abs(a - b) / range))
}

// Alignment-only, tolerance-aware ordinal scoring. Deliberately a separate
// function from agreementForOrdinal above, not a parameterization of it —
// this is binary per pair (a pair either agrees within `tolerance` points or
// it doesn't; no partial credit for closeness), where agreementForOrdinal is
// a continuous distance-weighted score. tolerance=0 means exact match.
// Called both for standalone likert/rating questions and (via
// agreementForObject) for individual numeric sub-items inside a
// likert_group/table question. Only reachable when Alignment's Exact/Within-1
// selector passes a non-null tolerance — every other caller/page is
// untouched by this.
function agreementForOrdinalWithTolerance(values, meta = {}, tolerance = 0) {
  const numeric = values.map(v => ordinalValue(v, meta)).filter(v => v !== null)
  if (numeric.length < 2) return null
  return averagePairwise(numeric, (a, b) => Math.abs(a - b) <= tolerance ? 1 : 0)
}

// Still used internally by agreementForObject() for scoring individual
// multiselect-typed columns/rows inside a table or likert_group. No longer
// used as a standalone multiselect question's default or offered method
// (see change note at top of file) — standalone multiselect questions now
// use agreementForCategorical (percent/exact-match) instead.
function agreementForMultiselect(values) {
  const normalized = values
    .map(v => {
      const comparable = toComparableValue(v)
      return Array.isArray(comparable) ? [...new Set(comparable.map(item => stableComparableKey(item)))] : null
    })
    .filter(v => v !== null)
  if (normalized.length < 2) return null
  return averagePairwise(normalized, (a, b) => {
    const aSet = new Set(a)
    const bSet = new Set(b)
    const union = new Set([...aSet, ...bSet])
    if (union.size === 0) return 1
    const intersection = [...union].filter(item => aSet.has(item) && bSet.has(item))
    return intersection.length / union.size
  })
}

function timestampTagKey(value) {
  if (value?.tag_id != null) return `id:${value.tag_id}`
  return String(value?.tag_label || '').trim().toLowerCase()
}

function agreementForTimestamp(values, meta = {}) {
  const parsed = values
    .map(v => (v && typeof v === 'object' ? v : null))
    .filter(v => v && Number.isFinite(Number(v.time_seconds)))
  if (parsed.length < 2) return null
  const thresholdSeconds = Number.isFinite(Number(meta.timestampToleranceSeconds)) ? Number(meta.timestampToleranceSeconds) : 5
  return averagePairwise(parsed, (a, b) => {
    const diff = Math.abs(Number(a.time_seconds) - Number(b.time_seconds))
    const timeScore = thresholdSeconds <= 0 ? (diff === 0 ? 1 : 0) : Math.max(0, 1 - diff / thresholdSeconds)
    const aTag = timestampTagKey(a)
    const bTag = timestampTagKey(b)
    if (!aTag && !bTag) return timeScore
    const tagScore = aTag && bTag && aTag === bTag ? 1 : 0
    return (timeScore * 0.65) + (tagScore * 0.35)
  })
}

function agreementForText(values) {
  const normalized = values.map(v => normalizeText(v)).filter(Boolean)
  if (normalized.length < 2) return null
  return averagePairwise(normalized, (a, b) => a === b ? 1 : 0)
}

function agreementForCohenKappa(values) {
  const normalized = values.map(v => toComparableValue(v)).filter(v => v !== null)
  if (normalized.length !== 2) return null
  return stableComparableKey(normalized[0]) === stableComparableKey(normalized[1]) ? 1 : 0
}

function agreementForWeightedKappa(values, meta = {}) {
  const numeric = values.map(v => ordinalValue(v, meta)).filter(v => v !== null)
  if (numeric.length < 2) return null
  const range = getOrdinalRange(meta) || Math.max(1, Math.max(...numeric) - Math.min(...numeric))
  return averagePairwise(numeric, (a, b) => {
    const diff = Math.abs(a - b)
    return 1 - Math.min(1, (diff * diff) / (range * range))
  })
}

// `tolerance` is Alignment-only: when non-null, every numeric-typed sub-item
// (a likert_group row or a table column that's all-numeric) is scored with
// agreementForOrdinalWithTolerance instead of the distance-weighted
// agreementForOrdinal, using that same tolerance value. Non-numeric sub-items
// (text/multiselect columns inside a table) are untouched either way — a
// tolerance is meaningless for them. Leave tolerance null for any caller that
// isn't Alignment's new Exact/Within-1 selector, to preserve existing
// distance-weighted behavior everywhere else (e.g. the pooled Agreement tab
// doesn't call this at all, but any other item_group caller keeps today's
// scoring untouched).
function agreementForObject(values, meta = {}, itemMethod = 'auto', tolerance = null) {
  const normalized = values
    .map(v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null))
    .filter(Boolean)
  if (normalized.length < 2) return null

  const keys = [...new Set(normalized.flatMap(v => Object.keys(v)))].filter(Boolean)
  if (keys.length === 0) return null

  const itemScores = []
  for (const key of keys) {
    const itemValues = normalized
      .map(v => toComparableValue(v[key]))
      .filter(v => v !== null)
    if (itemValues.length < 2) continue

    const numericItemValues = itemValues.map(v => ordinalValue(v, meta)).filter(v => v !== null)

    if (numericItemValues.length === itemValues.length) {
      itemScores.push(tolerance != null
        ? agreementForOrdinalWithTolerance(numericItemValues, meta, tolerance)
        : (itemMethod === 'weighted_kappa'
          ? agreementForWeightedKappa(numericItemValues, meta)
          : agreementForOrdinal(numericItemValues, meta)))
    } else if (itemValues.some(Array.isArray)) {
      itemScores.push(agreementForMultiselect(itemValues))
    } else {
      itemScores.push(agreementForCategorical(itemValues))
    }
  }

  const validScores = itemScores.filter(score => score != null)
  if (validScores.length === 0) return null
  return validScores.reduce((sum, score) => sum + score, 0) / validScores.length
}

function getQuestionTypeWeight(type, weights) {
  return weights[type] ?? weights.default ?? 1
}

function getQuestionWeight({ formId, questionId, type }, weights = {}) {
  const normalizedQuestionWeights = normalizeQuestionWeights(weights)
  const formWeights = normalizedQuestionWeights[String(formId)] || {}
  if (questionId != null && Object.prototype.hasOwnProperty.call(formWeights, String(questionId))) {
    return formWeights[String(questionId)]
  }
  return getQuestionTypeWeight(type, normalizeAgreementWeights(weights))
}

function getAgreementWeight(type, weights, questionMeta = {}) {
  if (typeof questionMeta.agreement_weight === 'number' && Number.isFinite(questionMeta.agreement_weight)) {
    return Math.max(0, questionMeta.agreement_weight)
  }
  return getQuestionWeight({ ...questionMeta, type }, weights)
}

function getAgreementMethod(type, questionMeta = {}) {
  const method = questionMeta.agreement_method || 'auto'
  return method === 'auto' ? defaultAgreementMethodForType(type) : method
}

// `alignmentTolerance` is Alignment-only (null for every other caller,
// including the pooled Agreement tab's reliabilityStats.mjs, which doesn't
// call this function at all). When non-null, it overrides scoring for the
// two shapes Alignment's Exact/Within-1 selector applies to: standalone
// likert/rating scalar questions, and the numeric sub-items of a
// likert_group/table question (via agreementForObject). Every other question
// type (multiselect, multiple_choice, checkbox, text, timestamp, etc.)
// ignores this param entirely and scores exactly as before — a tolerance
// only means something for an ordinal 1-5 scale.
export function computeAgreementForQuestion(type, values, weights = DEFAULT_AGREEMENT_WEIGHTS, questionMeta = {}, alignmentTolerance = null) {
  if (questionMeta.agreement_enabled === false) return null
  if (questionMeta.agreement_enabled == null && !defaultAgreementEnabledForType(type)) return null

  const cleaned = values.map(v => toComparableValue(v)).filter(v => v !== null)
  if (cleaned.length < 2) return null

  const weight = getAgreementWeight(type, weights, questionMeta)
  const isLikertScalar = alignmentTolerance != null && (type === 'likert' || type === 'rating')
  // 'icc' and 'weighted_fleiss_kappa' are pooled-engine-only concepts — both
  // require comparing variance *between* subjects, which is mathematically
  // undefined for a single file. This function has never actually computed
  // either one; without this substitution it would silently fall through to
  // a type-based default below while still reporting the question's
  // configured (pooled) method, mislabeling whatever was actually computed
  // as "ICC" or "weighted Fleiss kappa" when it wasn't.
  const configuredMethod = getAgreementMethod(type, questionMeta)
  const method = (configuredMethod === 'icc' || configuredMethod === 'weighted_fleiss_kappa')
    ? defaultAgreementMethodForType(type)
    : configuredMethod

  if (method === 'percent') {
    const score = isLikertScalar
      ? agreementForOrdinalWithTolerance(values, questionMeta, alignmentTolerance)
      : agreementForCategorical(values)
    return { score, weight, method }
  }
  if (method === 'cohen_kappa') return { score: agreementForCohenKappa(values), weight, method }
  if (method === 'weighted_kappa') {
    const score = type === 'likert_group' || type === 'table'
      ? agreementForObject(values, questionMeta, method)
      : agreementForWeightedKappa(values, questionMeta)
    return { score, weight, method }
  }
  // 'ordinal', 'numeric', and 'set_overlap' are intentionally no longer
  // reachable here as top-level methods — they were removed from
  // defaultAgreementMethodForType() and from AGREEMENT_METHOD_LABELS, so
  // 'auto' resolution and any UI-driven selection can no longer produce
  // them for a standalone question. If a legacy stored questionMeta still
  // has agreement_method explicitly set to one of those three, it now falls
  // through to the switch below and is scored as plain percent/categorical
  // agreement via the 'default' case, rather than silently doing distance
  // scoring — so old configuration data can't reintroduce this by accident.
  if (method === 'timestamp') return { score: agreementForTimestamp(values, questionMeta), weight, method }
  if (method === 'exact_text') return { score: agreementForText(values), weight, method }
  if (method === 'item_group') return { score: agreementForObject(values, questionMeta, undefined, alignmentTolerance), weight, method }

  switch (type) {
    case 'timestamp_select':
      return { score: agreementForTimestamp(values, questionMeta), weight, method }
    case 'short_answer':
    case 'paragraph':
      return { score: agreementForText(values), weight, method }
    case 'likert_group':
      return { score: agreementForObject(values, questionMeta, undefined, alignmentTolerance), weight, method }
    case 'table':
      return { score: agreementForObject(values, questionMeta, undefined, alignmentTolerance), weight, method }
    // multiselect, checkbox, multiple_choice, slider, dial, vertical_slider,
    // and any unrecognized type all fall through to plain categorical
    // (exact-match/percent) agreement, tolerance or not — a tolerance only
    // applies to likert/rating, handled by isLikertScalar above.
    default:
      return { score: isLikertScalar ? agreementForOrdinalWithTolerance(values, questionMeta, alignmentTolerance) : agreementForCategorical(values), weight, method }
  }
}

// Shared by QuestionAgreementRow's two layouts (matrix sub-items, and the
// simple single-value table) so the red highlighting always matches whatever
// Alignment's Exact/Within-1 selector is currently set to, instead of the
// old hardcoded exact-match-only Set-size check. `tolerance` null means "no
// selector active" and falls back to the old strict exact-match behavior.
// Deliberately reuses ordinalValue() (same function agreementForOrdinal/
// agreementForOrdinalWithTolerance score with) rather than a separate
// parsing implementation — that's what keeps the highlighting and the
// percentage from silently drifting apart again the way they did before
// this feature existed. `meta` is the question's schema element, needed for
// options-based (non-numeric-string) likert scales.
// A reviewer who left the question blank is EXCLUDED from the comparison —
// same as agreementForCategorical/agreementForOrdinalWithTolerance already
// exclude them from the percentage — rather than treated as a rating of 0
// (a real bug this fixes: `Number(null) === 0` in JS was silently turning a
// missing answer into a fake "0" rating) or automatically flagged as a
// mismatch just for being absent. With fewer than 2 actual answers there's
// nothing to compare, so no highlight fires.
export function valuesDisagreeWithTolerance(rawValues, tolerance = null, meta = {}) {
  const answered = rawValues.filter(v => v !== null && v !== undefined && v !== '')
  if (answered.length < 2) return false

  const numeric = answered.map(v => ordinalValue(v, meta))
  if (numeric.every(v => v !== null)) {
    const effectiveTolerance = tolerance ?? 0
    return (Math.max(...numeric) - Math.min(...numeric)) > effectiveTolerance
  }
  // At least one actual answer isn't ordinal at all (a text/multiselect
  // column inside a table, say) — a tolerance is meaningless for it, so fall
  // back to strict exact-match on just the real answers, the same set of
  // values agreementForCategorical itself would score from.
  return new Set(answered.map(v => JSON.stringify(v))).size > 1
}

// Alignment-only. Splits one media file's reviewDetails into separate
// per-instance-role groups (e.g. Trainee vs Consultant) so each role can be
// scored and displayed as its own independent card instead of pooled
// together — deliberately implemented as a pre-filter of reviewDetails
// rather than a new mode inside computeInterraterAgreementForMediaFile
// itself, so the core pooling engine (and every other caller of it) is
// completely untouched by this.
// instance_role lives on each individual form_response, not on the review
// as a whole — one review can in principle contain form_responses for more
// than one role — so this filters form_responses, not just relabels
// reviewers, and drops any review left with zero matching form_responses
// from that role's group entirely (so its reviewCount reflects only people
// who actually rated in that role).
// Returns null (meaning "don't split, use the single pooled card as
// before") when: fewer than 2 distinct roles are present, or the media's
// form_responses mix role-tagged and role-less entries — that mix is
// ambiguous (which card would a role-less question belong to?) and
// splitting anyway would silently drop those questions from every card, so
// the safer choice is to fall back rather than guess.
export function splitReviewDetailsByRole(reviewDetails = []) {
  let sawRole = false
  let sawNoRole = false
  const roles = new Set()
  for (const review of reviewDetails) {
    for (const fr of review?.form_responses || []) {
      if (fr?.instance_role) {
        sawRole = true
        roles.add(fr.instance_role)
      } else {
        sawNoRole = true
      }
    }
  }
  if (roles.size < 2) return null
  if (sawRole && sawNoRole) return null

  return Array.from(roles).sort().map(role => ({
    role,
    reviewDetails: reviewDetails
      .map(review => ({ ...review, form_responses: (review?.form_responses || []).filter(fr => fr?.instance_role === role) }))
      .filter(review => review.form_responses.length > 0),
  }))
}

function getElementLabel(element, fallback) {
  return element?.label || element?.title || fallback || 'Question'
}

function getQuestionType(element) {
  return element?.type || 'unknown'
}

function getSchemaSections(formSnapshot) {
  if (!formSnapshot) return []
  if (Array.isArray(formSnapshot?.sections)) return formSnapshot.sections
  if (Array.isArray(formSnapshot?.schema?.sections)) return formSnapshot.schema.sections
  if (Array.isArray(formSnapshot?.form?.schema?.sections)) return formSnapshot.form.schema.sections
  return []
}

export function computeInterraterAgreementForMediaFile({
  mediaName,
  encounterName,
  reviewDetails = [],
  weights = DEFAULT_AGREEMENT_WEIGHTS,
  questionIds = null,
  globalOnly = false,
  // When true, every reviewer of this file is pooled into one comparison per
  // question regardless of instance role (Trainee/Consultant) — this is what
  // Alignment needs, since it's meant to show agreement among everyone who
  // rated a file automatically, not split by role the way the pooled
  // Agreement page intentionally is. Defaults to false so Agreement Between
  // Results (an explicit, user-chosen 2-source comparison) keeps its
  // existing role-separated behavior unless a caller opts in.
  poolAcrossRoles = false,
  // Alignment-only. null preserves every existing default (distance-weighted
  // item_group, exact-match standalone likert/rating). 0 = exact match, 1 =
  // within-1-point — see computeAgreementForQuestion for exactly which
  // question types this affects.
  alignmentTolerance = null,
}) {
  const questionSummaries = []
  const formResponsesByQuestion = new Map()
  const selectedQuestionIds = Array.isArray(questionIds) && questionIds.length > 0
    ? new Set(questionIds.map(id => String(id)))
    : null

  for (const review of reviewDetails) {
    const reviewerName = review?.reviewerName || review?.reviewer_name || 'Unknown reviewer'
    const responses = review?.form_responses || []
    for (const formResponse of responses) {
      const schema = formResponse?.form_snapshot || null
      const sections = getSchemaSections(schema)
      const elements = sections.flatMap(section => section?.elements || [])
      const values = formResponse?.responses || {}
      for (const element of elements) {
        if (globalOnly && element?.global_agreement_question !== true) continue
        if (selectedQuestionIds && !selectedQuestionIds.has(String(element?.id))) continue
        // Repeatable form instances (e.g. "Trainee 1", "Consultant 1") must
        // never be pooled together by default — they rate different people,
        // not the same subject twice. Matched across reviewers by role +
        // creation order (not instance_key, which is unique per review and
        // would never match across two different reviewers' own instances).
        // When poolAcrossRoles is true, this separation is deliberately
        // skipped — every reviewer of this file counts toward one shared
        // comparison per question, regardless of which role they held.
        const instanceRole = formResponse?.instance_role || null
        const instanceOrder = formResponse?.instance_order || 0
        const instanceSuffix = (instanceRole && !poolAcrossRoles) ? `:${instanceRole}:${instanceOrder}` : ''
        // Prefer form_name over form_id — form_id is either a local integer
        // (meaningless once compared against another install's local ids) or
        // a foreign sync_id for imported cross-file rows; form_name is the
        // one thing that's actually consistent for "the same form" across
        // installs. Falls back to form_id only for older data that predates
        // form_name being included here.
        const questionKey = `${formResponse?.form_name || formResponse?.form_id || 'form'}:${element?.id}${instanceSuffix}`
        if (!formResponsesByQuestion.has(questionKey)) {
          formResponsesByQuestion.set(questionKey, {
            label: (instanceRole && !poolAcrossRoles) ? `${getElementLabel(element, element?.id)} (${instanceRole} ${instanceOrder})` : getElementLabel(element, element?.id),
            type: getQuestionType(element),
            formId: formResponse?.form_id || null,
            questionId: element?.id,
            instanceRole,
            instanceOrder,
            meta: element || {},
            values: [],
          })
        }
        const entry = formResponsesByQuestion.get(questionKey)
        const responseValue = values?.[element?.id]
        // When roles are pooled into one shared question row (poolAcrossRoles),
        // the same person's Trainee and Consultant instances would otherwise
        // both display under the exact same reviewerName with no way to tell
        // them apart — e.g. two columns both labeled "Dara Osei". Append the
        // role here (not to instanceSuffix/questionKey above, which controls
        // pooling itself and must stay unchanged) so each individual value is
        // still attributed correctly even though the question row is shared.
        const displayReviewerName = (instanceRole && poolAcrossRoles) ? `${reviewerName} (${instanceRole})` : reviewerName
        entry.values.push({ reviewerName: displayReviewerName, value: responseValue })
      }
    }
  }

  let excludedQuestionCount = 0
  for (const question of formResponsesByQuestion.values()) {
    const defaultExcluded = question.meta?.agreement_enabled == null && !defaultAgreementEnabledForType(question.type)
    if (question.meta?.agreement_enabled === false || defaultExcluded) {
      excludedQuestionCount++
      continue
    }
    const plainValues = question.values.map(v => v.value)
    const result = computeAgreementForQuestion(question.type, plainValues, weights, {
      ...question.meta,
      formId: question.formId,
      questionId: question.questionId,
    }, alignmentTolerance)
    if (result?.score != null) {
      questionSummaries.push({
        label: question.label,
        type: question.type,
        agreement: result.score,
        weight: result.weight,
        method: result.method || getAgreementMethod(question.type, question.meta),
        // The element's own schema — specifically needed so a UI can
        // translate a likert_group answer's row IDs into their actual
        // labels rather than showing raw element IDs.
        meta: question.meta,
        // Individual reviewer answers, kept alongside the aggregate score so
        // a UI can show "who answered what" on demand without recomputing
        // anything — this is the same data the score above was computed
        // from, not a separate fetch.
        rawAnswers: question.values,
      })
    }
  }

  const scoredQuestions = questionSummaries.filter(item => item.agreement != null)
  const totalWeight = scoredQuestions.reduce((sum, item) => sum + (item.weight ?? 1), 0)
  const overallAgreement = totalWeight > 0
    ? scoredQuestions.reduce((sum, item) => sum + item.agreement * (item.weight ?? 1), 0) / totalWeight
    : null

  return {
    mediaName,
    encounterName,
    reviewCount: reviewDetails.length,
    questionCount: scoredQuestions.length,
    excludedQuestionCount,
    overallAgreement,
    // Left in natural form-question order (the order questions were
    // discovered while walking the form's own schema) — sorting by agreement
    // is a display choice, not something this shared engine should decide
    // for every consumer. Alignment and Agreement Between Results each sort
    // this at render time based on whichever order the person has selected.
    questions: scoredQuestions,
  }
}
