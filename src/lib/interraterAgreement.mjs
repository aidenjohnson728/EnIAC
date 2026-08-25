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

function agreementForObject(values, meta = {}, itemMethod = 'auto') {
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
      itemScores.push(itemMethod === 'weighted_kappa'
        ? agreementForWeightedKappa(numericItemValues, meta)
        : agreementForOrdinal(numericItemValues, meta))
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

export function computeAgreementForQuestion(type, values, weights = DEFAULT_AGREEMENT_WEIGHTS, questionMeta = {}) {
  if (questionMeta.agreement_enabled === false) return null
  if (questionMeta.agreement_enabled == null && !defaultAgreementEnabledForType(type)) return null

  const cleaned = values.map(v => toComparableValue(v)).filter(v => v !== null)
  if (cleaned.length < 2) return null

  const weight = getAgreementWeight(type, weights, questionMeta)
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

  if (method === 'percent') return { score: agreementForCategorical(values), weight, method }
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
  if (method === 'item_group') return { score: agreementForObject(values, questionMeta), weight, method }

  switch (type) {
    case 'timestamp_select':
      return { score: agreementForTimestamp(values, questionMeta), weight, method }
    case 'short_answer':
    case 'paragraph':
      return { score: agreementForText(values), weight, method }
    case 'likert_group':
      return { score: agreementForObject(values, questionMeta), weight, method }
    case 'table':
      return { score: agreementForObject(values, questionMeta), weight, method }
    // multiselect, checkbox, multiple_choice, rating, likert, slider, dial,
    // vertical_slider, and any unrecognized type all fall through to plain
    // categorical (exact-match/percent) agreement.
    default:
      return { score: agreementForCategorical(values), weight, method }
  }
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

// Walks every reviewer's form responses for one media file and groups the
// individual answers by question, applying the same instance-role pooling,
// question-id filtering and global-only filtering rules for every consumer.
//
// Extracted from computeInterraterAgreementForMediaFile so the near-alignment
// engine below reads exactly the same answers from exactly the same keys —
// the two must never diverge on WHICH answers belong to a question, only on
// how those answers are scored. Behavior is unchanged from when this lived
// inline.
function collectQuestionResponses({
  reviewDetails = [],
  questionIds = null,
  globalOnly = false,
  poolAcrossRoles = false,
}) {
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

  return formResponsesByQuestion
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
  // Agreement page intentionally is. Defaults to false so any other caller
  // keeps role-separated behavior unless it opts in.
  poolAcrossRoles = false,
}) {
  const questionSummaries = []
  const formResponsesByQuestion = collectQuestionResponses({ reviewDetails, questionIds, globalOnly, poolAcrossRoles })

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
    })
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
// ── Near alignment ────────────────────────────────────────────────────────────
// A second, deliberately coarser read of the same per-file answers the
// engine above scores as a percentage. Instead of "how close were these
// raters", it answers one binary question per scored item: did everyone land
// within a tolerance of each other?
//
// The motivating case: four raters answering 4 / 4 / 4 / 5 on a 5-point
// likert item are, for this study's purposes, in agreement — one rater being
// a single point off is noise, not a real disagreement. Percent agreement
// reports that as 0% exact match, which reads far worse than it is.
//
// This is a SEPARATE export rather than a mode of computeInterraterAgreement-
// ForMediaFile on purpose: that function's return shape (per-question
// `agreement` fraction + weighted `overallAgreement`) is consumed elsewhere
// and must not change. Both read their answers from collectQuestionResponses
// above, so the two views can never disagree about which answers belong to
// which question.
export const NEAR_ALIGNMENT_DEFAULT_TOLERANCE = 1

// The verdict is computed on the SPREAD of the ratings — max minus min — not
// on pairwise adjacency. So 4/4/4/5 (spread 1) is an agreement at tolerance
// 1, while 3/4/4/5 (spread 2) is a disagreement even though every rater is
// adjacent to some other rater. That's intentional: a two-point gap between
// the highest and lowest rater is a real split regardless of how the middle
// fills in.
function nearVerdictForOrderedValues(numbers, tolerance) {
  const spread = Math.max(...numbers) - Math.min(...numbers)
  return { verdict: spread <= tolerance ? 'agreement' : 'disagreement', spread }
}

