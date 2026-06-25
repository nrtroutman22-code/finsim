import { supabase } from './supabase'

// ─── Constants ──────────────────────────────────────────

const RENT_RANGES = {
  'big-city':       [1100, 1400],
  'mid-size-city':  [800, 1000],
  'small-town':     [550, 750],
  'living-at-home': [200, 350],
}

const APR = 0.18
const MONTHLY_INTEREST_RATE = APR / 12
const STUDENT_LOAN_APR = 0.06
const STUDENT_LOAN_MONTHLY_RATE = STUDENT_LOAN_APR / 12
const MIN_DEBT_PAYMENT = 25
const DEBT_PAYMENT_PCT = 0.02
const SEMESTER_TUITION_WEEKS = [5, 14, 19]
const SEMESTER_TUITION_AMOUNT = 10000

function rand(min, max) {
  return Math.round(min + Math.random() * (max - min))
}

function clamp(val, lo, hi) {
  return Math.max(lo, Math.min(hi, val))
}

// ─── advanceWeek ────────────────────────────────────────

export async function advanceWeek(characterId) {
  const { data: character, error: cErr } = await supabase
    .from('characters')
    .select('*, locations(cost_of_living_modifier), life_paths(starting_monthly_income)')
    .eq('id', characterId)
    .single()
  if (cErr) throw new Error('Could not load character: ' + cErr.message)

  const { data: current, error: fErr } = await supabase
    .from('financial_states')
    .select('*')
    .eq('character_id', characterId)
    .order('week', { ascending: false })
    .limit(1)
    .single()
  if (fErr) throw new Error('Could not load financial state: ' + fErr.message)

  const newWeek = current.week + 1
  const isUni = character.life_path_id === 'uni-oncampus'

  let cash = Number(current.cash)
  let savings = Number(current.savings)
  let debt = Number(current.debt)
  let creditScore = current.credit_score
  const monthlyIncome = Number(current.monthly_income)
  const fixedExpenses = Number(current.monthly_expenses) || 0

  // ── Semester tuition (uni-oncampus only) ──
  let tuitionNotice = null
  if (isUni && SEMESTER_TUITION_WEEKS.includes(newWeek)) {
    debt += SEMESTER_TUITION_AMOUNT
    tuitionNotice = `New semester, new loans! $${SEMESTER_TUITION_AMOUNT.toLocaleString()} in student loans added for this semester.`
  }

  // ── Income ──
  cash += monthlyIncome

  // ── Fixed expenses (set at character creation, changed only by decisions/life events) ──
  cash -= fixedExpenses

  // ── Debt interest + minimum payment ──
  let debtPayment = 0
  if (debt > 0) {
    const rate = isUni ? STUDENT_LOAN_MONTHLY_RATE : MONTHLY_INTEREST_RATE
    const interest = Math.round(debt * rate)
    debt += interest

    if (isUni && newWeek < 28) {
      // No payments due yet — in-school deferment
    } else {
      debtPayment = Math.max(MIN_DEBT_PAYMENT, Math.round(debt * DEBT_PAYMENT_PCT))
      debtPayment = Math.min(debtPayment, debt)
      debt -= debtPayment
      cash -= debtPayment
    }
  }

  // ── Credit score ──
  const billsPaid = cash >= 0
  if (billsPaid) {
    creditScore += rand(2, 5)
  } else {
    creditScore -= rand(10, 20)
  }
  if (debt > monthlyIncome * 0.3) {
    creditScore -= 5
  }
  creditScore = clamp(creditScore, 300, 850)

  // ── Net worth ──
  const netWorth = cash + savings - debt

  // ── Insert new financial state ──
  // Store fixed living expenses only (no debt payment) so they persist correctly.
  // The dashboard displays fixedExpenses + debtPayment as total monthly outflow.
  const newState = {
    character_id: characterId,
    week: newWeek,
    net_worth: Math.round(netWorth),
    cash: Math.round(cash),
    monthly_income: monthlyIncome,
    monthly_expenses: fixedExpenses,
    savings: Math.round(savings),
    debt: Math.round(Math.max(0, debt)),
    credit_score: creditScore,
  }

  const { data: inserted, error: iErr } = await supabase
    .from('financial_states')
    .insert(newState)
    .select()
    .single()
  if (iErr) throw new Error('Could not save financial state: ' + iErr.message)

  // ── Update character current_week ──
  await supabase
    .from('characters')
    .update({ current_week: newWeek })
    .eq('id', characterId)

  // ── Check badges ──
  await checkAndAwardBadges(characterId, inserted)

  if (tuitionNotice) inserted._tuitionNotice = tuitionNotice
  return inserted
}

