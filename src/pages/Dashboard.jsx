import { useState, useEffect, useCallback } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { advanceWeek, processDecision, processLifeEvent } from '../lib/simulationEngine'

function money(n) {
  const num = Number(n) || 0
  const neg = num < 0
  return (neg ? '-$' : '$') + Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function pct(n) {
  return Math.round(n) + '%'
}

function delta(current, previous) {
  if (previous == null) return null
  return Number(current) - Number(previous)
}

function gradeFromScore(score) {
  if (score >= 90) return { letter: 'A', color: '#16a34a' }
  if (score >= 80) return { letter: 'B', color: '#22c55e' }
  if (score >= 70) return { letter: 'C', color: '#eab308' }
  if (score >= 60) return { letter: 'D', color: '#f97316' }
  return { letter: 'F', color: '#dc2626' }
}

function calcGrades(latest) {
  const income = Number(latest.monthly_income) || 1
  const expenses = Number(latest.monthly_expenses) || 0
  const savings = Number(latest.savings) || 0
  const debt = Number(latest.debt) || 0
  const credit = latest.credit_score || 650

  const savingsRate = ((income - expenses) / income) * 100
  const budgetScore = Math.min(100, Math.max(0, 50 + savingsRate * 2.5))
  const debtScore = debt === 0 ? 95 : Math.max(0, 100 - (debt / income) * 8)
  const savingsScore = Math.min(100, (savings / income) * 25)
  const investScore = Math.min(100, credit >= 700 ? 60 + (savings / 1000) * 10 : 30 + (savings / 1000) * 5)

  return {
    budgeting: Math.round(budgetScore),
    debt_management: Math.round(debtScore),
    savings: Math.round(savingsScore),
    investing: Math.round(investScore),
  }
}

const GRADE_META = {
  budgeting: { label: 'Budgeting', unit: null },
  debt_management: { label: 'Debt Management', unit: null },
  savings: { label: 'Savings', unit: 'Unit 3' },
  investing: { label: 'Investing', unit: 'Unit 4' },
}

function creditColor(score) {
  if (score >= 740) return '#16a34a'
  if (score >= 670) return '#22c55e'
  if (score >= 580) return '#eab308'
  return '#dc2626'
}

// ─── SVG Line Chart ─────────────────────────────────────

function NetWorthChart({ data }) {
  if (data.length < 2) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-400)', fontSize: '0.9rem' }}>
        Chart will appear after Week 1
      </div>
    )
  }

  const W = 520, H = 180, PAD_L = 55, PAD_R = 15, PAD_T = 15, PAD_B = 30
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  const vals = data.map(d => Number(d.net_worth))
  const minV = Math.min(...vals)
  const maxV = Math.max(...vals)
  const range = maxV - minV || 1

  const x = i => PAD_L + (i / (data.length - 1)) * plotW
  const y = v => PAD_T + plotH - ((v - minV) / range) * plotH

  const points = data.map((d, i) => `${x(i)},${y(vals[i])}`).join(' ')

  const yTicks = 4
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => minV + (range / yTicks) * i)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {yLabels.map((v, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--gray-200)" strokeWidth="1" />
          <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--gray-400)">
            {money(v)}
          </text>
        </g>
      ))}
      <polyline fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinejoin="round" points={points} />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(vals[i])} r="3.5" fill="var(--green)" />
      ))}
      {data.map((d, i) => (
        (data.length <= 12 || i % Math.ceil(data.length / 12) === 0 || i === data.length - 1) && (
          <text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--gray-400)">
            W{d.week}
          </text>
        )
      ))}
    </svg>
  )
}

// ─── Budget Bars ────────────────────────────────────────