// Only genuinely ordered answer types get tolerance treatment. "One point
// off" is meaningless for an unordered category — two adjacent entries in a
// multiple_choice options list have no more in common than two distant ones —
// so those fall back to exact match, which is the same thing a tolerance of 0
// would produce. Note ordinalValue() maps an option label to its index, which
// is correct for a likert scale rendered as labels but would be nonsense for
// multiple_choice, hence the type gate rather than a purely value-driven test.
const NEAR_ORDERED_TYPES = new Set([
  'likert', 'likert_group', 'rating', 'scale',
  'slider', 'vertical_slider', 'dial', 'number', 'numeric',
])

function isNearOrderedType(type) {
  return NEAR_ORDERED_TYPES.has(String(type || ''))
}

// One scored unit of near alignment. For a plain question that's the question
// itself; for a likert_group/table it's one row; for a multi-dial control it's
// one dial position — the same "one thing per sub-item" principle the pooled
// engine applies via ROW_UNPACK_TYPES / ARRAY_UNPACK_TYPES.
function nearAlignmentItemFromValues({ itemId, label, ordered, meta, entries, tolerance }) {
  const usable = entries.filter(entry => toComparableValue(entry.value) !== null)
  const base = { itemId, label, ordered, tolerance, values: entries }

  // A single rater trivially "agrees" with nobody. Reporting that as an
  // agreement would inflate the file's counts with items only one person
  // actually answered, so it stays unscored and is surfaced separately.
  if (usable.length < 2) {
    return { ...base, verdict: null, spread: null, reason: 'not_enough_raters', ratedCount: usable.length }
  }

  if (ordered) {
    const numbers = usable.map(entry => ordinalValue(entry.value, meta)).filter(v => v !== null)
    if (numbers.length === usable.length) {
      const { verdict, spread } = nearVerdictForOrderedValues(numbers, tolerance)
      return { ...base, verdict, spread, reason: null, ratedCount: usable.length }
    }
    // An ordered question whose answers aren't all numeric (a stray text
    // answer, an option label with no match in the schema's options list)
    // can't be measured by distance — fall through to exact match rather
    // than silently dropping the non-numeric raters from the comparison.
  }

  const keys = usable.map(entry => stableComparableKey(entry.value))
  const identical = keys.every(key => key === keys[0])
  return {
    ...base,
    ordered: false,
    verdict: identical ? 'agreement' : 'disagreement',
    spread: null,
    reason: null,
    ratedCount: usable.length,
  }
}

// Splits one question's per-reviewer answers into its scored items. Object
// answers (likert_group/table) unpack by row id, array answers (multi-dial)
// by position, everything else stays whole.
function nearAlignmentItemsForQuestion(question, tolerance) {
  const entries = question.values
  const meta = question.meta || {}
  const anyObject = entries.some(entry => entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value) && entry.value.__na !== true)
  const anyArray = entries.some(entry => Array.isArray(entry.value))

  if (anyObject) {
    // Prefer the schema's own item order/labels; fall back to whatever keys
    // the answers actually contain so an older snapshot without an items
    // array still produces rows.
    const schemaItems = Array.isArray(meta.items) ? meta.items : null
    const keysFromAnswers = [...new Set(entries.flatMap(entry => (entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)) ? Object.keys(entry.value) : []))]
    const itemIds = schemaItems ? schemaItems.map(item => String(item.id)) : keysFromAnswers
    const labelById = new Map((schemaItems || []).map(item => [String(item.id), item.label || item.id]))
    return itemIds.map(itemId => nearAlignmentItemFromValues({
      itemId,
      label: labelById.get(itemId) || itemId,
      ordered: isNearOrderedType(question.type),
      meta,
      entries: entries.map(entry => ({
        reviewerName: entry.reviewerName,
        value: (entry.value && typeof entry.value === 'object' && !Array.isArray(entry.value)) ? entry.value[itemId] : null,
      })),
      tolerance,
    }))
  }

  if (anyArray) {
    const length = Math.max(...entries.map(entry => (Array.isArray(entry.value) ? entry.value.length : 0)))
    const controlLabels = Array.isArray(meta.control_labels) ? meta.control_labels : null
    return Array.from({ length }, (unused, index) => nearAlignmentItemFromValues({
      itemId: String(index),
      label: controlLabels?.[index] || `${question.label} ${index + 1}`,
      ordered: isNearOrderedType(question.type),
      meta,
      entries: entries.map(entry => ({
        reviewerName: entry.reviewerName,
        value: Array.isArray(entry.value) ? entry.value[index] : null,
      })),
      tolerance,
    }))
  }

  return [nearAlignmentItemFromValues({
    itemId: String(question.questionId ?? question.label),
    label: question.label,
    ordered: isNearOrderedType(question.type),
    meta,
    entries,
    tolerance,
  })]
}