// ─── checkAndAwardBadges ────────────────────────────────

export async function checkAndAwardBadges(characterId, financialState) {
  const { data: existing } = await supabase
    .from('character_badges')
    .select('badge_id')
    .eq('character_id', characterId)
  const earned = new Set((existing || []).map(b => b.badge_id))

  const { data: allStates } = await supabase
    .from('financial_states')
    .select('debt, week')
    .eq('character_id', characterId)
    .order('week', { ascending: true })

  const toAward = []

  // emergency-fund: cash >= 3 months of expenses
  if (!earned.has('emergency-fund')) {
    const expenses = Number(financialState.monthly_expenses) || 1
    if (Number(financialState.cash) >= expenses * 3) {
      toAward.push('emergency-fund')
    }
  }

  // debt-free: debt is 0 and previously had debt
  if (!earned.has('debt-free') && Number(financialState.debt) === 0) {
    const hadDebt = (allStates || []).some(s => Number(s.debt) > 0)
    if (hadDebt) toAward.push('debt-free')
  }

  // credit-builder: credit score >= 700
  if (!earned.has('credit-builder') && financialState.credit_score >= 700) {
    toAward.push('credit-builder')
  }

  // net-worth-positive: net worth > 0
  if (!earned.has('net-worth-positive') && Number(financialState.net_worth) > 0) {
    toAward.push('net-worth-positive')
  }

  // perfect-budgeter: 4 consecutive weeks where expenses <= income
  if (!earned.has('perfect-budgeter') && allStates && allStates.length >= 4) {
    const { data: recentStates } = await supabase
      .from('financial_states')
      .select('monthly_income, monthly_expenses')
      .eq('character_id', characterId)
      .order('week', { ascending: false })
      .limit(4)
    if (recentStates && recentStates.length === 4) {
      const allWithin = recentStates.every(s =>
        Number(s.monthly_expenses) <= Number(s.monthly_income)
      )
      if (allWithin) toAward.push('perfect-budgeter')
    }
  }

  if (toAward.length > 0) {
    const rows = toAward.map(badge_id => ({ character_id: characterId, badge_id }))
    await supabase.from('character_badges').insert(rows)
  }

  return toAward
}

// ─── processDecision ────────────────────────────────────

export async function processDecision(characterId, decisionOptionId, week) {
  const { data: option, error: oErr } = await supabase
    .from('decision_options')
    .select('*, weeks(week_number)')
    .eq('id', decisionOptionId)
    .single()
  if (oErr) throw new Error('Could not load decision option: ' + oErr.message)

  // Record the decision
  const { error: dErr } = await supabase
    .from('student_decisions')
    .insert({
      character_id: characterId,
      week,
      decision_type: 'curriculum',
      decision_option_id: decisionOptionId,
    })
  if (dErr) throw new Error('Could not save decision: ' + dErr.message)

  // Apply financial impact
  const updated = await applyImpact(characterId, option.financial_impact)
  await checkAndAwardBadges(characterId, updated)

  return updated
}

// ─── processLifeEvent ───────────────────────────────────

export async function processLifeEvent(characterId, lifeEventOptionId, week) {
  const { data: option, error: oErr } = await supabase
    .from('life_event_options')
    .select('*')
    .eq('id', lifeEventOptionId)
    .single()
  if (oErr) throw new Error('Could not load life event option: ' + oErr.message)

  // Record the decision
  const { error: dErr } = await supabase
    .from('student_decisions')
    .insert({
      character_id: characterId,
      week,
      decision_type: 'life_event',
      life_event_option_id: lifeEventOptionId,
    })
  if (dErr) throw new Error('Could not save life event decision: ' + dErr.message)

  const updated = await applyImpact(characterId, option.financial_impact)
  await checkAndAwardBadges(characterId, updated)

  return updated
}

// ─── triggerRandomLifeEvent ─────────────────────────────

