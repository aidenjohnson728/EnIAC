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
        entry.values.push({ reviewerName, value: responseValue })
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