function BudgetBreakdown({ latest }) {
  const expenses = Number(latest.monthly_expenses) || 1
  const income = Number(latest.monthly_income) || 1
  const savings = Math.max(0, income - expenses)

  const rent = Math.round(expenses * 0.40)
  const food = Math.round(expenses * 0.20)
  const transport = Math.round(expenses * 0.12)
  const phone = Math.round(expenses * 0.08)
  const personal = expenses - rent - food - transport - phone

  const items = [
    { label: 'Rent', amount: rent, color: '#3b82f6' },
    { label: 'Food', amount: food, color: '#22c55e' },
    { label: 'Transport', amount: transport, color: '#f59e0b' },
    { label: 'Phone / Utilities', amount: phone, color: '#8b5cf6' },
    { label: 'Personal', amount: personal, color: '#ec4899' },
    { label: 'Savings', amount: savings, color: '#06b6d4' },
  ]

  const max = Math.max(...items.map(i => i.amount), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {items.map(item => (
        <div key={item.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
            <span style={{ color: 'var(--gray-700)' }}>{item.label}</span>
            <span style={{ color: 'var(--gray-500)' }}>{money(item.amount)}/mo</span>
          </div>
          <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 4 }}>
            <div style={{ height: '100%', width: `${(item.amount / max) * 100}%`, background: item.color, borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Credit Score ───────────────────────────────────────

function CreditScoreDisplay({ score }) {
  const min = 300, max = 850
  const pctVal = ((score - min) / (max - min)) * 100

  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: '2.5rem', fontWeight: 700, color: creditColor(score), lineHeight: 1.2 }}>{score}</div>
      <div style={{ fontSize: '0.8rem', color: 'var(--gray-400)', marginBottom: '0.75rem' }}>
        {score >= 740 ? 'Excellent' : score >= 670 ? 'Good' : score >= 580 ? 'Fair' : 'Poor'}
      </div>
      <div style={{ height: 10, borderRadius: 5, background: 'linear-gradient(to right, #dc2626, #f97316, #eab308, #22c55e, #16a34a)', position: 'relative' }}>
        <div style={{
          position: 'absolute', top: -3, left: `${pctVal}%`, transform: 'translateX(-50%)',
          width: 16, height: 16, borderRadius: '50%', border: '3px solid white', background: creditColor(score), boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: '0.3rem' }}>
        <span>300</span><span>850</span>
      </div>
    </div>
  )
}

// ─── Decision Card ──────────────────────────────────────

function DecisionCard({ week, options, onChoose, choosing }) {
  return (
    <section className="dash-section decision-card">
      <h2 className="dash-section-title">📋 This Week's Decision</h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--gray-700)', marginBottom: '0.25rem', fontWeight: 600 }}>{week.title}</p>
      <p style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '0.75rem', lineHeight: 1.5 }}>{week.description}</p>
      <div className="decision-options">
        {options.map(opt => (
          <button
            key={opt.id}
            className="option-card"
            onClick={() => onChoose(opt.id)}
            disabled={choosing}
            type="button"
          >
            <div style={{ fontWeight: 600 }}>{opt.label}</div>
            {opt.description && (
              <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginTop: '0.15rem' }}>{opt.description}</div>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── Life Event Card ────────────────────────────────────

function LifeEventCard({ event, options, onChoose, choosing }) {
  return (
    <section className={`dash-section decision-card ${event.is_positive ? 'event-positive' : 'event-negative'}`}>
      <h2 className="dash-section-title">{event.is_positive ? '🎉' : '⚠️'} Life Event</h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--gray-700)', marginBottom: '0.25rem', fontWeight: 600 }}>{event.title}</p>
      <p style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '0.75rem', lineHeight: 1.5 }}>{event.description}</p>
      <div className="decision-options">
        {options.map(opt => (
          <button
            key={opt.id}
            className="option-card"
            onClick={() => onChoose(opt.id)}
            disabled={choosing}
            type="button"
          >
            <div style={{ fontWeight: 600 }}>{opt.label}</div>
            {opt.description && (
              <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginTop: '0.15rem' }}>{opt.description}</div>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── Main Dashboard ─────────────────────────────────────

export default function Dashboard() {
  const { session, loading: authLoading, signOut } = useAuth()
  const [character, setCharacter] = useState(null)
  const [sectionId, setSectionId] = useState(null)
  const [latest, setLatest] = useState(null)
  const [previous, setPrevious] = useState(null)
  const [history, setHistory] = useState([])
  const [unlockedCategories, setUnlockedCategories] = useState([])
  const [unlockedWeek, setUnlockedWeek] = useState(0)
  const [allBadges, setAllBadges] = useState([])
  const [earnedBadgeIds, setEarnedBadgeIds] = useState({})

  // Decision state
  const [weekData, setWeekData] = useState(null)
  const [weekOptions, setWeekOptions] = useState([])
  const [decisionMade, setDecisionMade] = useState(false)
  const [lifeEvent, setLifeEvent] = useState(null)
  const [lifeEventOptions, setLifeEventOptions] = useState([])
  const [lifeEventMade, setLifeEventMade] = useState(false)
  const [choosing, setChoosing] = useState(false)

  // Advance week state
  const [advancing, setAdvancing] = useState(false)
  const [advanceResult, setAdvanceResult] = useState(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const loadDashboard = useCallback(async () => {
    if (!session) return
    try {
      const { data: enrollment, error: eErr } = await supabase
        .from('enrollments')
        .select('id, section_id')
        .eq('student_id', session.user.id)
        .eq('status', 'approved')
        .limit(1)
        .single()
      if (eErr) throw new Error('No approved enrollment found.')
      setSectionId(enrollment.section_id)

      const { data: section } = await supabase
        .from('sections')
        .select('unlocked_categories, unlocked_week')
        .eq('id', enrollment.section_id)
        .single()
      setUnlockedCategories(section?.unlocked_categories || [])
      setUnlockedWeek(section?.unlocked_week ?? 0)

      const { data: char, error: cErr } = await supabase
        .from('characters')
        .select('*, life_paths(name), locations(name)')
        .eq('enrollment_id', enrollment.id)
        .single()
      if (cErr) throw new Error('Character not found.')
      setCharacter(char)

      const { data: states, error: sErr } = await supabase
        .from('financial_states')
        .select('*')
        .eq('character_id', char.id)
        .order('week', { ascending: true })
      if (sErr) throw new Error('Could not load financial data.')
      setHistory(states)

      if (states.length > 0) {
        setLatest(states[states.length - 1])
        if (states.length > 1) setPrevious(states[states.length - 2])
      }

      const [{ data: badges }, { data: earned }] = await Promise.all([
        supabase.from('badges').select('*').order('sort_order'),
        supabase.from('character_badges').select('badge_id, earned_at').eq('character_id', char.id),
      ])
      setAllBadges(badges || [])
      const map = {}
      ;(earned || []).forEach(e => { map[e.badge_id] = e.earned_at })
      setEarnedBadgeIds(map)

      // ── Load next week's curriculum decision ──
      // Week 0 is the starting state; decisions begin at week 1
      const nextWeek = char.current_week + 1
      const { data: weekRow } = await supabase
        .from('weeks')
        .select('*')
        .eq('week_number', nextWeek)
        .single()

      if (weekRow) {
        const { data: existingDecision } = await supabase
          .from('student_decisions')
          .select('id')
          .eq('character_id', char.id)
          .eq('week', nextWeek)
          .eq('decision_type', 'curriculum')
          .limit(1)
          .single()

        if (existingDecision) {
          setDecisionMade(true)
          setWeekData(null)
        } else {
          setWeekData(weekRow)
          setDecisionMade(false)
          const { data: opts } = await supabase
            .from('decision_options')
            .select('*')
            .eq('week_id', weekRow.id)
            .order('sort_order')
          setWeekOptions(opts || [])
        }
      } else {
        setWeekData(null)
        setDecisionMade(true)
      }

      // ── Load active life event for this section + next week ──
      const { data: sectionEvent } = await supabase
        .from('section_life_events')
        .select('life_event_id')
        .eq('section_id', enrollment.section_id)
        .eq('week', nextWeek)
        .limit(1)
        .single()

      if (sectionEvent) {
        const { data: existingEventDecision } = await supabase
          .from('student_decisions')
          .select('id')
          .eq('character_id', char.id)
          .eq('week', nextWeek)
          .eq('decision_type', 'life_event')
          .limit(1)
          .single()

        if (existingEventDecision) {
          setLifeEventMade(true)
          setLifeEvent(null)
        } else {
          const { data: evt } = await supabase
            .from('life_events')
            .select('*')
            .eq('id', sectionEvent.life_event_id)
            .single()
          setLifeEvent(evt)
          setLifeEventMade(false)
          const { data: eopts } = await supabase
            .from('life_event_options')
            .select('*')
            .eq('life_event_id', sectionEvent.life_event_id)
            .order('sort_order')
          setLifeEventOptions(eopts || [])
        }
      } else {
        setLifeEvent(null)
        setLifeEventMade(true)
      }

      setAdvanceResult(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [session])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  async function handleDecision(optionId) {
    setChoosing(true)
    try {
      const updated = await processDecision(character.id, optionId, character.current_week + 1)
      if (updated) setLatest(updated)
      setDecisionMade(true)
      setWeekData(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setChoosing(false)
    }
  }

  async function handleLifeEvent(optionId) {
    setChoosing(true)
    try {
      const updated = await processLifeEvent(character.id, optionId, character.current_week + 1)
      if (updated) setLatest(updated)
      setLifeEventMade(true)
      setLifeEvent(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setChoosing(false)
    }
  }

  async function handleAdvanceWeek() {
    setAdvancing(true)
    setAdvanceResult(null)
    try {
      const newState = await advanceWeek(character.id)
      setAdvanceResult(newState)
      await loadDashboard()
    } catch (err) {
      setError(err.message)
    } finally {
      setAdvancing(false)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="page-center">
        <p style={{ color: 'var(--gray-400)' }}>Loading your dashboard...</p>
      </div>
    )
  }

  if (!session) return <Navigate to="/" />

  if (error) {
    return (
      <div className="page-center">
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
          <p className="error-msg">{error}</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => { setError(null); setLoading(true); loadDashboard() }}>
            Try Again
          </button>
        </div>
      </div>
    )
  }

  if (!character || !latest) return <Navigate to="/create-character" />

  const grades = calcGrades(latest)
  const income = Number(latest.monthly_income) || 1
  const expenses = Number(latest.monthly_expenses) || 0
  const savingsRate = Math.max(0, ((income - expenses) / income) * 100)
  const nwDelta = delta(latest.net_worth, previous?.net_worth)

  const weekLocked = character.current_week >= unlockedWeek
  const canAdvance = decisionMade && lifeEventMade && character.current_week < 36 && !weekLocked
  const pendingActions = (!decisionMade && weekData) || (!lifeEventMade && lifeEvent)

  return (
    <div className="dash">
      {/* ── Top Bar ── */}
      <header className="dash-header">
        <div className="dash-header-left">
          <div className="dash-avatar" style={{ backgroundColor: character.background_color }}>
            {character.emoji}
          </div>
          <div>
            <h1 className="dash-name">{character.name}</h1>
            <p className="dash-subtitle">{character.life_paths?.name}</p>
          </div>
        </div>
        <div className="dash-header-right">
          <span className="dash-week-badge">Week {character.current_week} of 36</span>
          <button className="btn btn-secondary dash-signout" onClick={signOut} type="button">Sign out</button>
        </div>
      </header>

      {/* ── Decision Cards ── */}
      {weekData && !decisionMade && (
        <DecisionCard week={weekData} options={weekOptions} onChoose={handleDecision} choosing={choosing} />
      )}

      {lifeEvent && !lifeEventMade && (
        <LifeEventCard event={lifeEvent} options={lifeEventOptions} onChoose={handleLifeEvent} choosing={choosing} />
      )}

      {/* ── Advance Week ── */}
      <section className="dash-section advance-section">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>
              {character.current_week >= 36
                ? 'Simulation complete!'
                : weekLocked
                  ? '🔒 Waiting for teacher'
                  : advancing
                    ? 'Advancing to next week...'
                    : pendingActions
                      ? 'Complete your decisions to advance'
                      : 'Ready to advance'}
            </p>
            {weekLocked && character.current_week < 36 && (
              <p style={{ fontSize: '0.8rem', color: 'var(--gray-400)', marginTop: '0.15rem' }}>
                Your teacher hasn't unlocked the next week yet. Check back soon!
              </p>
            )}
            {!weekLocked && pendingActions && (
              <p style={{ fontSize: '0.8rem', color: 'var(--gray-400)', marginTop: '0.15rem' }}>
                Make all decisions above before moving on.
              </p>
            )}
          </div>
          <button
            className="btn btn-primary"
            style={{ width: 'auto', padding: '0.6rem 1.5rem' }}
            onClick={handleAdvanceWeek}
            disabled={!canAdvance || advancing}
            type="button"
          >
            {advancing ? 'Processing...' : character.current_week >= 36 ? 'Finished' : weekLocked ? 'Locked' : 'Advance to Next Week'}
          </button>
        </div>
        {advanceResult && (
          <div className="advance-summary">
            <span>Week {advanceResult.week} results: </span>
            <span style={{ fontWeight: 600, color: Number(advanceResult.net_worth) >= Number(previous?.net_worth || 0) ? '#16a34a' : '#dc2626' }}>
              Net worth {money(advanceResult.net_worth)}
            </span>
          </div>
        )}
      </section>

      {/* ── Stat Cards ── */}
      <div className="dash-stats">
        <div className="stat-card">
          <p className="stat-label">Net Worth</p>
          <p className="stat-value">{money(latest.net_worth)}</p>
          {nwDelta !== null && (
            <p className={`stat-delta ${nwDelta >= 0 ? 'positive' : 'negative'}`}>
              {nwDelta >= 0 ? '↑' : '↓'} {money(Math.abs(nwDelta))}
            </p>
          )}
        </div>
        <div className="stat-card">
          <p className="stat-label">Cash on Hand</p>
          <p className="stat-value">{money(latest.cash)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Monthly Income</p>
          <p className="stat-value">{money(latest.monthly_income)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Monthly Expenses</p>
          <p className="stat-value">{money(latest.monthly_expenses)}</p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Total Debt</p>
          <p className="stat-value" style={{ color: Number(latest.debt) > 0 ? '#dc2626' : 'inherit' }}>
            {Number(latest.debt) > 0 ? money(latest.debt) : 'None'}
          </p>
        </div>
        <div className="stat-card">
          <p className="stat-label">Savings Rate</p>
          <p className="stat-value">{pct(savingsRate)}</p>
        </div>
      </div>

      {/* ── Net Worth Chart ── */}
      <section className="dash-section">
        <h2 className="dash-section-title">Net Worth Over Time</h2>
        <NetWorthChart data={history} />
      </section>

      {/* ── Budget Breakdown ── */}
      <section className="dash-section">
        <h2 className="dash-section-title">Monthly Budget Breakdown</h2>
        <BudgetBreakdown latest={latest} />
      </section>

      {/* ── Grades + Credit side by side ── */}
      <div className="dash-bottom-grid">
        <section className="dash-section">
          <h2 className="dash-section-title">Financial Health</h2>
          <div className="grades-list">
            {Object.entries(GRADE_META).map(([key, meta]) => {
              const unlocked = !meta.unit || unlockedCategories.includes(key)
              const score = grades[key]
              const g = gradeFromScore(score)
              return (
                <div key={key} className={`grade-row ${!unlocked ? 'locked' : ''}`}>
                  <span className="grade-label">{meta.label}</span>
                  {unlocked ? (
                    <>
                      <div className="grade-bar-track">
                        <div className="grade-bar-fill" style={{ width: `${score}%`, background: g.color }} />
                      </div>
                      <span className="grade-letter" style={{ color: g.color }}>{g.letter}</span>
                    </>
                  ) : (
                    <span className="grade-locked">🔒 Unlocks in {meta.unit}</span>
                  )}
                </div>
              )
            })}
          </div>
        </section>

        <section className="dash-section">
          <h2 className="dash-section-title">Credit Score</h2>
          <CreditScoreDisplay score={latest.credit_score} />
        </section>
      </div>

      {/* ── Badges ── */}
      {allBadges.length > 0 && (
        <section className="dash-section" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
            <h2 className="dash-section-title" style={{ marginBottom: 0 }}>🏆 Achievements</h2>
            <span style={{ fontSize: '0.8rem', color: 'var(--gray-400)', fontWeight: 600 }}>
              {Object.keys(earnedBadgeIds).length} of {allBadges.length} earned
            </span>
          </div>
          <div className="badge-grid">
            {[...allBadges]
              .sort((a, b) => (earnedBadgeIds[b.id] ? 1 : 0) - (earnedBadgeIds[a.id] ? 1 : 0) || a.sort_order - b.sort_order)
              .map(badge => {
                const earned = earnedBadgeIds[badge.id]
                return (
                  <div key={badge.id} className={`badge-card ${earned ? 'earned' : 'locked'}`}>
                    <div className="badge-emoji-wrap">
                      <span className="badge-emoji">{badge.emoji}</span>
                      {earned && <span className="badge-check">✅</span>}
                      {!earned && <span className="badge-lock">🔒</span>}
                    </div>
                    <p className="badge-name">{badge.name}</p>
                    <p className="badge-desc">
                      {earned ? badge.description : badge.condition_description}
                    </p>
                    {earned && (
                      <p className="badge-date">
                        {new Date(earned).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </p>
                    )}
                  </div>
                )
              })}
          </div>
        </section>
      )}
    </div>
  )
}