export async function triggerRandomLifeEvent(characterId, sectionId) {
  const { data: character } = await supabase
    .from('characters')
    .select('current_week')
    .eq('id', characterId)
    .single()
  if (!character) return null

  const nextWeek = character.current_week + 1

  // Already have an event for this section+week?
  const { data: existing } = await supabase
    .from('section_life_events')
    .select('id')
    .eq('section_id', sectionId)
    .eq('week', nextWeek)
    .limit(1)
    .single()
  if (existing) return null

  // Check if student had a life event in the last 3 weeks
  const minWeek = Math.max(1, nextWeek - 3)
  const { data: recentEvents } = await supabase
    .from('student_decisions')
    .select('id')
    .eq('character_id', characterId)
    .eq('decision_type', 'life_event')
    .gte('week', minWeek)
    .limit(1)
  if (recentEvents && recentEvents.length > 0) return null

  // 70% chance to trigger
  if (Math.random() > 0.7) return null

  // Get events this character has already seen
  const { data: seenDecisions } = await supabase
    .from('student_decisions')
    .select('life_event_option_id')
    .eq('character_id', characterId)
    .eq('decision_type', 'life_event')
  const seenOptionIds = (seenDecisions || []).map(d => d.life_event_option_id).filter(Boolean)

  let seenEventIds = []
  if (seenOptionIds.length > 0) {
    const { data: seenOpts } = await supabase
      .from('life_event_options')
      .select('life_event_id')
      .in('id', seenOptionIds)
    seenEventIds = [...new Set((seenOpts || []).map(o => o.life_event_id))]
  }

  // Pick a random unseen event
  let query = supabase.from('life_events').select('id')
  if (seenEventIds.length > 0) {
    // Filter out seen events by fetching all and filtering client-side
    // (Supabase JS doesn't support .not().in() well on uuid arrays)
  }
  const { data: allEvents } = await supabase.from('life_events').select('id')
  const candidates = (allEvents || []).filter(e => !seenEventIds.includes(e.id))

  if (candidates.length === 0) return null

  const picked = candidates[Math.floor(Math.random() * candidates.length)]

  // Insert into section_life_events
  const { error: insertErr } = await supabase
    .from('section_life_events')
    .insert({
      section_id: sectionId,
      life_event_id: picked.id,
      week: nextWeek,
    })
  // Ignore duplicate key errors (another student in the section may have triggered first)
  if (insertErr && !insertErr.message.includes('duplicate')) {
    console.error('Could not trigger life event:', insertErr.message)
    return null
  }

  return picked.id
}

// ─── triggerTeacherLifeEvent ────────────────────────────

export async function triggerTeacherLifeEvent(sectionId, lifeEventId, week) {
  const { error } = await supabase
    .from('section_life_events')
    .insert({
      section_id: sectionId,
      life_event_id: lifeEventId,
      week,
    })
  if (error) throw new Error('Could not trigger life event: ' + error.message)
}

// ─── applyImpact (shared helper) ────────────────────────

async function applyImpact(characterId, impact) {
  if (!impact) return null

  const { data: current, error: fErr } = await supabase
    .from('financial_states')
    .select('*')
    .eq('character_id', characterId)
    .order('week', { ascending: false })
    .limit(1)
    .single()
  if (fErr) throw new Error('Could not load financial state')

  const updates = {}

  if (impact.cash) updates.cash = Number(current.cash) + impact.cash
  if (impact.savings) updates.savings = Number(current.savings) + impact.savings
  if (impact.debt) updates.debt = Math.max(0, Number(current.debt) + impact.debt)
  if (impact.monthly_income) updates.monthly_income = Number(current.monthly_income) + impact.monthly_income
  if (impact.monthly_expenses) updates.monthly_expenses = Number(current.monthly_expenses) + impact.monthly_expenses
  if (impact.credit_score) updates.credit_score = clamp(current.credit_score + impact.credit_score, 300, 850)

  const newCash = updates.cash ?? Number(current.cash)
  const newSavings = updates.savings ?? Number(current.savings)
  const newDebt = updates.debt ?? Number(current.debt)
  updates.net_worth = newCash + newSavings - newDebt

  const { data: updated, error: uErr } = await supabase
    .from('financial_states')
    .update(updates)
    .eq('id', current.id)
    .select()
    .single()
  if (uErr) throw new Error('Could not update financial state: ' + uErr.message)

  return updated
}