export function computeNearAlignmentForMediaFile({
  mediaName,
  encounterName,
  reviewDetails = [],
  questionIds = null,
  globalOnly = false,
  poolAcrossRoles = true,
  tolerance = NEAR_ALIGNMENT_DEFAULT_TOLERANCE,
}) {
  const effectiveTolerance = Number.isFinite(Number(tolerance)) ? Math.max(0, Number(tolerance)) : NEAR_ALIGNMENT_DEFAULT_TOLERANCE
  const formResponsesByQuestion = collectQuestionResponses({ reviewDetails, questionIds, globalOnly, poolAcrossRoles })

  const questions = []
  let excludedQuestionCount = 0
  let agreementCount = 0
  let disagreementCount = 0
  let unscoredItemCount = 0

  for (const question of formResponsesByQuestion.values()) {
    // Same opt-out rules as the percent engine — a question excluded from
    // agreement is excluded here too, including SDMo's dials (agreement_-
    // enabled: false) and free-text types.
    const defaultExcluded = question.meta?.agreement_enabled == null && !defaultAgreementEnabledForType(question.type)
    if (question.meta?.agreement_enabled === false || defaultExcluded) {
      excludedQuestionCount++
      continue
    }

    const items = nearAlignmentItemsForQuestion(question, effectiveTolerance)
    const scored = items.filter(item => item.verdict != null)
    if (scored.length === 0 && items.every(item => item.reason === 'not_enough_raters')) {
      unscoredItemCount += items.length
      continue
    }

    const questionAgreementCount = scored.filter(item => item.verdict === 'agreement').length
    const questionDisagreementCount = scored.length - questionAgreementCount
    agreementCount += questionAgreementCount
    disagreementCount += questionDisagreementCount
    unscoredItemCount += items.length - scored.length

    questions.push({
      label: question.label,
      type: question.type,
      meta: question.meta,
      questionId: question.questionId,
      // A multi-item question is only an agreement when every one of its
      // items is — one disagreeing row is a disagreement on that question,
      // the same way it would be if the row were its own question.
      verdict: scored.length === 0 ? null : (questionDisagreementCount === 0 ? 'agreement' : 'disagreement'),
      itemCount: scored.length,
      agreementCount: questionAgreementCount,
      disagreementCount: questionDisagreementCount,
      // Single-item questions still carry an items array of length 1 so the
      // UI has one shape to render, not two.
      items,
      rawAnswers: question.values,
    })
  }

  const scoredItemCount = agreementCount + disagreementCount
  return {
    mediaName,
    encounterName,
    reviewCount: reviewDetails.length,
    tolerance: effectiveTolerance,
    questionCount: questions.length,
    excludedQuestionCount,
    itemCount: scoredItemCount,
    agreementCount,
    disagreementCount,
    unscoredItemCount,
    // The share of scored items that came back "agreement" — a summary of the
    // binary verdicts, NOT a percent-agreement score. Two files can have the
    // same value here and very different percent agreement.
    nearAgreementRate: scoredItemCount > 0 ? agreementCount / scoredItemCount : null,
    // Natural form-question order, same as the percent engine — sorting is a
    // display decision left to the caller.
    questions,
  }
}