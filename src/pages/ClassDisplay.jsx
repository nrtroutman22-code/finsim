import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'

function money(n) {
  const num = Number(n) || 0
  return (num < 0 ? '-$' : '$') + Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function creditColor(score) {
  if (score >= 740) return '#16a34a'
  if (score >= 670) return '#22c55e'
  if (score >= 580) return '#eab308'
  return '#dc2626'
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

const GRADE_LABELS = {
  budgeting: 'Budgeting',
  debt_management: 'Debt Management',
  savings: 'Savings',
  investing: 'Investing',
}

export default function ClassDisplay() {
  const { characterId } = useParams()
  const [searchParams] = useSearchParams()
  const anonymous = searchParams.get('anonymous') === 'true'

  const [character, setCharacter] = useState(null)
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState([])
  const [allBadges, setAllBadges] = useState([])
  const [earnedBadgeIds, setEarnedBadgeIds] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function load() {
      try {
        const { data: char, error: cErr } = await supabase
          .from('characters')
          .select('*, life_paths(name), locations(name)')
          .eq('id', characterId)
          .single()
        if (cErr || !char) throw new Error('Character not found')
        setCharacter(char)

        const { data: states } = await supabase
          .from('financial_states')
          .select('*')
          .eq('character_id', characterId)
          .order('week', { ascending: true })
        setHistory(states || [])
        if (states && states.length > 0) setLatest(states[states.length - 1])

        const [{ data: badges }, { data: earned }] = await Promise.all([
          supabase.from('badges').select('*').order('sort_order'),
          supabase.from('character_badges').select('badge_id, earned_at').eq('character_id', characterId),
        ])
        setAllBadges(badges || [])
        const map = {}
        ;(earned || []).forEach(e => { map[e.badge_id] = e.earned_at })
        setEarnedBadgeIds(map)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [characterId])

  if (loading) {
    return (
      <div className="page-center">
        <p style={{ color: 'var(--gray-400)' }}>Loading display...</p>
      </div>
    )
  }

  if (error || !character || !latest) {
    return (
      <div className="page-center">
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
          <p className="error-msg">{error || 'No data available for this student yet.'}</p>
        </div>
      </div>
    )
  }

  const displayName = anonymous ? 'Student A' : character.name
  const grades = calcGrades(latest)
  const income = Number(latest.monthly_income) || 1
  const expenses = Number(latest.monthly_expenses) || 0
  const savingsRate = Math.max(0, Math.round(((income - expenses) / income) * 100))
  const credit = latest.credit_score || 650
  const creditPct = ((credit - 300) / 550) * 100
  const creditLabel = credit >= 740 ? 'Excellent' : credit >= 670 ? 'Good' : credit >= 580 ? 'Fair' : 'Poor'

  // Budget breakdown
  const rent = Math.round(expenses * 0.40)
  const food = Math.round(expenses * 0.20)
  const transport = Math.round(expenses * 0.12)
  const phone = Math.round(expenses * 0.08)
  const personal = expenses - rent - food - transport - phone
  const savingsAmt = Math.max(0, income - expenses)
  const budgetItems = [
    { label: 'Rent', amount: rent, color: '#3b82f6' },
    { label: 'Food', amount: food, color: '#22c55e' },
    { label: 'Transport', amount: transport, color: '#f59e0b' },
    { label: 'Phone / Utilities', amount: phone, color: '#8b5cf6' },
    { label: 'Personal', amount: personal, color: '#ec4899' },
    { label: 'Savings', amount: savingsAmt, color: '#06b6d4' },
  ]
  const budgetMax = Math.max(...budgetItems.map(i => i.amount), 1)

  // Net worth chart
  const W = 600, H = 200, PL = 60, PR = 15, PT = 15, PB = 30
  const plotW = W - PL - PR, plotH = H - PT - PB
  const vals = history.map(d => Number(d.net_worth))
  const minV = Math.min(...vals), maxV = Math.max(...vals)
  const range = maxV - minV || 1
  const cx = i => PL + (history.length > 1 ? (i / (history.length - 1)) * plotW : plotW / 2)
  const cy = v => PT + plotH - ((v - minV) / range) * plotH
  const chartPoints = history.map((d, i) => `${cx(i)},${cy(Number(d.net_worth))}`).join(' ')
  const yTicks = 4
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => minV + (range / yTicks) * i)

  const earnedCount = Object.keys(earnedBadgeIds).length

  return (
    <div className="cd-page">
      <div className="cd-banner">
        <span>📺 Class Display Mode</span>
      </div>

      <div className="cd-container">
        {/* Header */}
        <header className="cd-header">
          <div className="cd-header-left">
            {anonymous ? (
              <div className="cd-avatar-anon">?</div>
            ) : (
              <div className="dash-avatar" style={{ backgroundColor: character.background_color, fontSize: '2rem', width: 56, height: 56 }}>
                {character.emoji}
              </div>
            )}
            <div>
              <h1 className="cd-name">{displayName}</h1>
              <p className="cd-subtitle">{character.life_paths?.name} · {character.locations?.name}</p>
            </div>
          </div>
          <span className="dash-week-badge" style={{ fontSize: '1rem', padding: '0.4rem 1rem' }}>Week {character.current_week} of 36</span>
        </header>

        {/* Stat cards */}
        <div className="dash-stats cd-stats">
          <div className="stat-card">
            <p className="stat-label">Net Worth</p>
            <p className="stat-value">{money(latest.net_worth)}</p>
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
            <p className="stat-value">{savingsRate}%</p>
          </div>
        </div>

        {/* Net Worth Chart */}
        <section className="dash-section">
          <h2 className="dash-section-title">Net Worth Over Time</h2>
          {history.length < 2 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-400)', fontSize: '0.9rem' }}>
              Chart will appear after Week 1
            </div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
              {yLabels.map((v, i) => (
                <g key={i}>
                  <line x1={PL} x2={W - PR} y1={cy(v)} y2={cy(v)} stroke="var(--gray-200)" strokeWidth="1" />
                  <text x={PL - 8} y={cy(v) + 4} textAnchor="end" fontSize="11" fill="var(--gray-400)">{money(v)}</text>
                </g>
              ))}
              <polyline fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinejoin="round" points={chartPoints} />
              {history.map((d, i) => (
                <circle key={i} cx={cx(i)} cy={cy(Number(d.net_worth))} r="4" fill="var(--green)" />
              ))}
              {history.map((d, i) => (
                (history.length <= 12 || i % Math.ceil(history.length / 12) === 0 || i === history.length - 1) && (
                  <text key={`l${i}`} x={cx(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--gray-400)">W{d.week}</text>
                )
              ))}
            </svg>
          )}
        </section>

        {/* Budget Breakdown */}
        <section className="dash-section">
          <h2 className="dash-section-title">Monthly Budget Breakdown</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {budgetItems.map(item => (
              <div key={item.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: 'var(--gray-700)' }}>{item.label}</span>
                  <span style={{ color: 'var(--gray-500)' }}>{money(item.amount)}/mo</span>
                </div>
                <div style={{ height: 10, background: 'var(--gray-100)', borderRadius: 5 }}>
                  <div style={{ height: '100%', width: `${(item.amount / budgetMax) * 100}%`, background: item.color, borderRadius: 5, transition: 'width 0.3s' }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Grades + Credit side by side */}
        <div className="dash-bottom-grid">
          <section className="dash-section">
            <h2 className="dash-section-title">Financial Health</h2>
            <div className="grades-list">
              {Object.entries(GRADE_LABELS).map(([key, label]) => {
                const score = grades[key]
                const g = gradeFromScore(score)
                return (
                  <div key={key} className="grade-row">
                    <span className="grade-label">{label}</span>
                    <div className="grade-bar-track">
                      <div className="grade-bar-fill" style={{ width: `${score}%`, background: g.color }} />
                    </div>
                    <span className="grade-letter" style={{ color: g.color }}>{g.letter}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Credit Score</h2>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2.75rem', fontWeight: 700, color: creditColor(credit), lineHeight: 1.2 }}>{credit}</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--gray-400)', marginBottom: '0.75rem' }}>{creditLabel}</div>
              <div style={{ height: 12, borderRadius: 6, background: 'linear-gradient(to right, #dc2626, #f97316, #eab308, #22c55e, #16a34a)', position: 'relative' }}>
                <div style={{
                  position: 'absolute', top: -3, left: `${creditPct}%`, transform: 'translateX(-50%)',
                  width: 18, height: 18, borderRadius: '50%', border: '3px solid white',
                  background: creditColor(credit), boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--gray-400)', marginTop: '0.3rem' }}>
                <span>300</span><span>850</span>
              </div>
            </div>
          </section>
        </div>

        {/* Badges */}
        {allBadges.length > 0 && (
          <section className="dash-section" style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
              <h2 className="dash-section-title" style={{ marginBottom: 0 }}>Achievements</h2>
              <span style={{ fontSize: '0.85rem', color: 'var(--gray-400)', fontWeight: 600 }}>
                {earnedCount} of {allBadges.length} earned
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
                        {earned && <span className="badge-check">&#x2705;</span>}
                        {!earned && <span className="badge-lock">&#x1F512;</span>}
                      </div>
                      <p className="badge-name">{badge.name}</p>
                      <p className="badge-desc">{earned ? badge.description : badge.condition_description}</p>
                    </div>
                  )
                })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
