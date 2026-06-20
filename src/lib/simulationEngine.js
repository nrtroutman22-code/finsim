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
const MIN_DEBT_PAYMENT = 25
const DEBT_PAYMENT_PCT = 0.02

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
  const mod = Number(character.locations?.cost_of_living_modifier) || 1.0
  const locationId = character.location_id

  let cash = Number(current.cash)
  let savings = Number(current.savings)
  let debt = Number(current.debt)
  let creditScore = current.credit_score
  const monthlyIncome = Number(current.monthly_income)

  // ── Income ──
  cash += monthlyIncome

  // ── Automatic expenses ──
  const rentRange = RENT_RANGES[locationId] || [700, 900]
  const rent = rand(rentRange[0], rentRange[1])
  const food = rand(Math.round(200 * mod), Math.round(400 * mod))
  const transport = rand(Math.round(100 * mod), Math.round(300 * mod))
  const phoneUtil = rand(100, 200)

  const totalExpenses = rent + food + transport + phoneUtil

  cash -= totalExpenses

  // ── Debt interest + minimum payment ──
  let debtPayment = 0
  if (debt > 0) {
    const interest = Math.round(debt * MONTHLY_INTEREST_RATE)
    debt += interest
    debtPayment = Math.max(MIN_DEBT_PAYMENT, Math.round(debt * DEBT_PAYMENT_PCT))
    debtPayment = Math.min(debtPayment, debt)
    debt -= debtPayment
    cash -= debtPayment
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
  const monthlyExpenses = totalExpenses + debtPayment

  // ── Insert new financial state ──
  const newState = {
    character_id: characterId,
    week: newWeek,
    net_worth: Math.round(netWorth),
    cash: Math.round(cash),
    monthly_income: monthlyIncome,
    monthly_expenses: Math.round(monthlyExpenses),
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
