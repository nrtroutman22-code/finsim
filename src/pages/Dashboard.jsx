import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { advanceWeek, processDecision, processLifeEvent, triggerRandomLifeEvent } from '../lib/simulationEngine'

// ─── Helpers ───────────────────────────────────────────

function money(n) {
  const num = Number(n) || 0
  return (num < 0 ? '-$' : '$') + Math.abs(num).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function pct(n) { return Math.round(n) + '%' }

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
  return {
    budgeting: Math.round(Math.min(100, Math.max(0, 50 + savingsRate * 2.5))),
    debt_management: Math.round(debt === 0 ? 95 : Math.max(0, 100 - (debt / income) * 8)),
    savings: Math.round(Math.min(100, (savings / income) * 25)),
    investing: Math.round(Math.min(100, credit >= 700 ? 60 + (savings / 1000) * 10 : 30 + (savings / 1000) * 5)),
  }
}

const GRADE_META = {
  budgeting: { label: 'Budgeting', unit: null },
  debt_management: { label: 'Debt Management', unit: null },
  savings: { label: 'Savings', unit: 'Unit 3' },
  investing: { label: 'Investing', unit: 'Unit 4' },
}

function creditColor(s) {
  if (s >= 740) return '#16a34a'
  if (s >= 670) return '#22c55e'
  if (s >= 580) return '#eab308'
  return '#dc2626'
}

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
  { id: 'journey', label: 'My Journey', icon: '📈' },
  { id: 'finances', label: 'My Finances', icon: '💰' },
  { id: 'class', label: 'My Class', icon: '👥' },
]

const FALLBACK_NEWS = {
  budgeting: { headline: 'Americans who follow the 50/30/20 budget rule save 3x more than those who don\'t', explainer: 'A simple budget framework can make a huge difference — even small habits now compound over a lifetime.' },
  debt: { headline: 'Average American credit card debt hits $6,500 in 2026 as interest rates stay elevated', explainer: 'Carrying a balance at 20%+ APR means you could end up paying back nearly double what you borrowed.' },
  savings: { headline: 'Survey: 56% of Americans can\'t cover a $1,000 emergency expense without borrowing', explainer: 'An emergency fund isn\'t optional — one unexpected bill without savings can spiral into months of debt.' },
  investing: { headline: 'A 25-year-old who invests $100/month could have over $300,000 by retirement', explainer: 'Starting early is the single biggest advantage in investing — time in the market beats timing the market.' },
}

// ─── AI Helper ─────────────────────────────────────────

async function callAI(prompt) {
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, max_tokens: 1000 }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.content?.[0]?.text || null
  } catch { return null }
}

// ─── SVG Line Chart ────────────────────────────────────

function NetWorthChart({ data, large }) {
  if (data.length < 2) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-400)', fontSize: '0.9rem' }}>Chart will appear after Week 1</div>
  }
  const W = large ? 640 : 520, H = large ? 220 : 180, PL = 55, PR = 15, PT = 15, PB = 30
  const plotW = W - PL - PR, plotH = H - PT - PB
  const vals = data.map(d => Number(d.net_worth))
  const minV = Math.min(...vals), maxV = Math.max(...vals), range = maxV - minV || 1
  const x = i => PL + (i / (data.length - 1)) * plotW
  const y = v => PT + plotH - ((v - minV) / range) * plotH
  const points = data.map((d, i) => `${x(i)},${y(vals[i])}`).join(' ')
  const yTicks = 4
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => minV + (range / yTicks) * i)

  // Trend line: linear regression from last 4 points, project 4 more
  let trendPoints = ''
  if (large && data.length >= 4) {
    const recent = data.slice(-4)
    const n = recent.length
    const xs = recent.map((_, i) => data.length - n + i)
    const ys = recent.map(d => Number(d.net_worth))
    const xMean = xs.reduce((a, b) => a + b, 0) / n
    const yMean = ys.reduce((a, b) => a + b, 0) / n
    const slope = xs.reduce((s, xi, i) => s + (xi - xMean) * (ys[i] - yMean), 0) / xs.reduce((s, xi) => s + (xi - xMean) ** 2, 0)
    const intercept = yMean - slope * xMean
    const projEnd = Math.min(data.length + 4, 36)
    const trendPts = []
    for (let i = data.length - 1; i <= projEnd; i++) {
      const pv = slope * i + intercept
      const px = PL + (i / (projEnd)) * plotW
      const py = PT + plotH - ((pv - minV) / range) * plotH
      trendPts.push(`${px},${Math.max(PT, Math.min(PT + plotH, py))}`)
    }
    trendPoints = trendPts.join(' ')
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {yLabels.map((v, i) => (
        <g key={i}>
          <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="var(--gray-200)" strokeWidth="1" />
          <text x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--gray-400)">{money(v)}</text>
        </g>
      ))}
      {trendPoints && <polyline fill="none" stroke="var(--gray-300)" strokeWidth="1.5" strokeDasharray="6 4" strokeLinejoin="round" points={trendPoints} />}
      <polyline fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinejoin="round" points={points} />
      {data.map((d, i) => <circle key={i} cx={x(i)} cy={y(vals[i])} r="3.5" fill="var(--green)" />)}
      {data.map((d, i) => (data.length <= 12 || i % Math.ceil(data.length / 12) === 0 || i === data.length - 1) && (
        <text key={`l${i}`} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--gray-400)">W{d.week}</text>
      ))}
      {trendPoints && (
        <text x={W - PR} y={PT + 12} textAnchor="end" fontSize="9" fill="var(--gray-400)">— projected trend</text>
      )}
    </svg>
  )
}

// ─── Budget Bars ───────────────────────────────────────

function BudgetBreakdown({ latest, showRecommended }) {
  const expenses = Number(latest.monthly_expenses) || 1
  const income = Number(latest.monthly_income) || 1
  const savingsAmt = Math.max(0, income - expenses)
  const rent = Math.round(expenses * 0.40)
  const food = Math.round(expenses * 0.20)
  const transport = Math.round(expenses * 0.12)
  const phone = Math.round(expenses * 0.08)
  const personal = expenses - rent - food - transport - phone

  const items = [
    { label: 'Rent', amount: rent, color: '#3b82f6', recommended: showRecommended ? 30 : null },
    { label: 'Food', amount: food, color: '#22c55e', recommended: showRecommended ? 15 : null },
    { label: 'Transport', amount: transport, color: '#f59e0b', recommended: showRecommended ? 10 : null },
    { label: 'Phone / Utilities', amount: phone, color: '#8b5cf6', recommended: showRecommended ? 5 : null },
    { label: 'Personal', amount: personal, color: '#ec4899', recommended: showRecommended ? 10 : null },
    { label: 'Savings', amount: savingsAmt, color: '#06b6d4', recommended: showRecommended ? 20 : null },
  ]
  const max = Math.max(...items.map(i => i.amount), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {items.map(item => {
        const actualPct = Math.round((item.amount / income) * 100)
        const overBudget = item.recommended && actualPct > item.recommended + 5
        return (
          <div key={item.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
              <span style={{ color: 'var(--gray-700)' }}>{item.label}</span>
              <span style={{ color: 'var(--gray-500)' }}>
                {money(item.amount)}/mo ({actualPct}%)
                {item.recommended != null && (
                  <span style={{ color: overBudget ? '#dc2626' : 'var(--gray-400)', marginLeft: '0.3rem', fontSize: '0.8rem' }}>
                    rec: {item.recommended}%
                  </span>
                )}
              </span>
            </div>
            <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 4, position: 'relative' }}>
              <div style={{ height: '100%', width: `${(item.amount / max) * 100}%`, background: overBudget ? '#dc2626' : item.color, borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Credit Score Display ──────────────────────────────

function CreditScoreDisplay({ score, showBreakdown, history }) {
  const min = 300, max = 850
  const pctVal = ((score - min) / (max - min)) * 100
  const label = score >= 740 ? 'Excellent' : score >= 670 ? 'Good' : score >= 580 ? 'Fair' : 'Poor'

  const factors = showBreakdown ? (() => {
    const prevScore = history.length >= 2 ? history[history.length - 2].credit_score : score
    const change = score - prevScore
    const debt = Number(history[history.length - 1]?.debt) || 0
    const income = Number(history[history.length - 1]?.monthly_income) || 1
    const utilization = Math.min(100, Math.round((debt / (income * 6)) * 100))
    const weeksOfHistory = history.length
    return [
      { label: 'Payment History', impact: change >= 0 ? 'positive' : 'negative', detail: change >= 0 ? 'Bills paid on time' : 'Missed payments detected' },
      { label: 'Credit Utilization', impact: utilization < 30 ? 'positive' : utilization < 60 ? 'neutral' : 'negative', detail: `${utilization}% of available credit used` },
      { label: 'Length of History', impact: weeksOfHistory > 8 ? 'positive' : 'neutral', detail: `${weeksOfHistory} weeks of credit history` },
      { label: 'Recent Decisions', impact: change > 0 ? 'positive' : change === 0 ? 'neutral' : 'negative', detail: change > 0 ? `+${change} pts this week` : change < 0 ? `${change} pts this week` : 'No change this week' },
    ]
  })() : null

  return (
    <div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2.5rem', fontWeight: 700, color: creditColor(score), lineHeight: 1.2 }}>{score}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--gray-400)', marginBottom: '0.75rem' }}>{label}</div>
        <div style={{ height: 10, borderRadius: 5, background: 'linear-gradient(to right, #dc2626, #f97316, #eab308, #22c55e, #16a34a)', position: 'relative' }}>
          <div style={{ position: 'absolute', top: -3, left: `${pctVal}%`, transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: '50%', border: '3px solid white', background: creditColor(score), boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: '0.3rem' }}><span>300</span><span>850</span></div>
      </div>
      {factors && (
        <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {factors.map(f => (
            <div key={f.label} className="credit-factor">
              <span className={`credit-factor-dot ${f.impact}`} />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{f.label}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{f.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Decision Card ─────────────────────────────────────

function DecisionCard({ week, options, onChoose, choosing }) {
  return (
    <section className="dash-section decision-card">
      <h2 className="dash-section-title">This Week's Decision</h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--gray-700)', marginBottom: '0.25rem', fontWeight: 600 }}>{week.title}</p>
      <p style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '0.75rem', lineHeight: 1.5 }}>{week.description}</p>
      <div className="decision-options">
        {options.map(opt => (
          <button key={opt.id} className="option-card" onClick={() => onChoose(opt.id)} disabled={choosing} type="button">
            <div style={{ fontWeight: 600 }}>{opt.label}</div>
            {opt.description && <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginTop: '0.15rem' }}>{opt.description}</div>}
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── Life Event Card ───────────────────────────────────

function LifeEventCard({ event, options, onChoose, choosing }) {
  return (
    <section className={`dash-section decision-card ${event.is_positive ? 'event-positive' : 'event-negative'}`}>
      <h2 className="dash-section-title">{event.is_positive ? '🎉' : '⚠️'} Life Event</h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--gray-700)', marginBottom: '0.25rem', fontWeight: 600 }}>{event.title}</p>
      <p style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '0.75rem', lineHeight: 1.5 }}>{event.description}</p>
      <div className="decision-options">
        {options.map(opt => (
          <button key={opt.id} className="option-card" onClick={() => onChoose(opt.id)} disabled={choosing} type="button">
            <div style={{ fontWeight: 600 }}>{opt.label}</div>
            {opt.description && <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginTop: '0.15rem' }}>{opt.description}</div>}
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── News Tie-In Card ──────────────────────────────────

function NewsCard({ headline, explainer }) {
  if (!headline) return null
  return (
    <div className="news-card">
      <div className="news-card-header">
        <span style={{ fontSize: '1.1rem' }}>📰</span>
        <span className="news-card-label">Real-World Connection</span>
      </div>
      <p className="news-card-headline">{headline}</p>
      <p className="news-card-explainer">{explainer}</p>
    </div>
  )
}

// ─── AI Feedback Card ──────────────────────────────────

function AiFeedbackCard({ feedback, loading }) {
  if (loading) {
    return (
      <div className="ai-feedback-card">
        <div className="ai-feedback-header"><span>💡</span> FinSim Advisor</div>
        <div className="skeleton-pulse" style={{ height: 48, borderRadius: 6, background: 'var(--gray-100)' }} />
      </div>
    )
  }
  if (!feedback) return null
  return (
    <div className="ai-feedback-card">
      <div className="ai-feedback-header"><span>💡</span> FinSim Advisor</div>
      <p className="ai-feedback-text">{feedback}</p>
    </div>
  )
}

// ─── Journey Table ─────────────────────────────────────

function JourneyTable({ history, decisions }) {
  if (history.length === 0) {
    return <p style={{ color: 'var(--gray-400)', textAlign: 'center', padding: '2rem' }}>No history yet. Advance a week to see your journey.</p>
  }
  const decisionMap = {}
  decisions.forEach(d => {
    const label = d.decision_type === 'curriculum'
      ? d.decision_options?.label
      : d.life_event_options?.label
    decisionMap[d.week] = { label: label || '—', type: d.decision_type }
  })

  const sorted = [...history].sort((a, b) => b.week - a.week)

  return (
    <div className="td-table-wrap">
      <table className="journey-table">
        <thead>
          <tr>
            <th>Week</th><th>Net Worth</th><th>Cash</th><th>Savings</th><th>Debt</th><th>Credit</th><th>Decision</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const prev = sorted[i + 1]
            const nwChange = prev ? Number(row.net_worth) - Number(prev.net_worth) : 0
            const isUp = nwChange > 0
            const isDown = nwChange < 0
            const dec = decisionMap[row.week]
            return (
              <tr key={row.week} className={row.week === 0 ? 'week-zero' : isUp ? 'week-up' : isDown ? 'week-down' : ''}>
                <td style={{ fontWeight: 600 }}>W{row.week}</td>
                <td>
                  <span>{money(row.net_worth)}</span>
                  {nwChange !== 0 && <span className={`nw-arrow ${isUp ? 'up' : 'down'}`}>{isUp ? '↑' : '↓'}{money(Math.abs(nwChange))}</span>}
                </td>
                <td>{money(row.cash)}</td>
                <td>{money(row.savings)}</td>
                <td style={{ color: Number(row.debt) > 0 ? '#dc2626' : 'inherit' }}>{Number(row.debt) > 0 ? money(row.debt) : '—'}</td>
                <td>{row.credit_score}</td>
                <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dec ? (
                    <span className={`decision-chip ${dec.type === 'life_event' ? 'life-event' : ''}`}>{dec.label}</span>
                  ) : row.week === 0 ? 'Start' : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── Consequence Tracker ───────────────────────────────

function ConsequenceTracker({ decisions, latest }) {
  const consequences = []
  decisions.forEach(d => {
    if (d.decision_type !== 'curriculum') return
    const impact = d.decision_options?.financial_impact
    if (!impact) return
    if (impact.debt && impact.debt > 0) {
      consequences.push({
        week: d.week,
        label: d.decision_options?.label || 'Decision',
        desc: `Added ${money(impact.debt)} in debt. You're paying interest each week until it's paid off.`,
        severity: 'warning',
      })
    }
    if (impact.monthly_expenses && impact.monthly_expenses > 0) {
      consequences.push({
        week: d.week,
        label: d.decision_options?.label || 'Decision',
        desc: `Increased monthly expenses by ${money(impact.monthly_expenses)}. This compounds every week.`,
        severity: 'warning',
      })
    }
    if (impact.credit_score && impact.credit_score < 0) {
      consequences.push({
        week: d.week,
        label: d.decision_options?.label || 'Decision',
        desc: `Reduced your credit score by ${Math.abs(impact.credit_score)} points. Lower credit = higher borrowing costs.`,
        severity: 'danger',
      })
    }
  })

  const debt = Number(latest?.debt) || 0
  if (debt > 0) {
    const income = Number(latest?.monthly_income) || 1
    if (debt > income * 3) {
      consequences.push({
        week: null,
        label: 'High Debt Warning',
        desc: `Your debt (${money(debt)}) is more than 3x your monthly income. This is hurting your credit score every week.`,
        severity: 'danger',
      })
    }
  }

  if (consequences.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--gray-400)', fontSize: '0.9rem' }}>
        No pending consequences. Your financial decisions are looking clean.
      </div>
    )
  }

  return (
    <div className="consequence-list">
      {consequences.map((c, i) => (
        <div key={i} className={`consequence-card ${c.severity}`}>
          <div className="consequence-header">
            <span>{c.severity === 'danger' ? '🔴' : '🟠'}</span>
            <strong>{c.label}</strong>
            {c.week && <span style={{ color: 'var(--gray-400)', fontSize: '0.8rem' }}>Week {c.week}</span>}
          </div>
          <p>{c.desc}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Debt Tracker ──────────────────────────────────────

function DebtTracker({ latest }) {
  const debt = Number(latest?.debt) || 0
  const income = Number(latest?.monthly_income) || 1
  const [extraPayment, setExtraPayment] = useState(0)

  if (debt === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '1.5rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🎉</div>
        <p style={{ fontWeight: 600, color: '#16a34a' }}>Debt free!</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)', marginTop: '0.25rem' }}>You don't owe anything. Keep it that way.</p>
      </div>
    )
  }

  const apr = 0.18
  const monthlyRate = apr / 12
  const minPayment = Math.max(25, Math.round(debt * 0.02))
  const totalPayment = minPayment + extraPayment

  function monthsToPayoff(principal, monthlyPay) {
    if (monthlyPay <= principal * monthlyRate) return Infinity
    let balance = principal
    let months = 0
    while (balance > 0 && months < 600) {
      balance += balance * monthlyRate
      balance -= monthlyPay
      months++
    }
    return months
  }

  const baseMonths = monthsToPayoff(debt, minPayment)
  const fastMonths = extraPayment > 0 ? monthsToPayoff(debt, totalPayment) : baseMonths
  const totalInterest = Math.max(0, baseMonths * minPayment - debt)
  const fastInterest = extraPayment > 0 ? Math.max(0, fastMonths * totalPayment - debt) : totalInterest

  return (
    <div>
      <div className="debt-summary">
        <div className="debt-stat"><span className="debt-stat-label">Total Debt</span><span className="debt-stat-value" style={{ color: '#dc2626' }}>{money(debt)}</span></div>
        <div className="debt-stat"><span className="debt-stat-label">APR</span><span className="debt-stat-value">18%</span></div>
        <div className="debt-stat"><span className="debt-stat-label">Min Payment</span><span className="debt-stat-value">{money(minPayment)}/mo</span></div>
        <div className="debt-stat"><span className="debt-stat-label">Payoff</span><span className="debt-stat-value">{baseMonths === Infinity ? 'Never' : `${baseMonths} months`}</span></div>
      </div>
      <div className="debt-calc">
        <label style={{ fontWeight: 600, fontSize: '0.85rem' }}>What if I paid extra each month?</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
          <span style={{ fontSize: '0.9rem', color: 'var(--gray-500)' }}>+$</span>
          <input className="input" type="number" min="0" max="5000" value={extraPayment || ''} onChange={e => setExtraPayment(Math.max(0, Number(e.target.value) || 0))} style={{ width: 100 }} placeholder="0" />
          <span style={{ fontSize: '0.85rem', color: 'var(--gray-400)' }}>/month extra</span>
        </div>
        {extraPayment > 0 && (
          <div className="debt-calc-result">
            <p>Payoff in <strong>{fastMonths === Infinity ? 'never' : `${fastMonths} months`}</strong> instead of {baseMonths === Infinity ? 'never' : baseMonths}</p>
            <p>You'd save <strong style={{ color: '#16a34a' }}>{money(totalInterest - fastInterest)}</strong> in interest</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Investment Portfolio ──────────────────────────────

const INVEST_OPTIONS = [
  { id: 'hys', label: 'High-Yield Savings', emoji: '🏦', apy: 0.045, risk: 'Low risk' },
  { id: 'index', label: 'Index Fund', emoji: '📊', apy: 0.08, risk: 'Medium risk' },
  { id: 'stocks', label: 'Individual Stocks', emoji: '📈', apy: 0.12, risk: 'High risk' },
]

function InvestmentPortfolio({ unlocked, savings }) {
  const [allocations, setAllocations] = useState(() => {
    const stored = localStorage.getItem('finsim_invest_alloc')
    return stored ? JSON.parse(stored) : { hys: 0, index: 0, stocks: 0 }
  })
  const [investAmount, setInvestAmount] = useState(0)

  const totalAllocated = allocations.hys + allocations.index + allocations.stocks
  const portfolioValue = totalAllocated

  function updateAlloc(id, val) {
    const next = { ...allocations, [id]: Math.max(0, val) }
    setAllocations(next)
    localStorage.setItem('finsim_invest_alloc', JSON.stringify(next))
  }

  if (!unlocked) {
    return (
      <div className="invest-locked">
        <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔒</div>
        <p style={{ fontWeight: 600, color: 'var(--gray-500)' }}>Investment Portfolio</p>
        <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)' }}>Unlocks when your teacher enables the Investing module.</p>
      </div>
    )
  }

  function projectedGrowth(amount, apy, years) {
    return amount * Math.pow(1 + apy, years)
  }

  return (
    <div>
      <div className="invest-grid">
        {INVEST_OPTIONS.map(opt => (
          <div key={opt.id} className="invest-card">
            <div style={{ fontSize: '1.5rem' }}>{opt.emoji}</div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{opt.label}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--gray-500)' }}>{(opt.apy * 100).toFixed(1)}% APY · {opt.risk}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--primary)', marginTop: '0.25rem' }}>{money(allocations[opt.id])}</div>
            {portfolioValue > 0 && (
              <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: '0.15rem' }}>
                5yr: {money(projectedGrowth(allocations[opt.id], opt.apy, 5))} · 20yr: {money(projectedGrowth(allocations[opt.id], opt.apy, 20))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Invest from savings:</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--gray-400)' }}>(Available: {money(savings)})</span>
      </div>
      <div className="invest-alloc-form">
        {INVEST_OPTIONS.map(opt => (
          <div key={opt.id} className="invest-alloc-row">
            <span style={{ fontSize: '0.85rem', minWidth: 60 }}>{opt.emoji} {opt.id === 'hys' ? 'HYSA' : opt.id === 'index' ? 'Index' : 'Stocks'}</span>
            <input className="input" type="number" min="0" value={allocations[opt.id] || ''} onChange={e => updateAlloc(opt.id, Number(e.target.value) || 0)} style={{ width: 90 }} placeholder="$0" />
          </div>
        ))}
      </div>
      {portfolioValue > 0 && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', fontWeight: 600 }}>
          Total Portfolio: {money(portfolioValue)}
        </div>
      )}
    </div>
  )
}

// ─── Compound Interest Calculator ──────────────────────

function CompoundInterestCalc() {
  const [monthly, setMonthly] = useState(100)
  const [rate, setRate] = useState(8)

  function compound(contribution, annualRate, years) {
    const monthlyRate = annualRate / 100 / 12
    const months = years * 12
    if (monthlyRate === 0) return contribution * months
    return contribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate)
  }

  const at18 = compound(monthly, rate, 47) // 18 to 65
  const at28 = compound(monthly, rate, 37) // 28 to 65
  const diff = at18 - at28

  // Chart: yearly from 18 to 65
  const chartData = []
  for (let age = 18; age <= 65; age++) {
    chartData.push({
      age,
      start18: age >= 18 ? compound(monthly, rate, age - 18) : 0,
      start28: age >= 28 ? compound(monthly, rate, age - 28) : 0,
    })
  }

  const W = 560, H = 220, PL = 60, PR = 15, PT = 20, PB = 30
  const plotW = W - PL - PR, plotH = H - PT - PB
  const maxVal = Math.max(at18, 1)
  const x = age => PL + ((age - 18) / 47) * plotW
  const y = v => PT + plotH - (v / maxVal) * plotH

  const line18 = chartData.map(d => `${x(d.age)},${y(d.start18)}`).join(' ')
  const line28 = chartData.filter(d => d.age >= 28).map(d => `${x(d.age)},${y(d.start28)}`).join(' ')

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(p => Math.round(maxVal * p))

  return (
    <div>
      <div className="ci-inputs">
        <div className="ci-input-group">
          <label>Monthly contribution</label>
          <div className="ci-input-row">
            <span>$</span>
            <input className="input" type="number" min="10" max="5000" value={monthly} onChange={e => setMonthly(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </div>
        <div className="ci-input-group">
          <label>Annual return</label>
          <div className="ci-input-row">
            <input className="input" type="number" min="1" max="30" step="0.5" value={rate} onChange={e => setRate(Math.max(0, Number(e.target.value) || 0))} />
            <span>%</span>
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: '0.75rem' }}>
        {yTicks.map((v, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="var(--gray-200)" strokeWidth="1" />
            <text x={PL - 8} y={y(v) + 4} textAnchor="end" fontSize="9" fill="var(--gray-400)">{money(v)}</text>
          </g>
        ))}
        <polyline fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinejoin="round" points={line18} />
        <polyline fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" points={line28} />
        {[18, 28, 38, 48, 58, 65].map(age => (
          <text key={age} x={x(age)} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--gray-400)">{age}</text>
        ))}
        <text x={x(35)} y={y(chartData.find(d => d.age === 35)?.start18 || 0) - 8} fontSize="9" fill="#16a34a" fontWeight="600">Start at 18</text>
        <text x={x(45)} y={y(chartData.find(d => d.age === 45)?.start28 || 0) - 8} fontSize="9" fill="#3b82f6" fontWeight="600">Start at 28</text>
      </svg>

      <div className="ci-results">
        <div className="ci-result-card green">
          <p className="ci-result-label">Start investing at 18</p>
          <p className="ci-result-value">{money(at18)}</p>
          <p className="ci-result-sub">by age 65</p>
        </div>
        <div className="ci-result-card blue">
          <p className="ci-result-label">Start investing at 28</p>
          <p className="ci-result-value">{money(at28)}</p>
          <p className="ci-result-sub">by age 65</p>
        </div>
        <div className="ci-result-card highlight">
          <p className="ci-result-label">10 years costs you</p>
          <p className="ci-result-value" style={{ color: '#dc2626' }}>{money(diff)}</p>
          <p className="ci-result-sub">in lost growth</p>
        </div>
      </div>
    </div>
  )
}

// ─── Savings Goals ─────────────────────────────────────

function SavingsGoals({ savings, characterId }) {
  const [goals, setGoals] = useState(() => {
    const stored = localStorage.getItem(`finsim_goals_${characterId}`)
    return stored ? JSON.parse(stored) : [
      { id: '1', label: 'Emergency Fund', target: 3000, icon: '🛡️' },
    ]
  })
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newTarget, setNewTarget] = useState('')

  function saveGoals(next) {
    setGoals(next)
    localStorage.setItem(`finsim_goals_${characterId}`, JSON.stringify(next))
  }

  function addGoal() {
    if (!newLabel.trim() || !newTarget) return
    saveGoals([...goals, { id: Date.now().toString(), label: newLabel.trim(), target: Number(newTarget), icon: '🎯' }])
    setNewLabel('')
    setNewTarget('')
    setAdding(false)
  }

  function removeGoal(id) {
    saveGoals(goals.filter(g => g.id !== id))
  }

  return (
    <div>
      <div className="goals-list">
        {goals.map(g => {
          const progress = Math.min(100, Math.round((savings / g.target) * 100))
          const reached = savings >= g.target
          return (
            <div key={g.id} className={`goal-card ${reached ? 'reached' : ''}`}>
              <div className="goal-header">
                <span>{g.icon} {g.label}</span>
                <button className="goal-remove" onClick={() => removeGoal(g.id)} type="button">&times;</button>
              </div>
              <div className="goal-bar-track">
                <div className="goal-bar-fill" style={{ width: `${progress}%`, background: reached ? '#16a34a' : 'var(--primary)' }} />
              </div>
              <div className="goal-footer">
                <span>{money(savings)} / {money(g.target)}</span>
                <span style={{ color: reached ? '#16a34a' : 'var(--gray-400)' }}>{reached ? 'Reached!' : `${progress}%`}</span>
              </div>
            </div>
          )
        })}
      </div>
      {adding ? (
        <div className="goal-add-form">
          <input className="input" placeholder="Goal name" value={newLabel} onChange={e => setNewLabel(e.target.value)} style={{ flex: 1 }} />
          <input className="input" type="number" placeholder="$ target" value={newTarget} onChange={e => setNewTarget(e.target.value)} style={{ width: 100 }} />
          <button className="btn btn-primary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={addGoal}>Add</button>
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.35rem 0.85rem', fontSize: '0.85rem', marginTop: '0.5rem' }} onClick={() => setAdding(true)} type="button">+ Add Goal</button>
      )}
    </div>
  )
}

// ─── My Class Tab ──────────────────────────────────────

const PATH_TO_GROUP = {
  'retail-food': 'Straight to Work', trades: 'Straight to Work', 'office-admin': 'Straight to Work',
  military: 'Straight to Work', 'gig-freelance': 'Straight to Work', healthcare: 'Straight to Work',
  'cc-parttime': 'Community College', 'cc-fulltime': 'Community College',
  'uni-oncampus': 'University', 'uni-offcampus': 'University',
  'four-year-college': 'University', 'community-college': 'Community College',
  'trade-school': 'Straight to Work', 'tech-bootcamp': 'Straight to Work',
  apprenticeship: 'Straight to Work', 'straight-to-work': 'Straight to Work',
  entrepreneur: 'Straight to Work', 'gap-year': 'Straight to Work',
  'family-business': 'Straight to Work',
}
const PATH_GROUP_COLORS = { 'Straight to Work': '#3b82f6', 'Community College': '#8b5cf6', University: '#f59e0b' }
const PATH_GROUP_ORDER = ['Straight to Work', 'Community College', 'University']

function MyClassTab({ sectionId, character, latest }) {
  const [peers, setPeers] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!sectionId || !character) return
    async function load() {
      setLoading(true)
      const { data, error } = await supabase.rpc('get_class_comparison', { p_section_id: sectionId })
      if (error) {
        console.log('[MyClassTab] RPC error:', error.message)
        setPeers([])
        setLoading(false)
        return
      }
      const rows = data || []
      console.log('[MyClassTab] Found', rows.length, 'students in section')
      const results = rows.map(r => {
        const income = Number(r.monthly_income) || 1
        const expenses = Number(r.monthly_expenses) || 0
        return {
          characterId: r.character_id,
          lifePathId: r.life_path_id,
          netWorth: Number(r.net_worth) || 0,
          savings: Number(r.savings) || 0,
          debt: Number(r.debt) || 0,
          creditScore: r.credit_score || 650,
          savingsRate: Math.max(0, Math.round(((income - expenses) / income) * 100)),
        }
      })
      setPeers(results)
      setLoading(false)
    }
    load()
  }, [sectionId, character])

  if (loading) {
    return (
      <section className="dash-section" style={{ padding: '2rem', textAlign: 'center' }}>
        <div className="skeleton-pulse" style={{ width: 200, height: 16, borderRadius: 4, background: 'var(--gray-200)', margin: '0 auto 1rem' }} />
        <div className="skeleton-pulse" style={{ width: '100%', height: 120, borderRadius: 8, background: 'var(--gray-100)' }} />
      </section>
    )
  }

  if (!peers || peers.length < 3) {
    return (
      <section className="dash-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👥</div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.5rem' }}>Not Enough Data Yet</h2>
        <p style={{ color: 'var(--gray-400)', fontSize: '0.9rem', maxWidth: 400, margin: '0 auto' }}>
          Class comparison needs at least 3 students in your section. Ask your classmates to join!
        </p>
      </section>
    )
  }

  const me = peers.find(p => p.characterId === character.id)
  if (!me) return null

  const myIncome = Number(latest?.monthly_income) || 1
  const myExpenses = Number(latest?.monthly_expenses) || 0
  const mySavingsRate = Math.max(0, Math.round(((myIncome - myExpenses) / myIncome) * 100))

  // Rankings (percentile = % of class you beat)
  function percentile(arr, myVal) {
    const below = arr.filter(v => v < myVal).length
    return Math.round((below / arr.length) * 100)
  }

  const nwPct = percentile(peers.map(p => p.netWorth), me.netWorth)
  const creditPct = percentile(peers.map(p => p.creditScore), me.creditScore)
  const debtPct = percentile(peers.map(p => p.debt), me.debt * -1) // invert: less debt = better
  const avgSavingsRate = Math.round(peers.reduce((s, p) => s + p.savingsRate, 0) / peers.length)

  const avgNW = Math.round(peers.reduce((s, p) => s + p.netWorth, 0) / peers.length)
  const avgCredit = Math.round(peers.reduce((s, p) => s + p.creditScore, 0) / peers.length)
  const avgDebt = Math.round(peers.reduce((s, p) => s + p.debt, 0) / peers.length)

  function tier(pct) {
    if (pct >= 60) return { label: 'Above average', color: '#16a34a', bg: '#f0fdf4' }
    if (pct >= 40) return { label: 'Average', color: '#eab308', bg: '#fefce8' }
    return { label: 'Below average', color: '#dc2626', bg: '#fef2f2' }
  }

  const comparisons = [
    { title: 'Net Worth', value: money(me.netWorth), desc: nwPct >= 50 ? `Top ${100 - nwPct}% of your class` : `Ahead of ${nwPct}% of classmates`, avg: `Class avg: ${money(avgNW)}`, ...tier(nwPct) },
    { title: 'Savings Rate', value: `${mySavingsRate}%`, desc: mySavingsRate >= avgSavingsRate ? `Above the class average of ${avgSavingsRate}%` : `Below the class average of ${avgSavingsRate}%`, avg: `Class avg: ${avgSavingsRate}%`, ...tier(mySavingsRate >= avgSavingsRate ? 65 : mySavingsRate >= avgSavingsRate - 5 ? 50 : 30) },
    { title: 'Credit Score', value: me.creditScore, desc: creditPct >= 50 ? `Higher than ${creditPct}% of classmates` : `Ahead of ${creditPct}% of classmates`, avg: `Class avg: ${avgCredit}`, ...tier(creditPct) },
    { title: 'Debt Level', value: me.debt > 0 ? money(me.debt) : 'None', desc: me.debt <= avgDebt ? `Less debt than ${100 - percentile(peers.map(p => p.debt), me.debt)}% of your class` : `More debt than average`, avg: `Class avg: ${money(avgDebt)}`, ...tier(me.debt <= avgDebt ? 65 : 30) },
  ]

  // Life path comparison
  const groups = {}
  peers.forEach(p => {
    const g = PATH_TO_GROUP[p.lifePathId] || 'Straight to Work'
    if (!groups[g]) groups[g] = { total: 0, count: 0 }
    groups[g].total += p.netWorth
    groups[g].count++
  })
  const myGroup = PATH_TO_GROUP[character.life_path_id] || 'Straight to Work'
  const bars = PATH_GROUP_ORDER.map(name => ({
    name,
    avg: groups[name] ? Math.round(groups[name].total / groups[name].count) : 0,
    count: groups[name]?.count || 0,
    isMine: name === myGroup,
  })).filter(b => b.count > 0)

  const barMax = Math.max(...bars.map(b => Math.abs(b.avg)), 1)
  const hasNegative = bars.some(b => b.avg < 0)
  const chartW = 480, chartH = bars.length * 60 + 30
  const PL = 140, PR = 70, barH = 28
  const plotW = chartW - PL - PR
  const valRange = hasNegative ? barMax * 2 : barMax
  const zeroX = hasNegative ? PL + plotW / 2 : PL
  function barX(val) {
    if (hasNegative) return PL + ((val + barMax) / valRange) * plotW
    return PL + (val / valRange) * plotW
  }

  return (
    <>
      <section className="dash-section">
        <h2 className="dash-section-title">Where Do I Stand?</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--gray-400)', marginBottom: '1rem' }}>
          Anonymous comparison with {peers.length} classmates in your section
        </p>
        <div className="class-compare-grid">
          {comparisons.map(c => (
            <div key={c.title} className="class-compare-card" style={{ borderLeftColor: c.color }}>
              <div className="class-compare-title">{c.title}</div>
              <div className="class-compare-value">{c.value}</div>
              <div className="class-compare-tag" style={{ color: c.color, background: c.bg }}>{c.label}</div>
              <div className="class-compare-desc">{c.desc}</div>
              <div className="class-compare-avg">{c.avg}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="dash-section">
        <h2 className="dash-section-title">Life Path Comparison</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--gray-400)', marginBottom: '0.75rem' }}>
          Average net worth by life path — your path is highlighted
        </p>
        <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: 'auto' }}>
          {hasNegative && (
            <line x1={zeroX} x2={zeroX} y1={10} y2={chartH - 20} stroke="var(--gray-300)" strokeWidth="1" strokeDasharray="4 3" />
          )}
          {bars.map((b, i) => {
            const y = 15 + i * 60
            const w = Math.abs(barX(b.avg) - zeroX)
            const bx = b.avg >= 0 ? zeroX : zeroX - w
            const color = b.isMine ? '#16a34a' : PATH_GROUP_COLORS[b.name] || '#9ca3af'
            return (
              <g key={b.name}>
                <text x={PL - 8} y={y + barH / 2 + 4} textAnchor="end" fontSize="12" fill={b.isMine ? '#16a34a' : 'var(--gray-700)'} fontWeight={b.isMine ? '700' : '500'}>
                  {b.name}
                </text>
                <rect x={bx} y={y} width={Math.max(w, 2)} height={barH} rx="4" fill={color} opacity={b.isMine ? 1 : 0.6} />
                {b.isMine && (
                  <rect x={bx - 1} y={y - 1} width={Math.max(w, 2) + 2} height={barH + 2} rx="5" fill="none" stroke="#16a34a" strokeWidth="2" />
                )}
                <text x={bx + Math.max(w, 2) + 6} y={y + barH / 2 + 4} fontSize="11" fill="var(--gray-600)" fontWeight="600">
                  {money(b.avg)}
                </text>
                <text x={PL - 8} y={y + barH / 2 + 18} textAnchor="end" fontSize="9" fill="var(--gray-400)">
                  {b.count} student{b.count !== 1 ? 's' : ''}
                </text>
              </g>
            )
          })}
        </svg>
        {me && (
          <div className="path-compare-note">
            <span style={{ fontWeight: 600 }}>Your net worth: {money(me.netWorth)}</span>
            {groups[myGroup] && (
              <span style={{ color: 'var(--gray-500)' }}>
                {' '}vs path avg: {money(Math.round(groups[myGroup].total / groups[myGroup].count))}
                {me.netWorth >= Math.round(groups[myGroup].total / groups[myGroup].count) ? ' 🟢' : ' 🔴'}
              </span>
            )}
          </div>
        )}
        <p className="path-compare-disclaimer">
          Results vary based on individual decisions — your choices matter more than your path!
        </p>
      </section>
    </>
  )
}

// ─── Main Dashboard ────────────────────────────────────

export default function Dashboard() {
  const { session, loading: authLoading, signOut } = useAuth()
  const [tab, setTab] = useState('dashboard')
  const [character, setCharacter] = useState(null)
  const [sectionId, setSectionId] = useState(null)
  const [latest, setLatest] = useState(null)
  const [previous, setPrevious] = useState(null)
  const [history, setHistory] = useState([])
  const [unlockedCategories, setUnlockedCategories] = useState([])
  const [unlockedWeek, setUnlockedWeek] = useState(0)
  const [allBadges, setAllBadges] = useState([])
  const [earnedBadgeIds, setEarnedBadgeIds] = useState({})
  const [allDecisions, setAllDecisions] = useState([])

  const [weekData, setWeekData] = useState(null)
  const [weekOptions, setWeekOptions] = useState([])
  const [decisionMade, setDecisionMade] = useState(false)
  const [lifeEvent, setLifeEvent] = useState(null)
  const [lifeEventOptions, setLifeEventOptions] = useState([])
  const [lifeEventMade, setLifeEventMade] = useState(false)
  const [lifeEventResult, setLifeEventResult] = useState(null)
  const [choosing, setChoosing] = useState(false)

  const [advancing, setAdvancing] = useState(false)
  const [advanceResult, setAdvanceResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // AI state
  const [newsHeadline, setNewsHeadline] = useState(null)
  const [newsExplainer, setNewsExplainer] = useState(null)
  const [aiFeedback, setAiFeedback] = useState(null)
  const [aiFeedbackLoading, setAiFeedbackLoading] = useState(false)

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

      // Load all decisions for journey tab
      const { data: decs } = await supabase
        .from('student_decisions')
        .select('week, decision_type, ai_feedback, decision_option_id, life_event_option_id, decision_options(label, financial_impact), life_event_options(label)')
        .eq('character_id', char.id)
        .order('week', { ascending: false })
      setAllDecisions(decs || [])

      // Check for existing AI feedback on the latest curriculum decision
      const latestCurrDec = (decs || []).find(d => d.decision_type === 'curriculum' && d.ai_feedback)
      if (latestCurrDec) setAiFeedback(latestCurrDec.ai_feedback)

      const [{ data: badges }, { data: earned }] = await Promise.all([
        supabase.from('badges').select('*').order('sort_order'),
        supabase.from('character_badges').select('badge_id, earned_at').eq('character_id', char.id),
      ])
      setAllBadges(badges || [])
      const map = {}
      ;(earned || []).forEach(e => { map[e.badge_id] = e.earned_at })
      setEarnedBadgeIds(map)

      const nextWeek = char.current_week + 1
      const { data: weekRow } = await supabase
        .from('weeks')
        .select('*')
        .eq('week_number', nextWeek)
        .single()

      if (weekRow) {
        const { data: existingDecision } = await supabase
          .from('student_decisions')
          .select('id, ai_feedback')
          .eq('character_id', char.id)
          .eq('week', nextWeek)
          .eq('decision_type', 'curriculum')
          .limit(1)
          .single()

        if (existingDecision) {
          setDecisionMade(true)
          setWeekData(null)
          if (existingDecision.ai_feedback) setAiFeedback(existingDecision.ai_feedback)
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

        // Load news for this week's category
        const category = weekRow.category || 'budgeting'
        const cacheKey = `finsim_news_w${nextWeek}`
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          try {
            const parsed = JSON.parse(cached)
            setNewsHeadline(parsed.headline)
            setNewsExplainer(parsed.explainer)
          } catch {
            localStorage.removeItem(cacheKey)
          }
        }
        if (!cached) {
          callAI(
            `Generate a realistic 2026 financial news headline about the topic "${category}". Also write a one-sentence "Why this matters to you" explanation for a high school student managing their own finances for the first time. Return ONLY valid JSON: {"headline":"...","explainer":"..."}`
          ).then(text => {
            if (!text) throw new Error('empty')
            const parsed = JSON.parse(text)
            setNewsHeadline(parsed.headline)
            setNewsExplainer(parsed.explainer)
            localStorage.setItem(cacheKey, JSON.stringify(parsed))
          }).catch(() => {
            setNewsHeadline(FALLBACK_NEWS[category]?.headline || FALLBACK_NEWS.budgeting.headline)
            setNewsExplainer(FALLBACK_NEWS[category]?.explainer || FALLBACK_NEWS.budgeting.explainer)
          })
        }
      } else {
        setWeekData(null)
        setDecisionMade(true)
        // No week data — show a fallback news card
        const fallbackCats = ['budgeting', 'debt', 'savings', 'investing']
        const pick = fallbackCats[char.current_week % fallbackCats.length]
        setNewsHeadline(FALLBACK_NEWS[pick].headline)
        setNewsExplainer(FALLBACK_NEWS[pick].explainer)
      }

      await triggerRandomLifeEvent(char.id, enrollment.section_id)

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
            .from('life_events').select('*').eq('id', sectionEvent.life_event_id).single()
          setLifeEvent(evt)
          setLifeEventMade(false)
          const { data: eopts } = await supabase
            .from('life_event_options').select('*').eq('life_event_id', sectionEvent.life_event_id).order('sort_order')
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

      const chosenOpt = weekOptions.find(o => o.id === optionId)
      setWeekData(null)

      // Generate AI feedback
      setAiFeedbackLoading(true)
      const feedbackPrompt = `You are a friendly financial advisor for a high school student playing a personal finance simulation game. The student just made a financial decision. Here is their context:

- Decision: "${chosenOpt?.label || 'Unknown'}" — ${chosenOpt?.description || ''}
- Category: ${weekData?.category || 'general'}
- Their current cash: ${money(updated?.cash || 0)}
- Their current debt: ${money(updated?.debt || 0)}
- Their savings: ${money(updated?.savings || 0)}
- Their monthly income: ${money(updated?.monthly_income || 0)}
- Their credit score: ${updated?.credit_score || 650}

Give 2-3 sentences of personalized feedback:
1. Whether this was a smart or risky choice
2. Why it matters given their specific numbers
3. One actionable tip going forward

Be encouraging but honest. Use simple language. No bullet points, just flowing sentences.`

      const feedback = await callAI(feedbackPrompt)
      setAiFeedbackLoading(false)
      if (feedback) {
        setAiFeedback(feedback)
        // Try to store in DB (column may not exist yet)
        supabase.from('student_decisions')
          .update({ ai_feedback: feedback })
          .eq('character_id', character.id)
          .eq('week', character.current_week + 1)
          .eq('decision_type', 'curriculum')
          .then(() => {})
      }

      // Reload decisions for journey tab
      const { data: decs } = await supabase
        .from('student_decisions')
        .select('week, decision_type, ai_feedback, decision_option_id, life_event_option_id, decision_options(label, financial_impact), life_event_options(label)')
        .eq('character_id', character.id)
        .order('week', { ascending: false })
      setAllDecisions(decs || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setChoosing(false)
    }
  }

  async function handleLifeEvent(optionId) {
    setChoosing(true)
    try {
      const opt = lifeEventOptions.find(o => o.id === optionId)
      const updated = await processLifeEvent(character.id, optionId, character.current_week + 1)
      if (updated) setLatest(updated)
      setLifeEventMade(true)
      setLifeEventResult(opt?.label || 'Done')
      setLifeEvent(null)
      setTimeout(() => setLifeEventResult(null), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setChoosing(false)
    }
  }

  async function handleAdvanceWeek() {
    setAdvancing(true)
    setAdvanceResult(null)
    setAiFeedback(null)
    setNewsHeadline(null)
    setNewsExplainer(null)
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

  // ── Loading / Error ──

  if (authLoading || loading) {
    return (
      <div className="dash">
        <header className="dash-header">
          <div className="dash-header-left">
            <div className="dash-avatar skeleton-pulse" style={{ background: 'var(--gray-200)' }} />
            <div>
              <div className="skeleton-pulse" style={{ width: 120, height: 18, borderRadius: 4, background: 'var(--gray-200)', marginBottom: 6 }} />
              <div className="skeleton-pulse" style={{ width: 80, height: 14, borderRadius: 4, background: 'var(--gray-100)' }} />
            </div>
          </div>
        </header>
        <div className="dash-stats">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="stat-card">
              <div className="skeleton-pulse" style={{ width: 70, height: 12, borderRadius: 4, background: 'var(--gray-200)', marginBottom: 8 }} />
              <div className="skeleton-pulse" style={{ width: 90, height: 22, borderRadius: 4, background: 'var(--gray-200)' }} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page-center">
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
          <p className="error-msg">{error}</p>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => { setError(null); setLoading(true); loadDashboard() }}>Try Again</button>
        </div>
      </div>
    )
  }

  if (!character || !latest) return null

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
          <div className="dash-avatar" style={{ backgroundColor: character.background_color }}>{character.emoji}</div>
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

      {/* ── Stat Cards ── */}
      <div className="dash-stats">
        <div className="stat-card">
          <p className="stat-label">Net Worth</p>
          <p className="stat-value">{money(latest.net_worth)}</p>
          {nwDelta !== null && <p className={`stat-delta ${nwDelta >= 0 ? 'positive' : 'negative'}`}>{nwDelta >= 0 ? '↑' : '↓'} {money(Math.abs(nwDelta))}</p>}
        </div>
        <div className="stat-card"><p className="stat-label">Cash on Hand</p><p className="stat-value">{money(latest.cash)}</p></div>
        <div className="stat-card"><p className="stat-label">Monthly Income</p><p className="stat-value">{money(latest.monthly_income)}</p></div>
        <div className="stat-card"><p className="stat-label">Monthly Expenses</p><p className="stat-value">{money(latest.monthly_expenses)}</p></div>
        <div className="stat-card"><p className="stat-label">Total Debt</p><p className="stat-value" style={{ color: Number(latest.debt) > 0 ? '#dc2626' : 'inherit' }}>{Number(latest.debt) > 0 ? money(latest.debt) : 'None'}</p></div>
        <div className="stat-card"><p className="stat-label">Savings Rate</p><p className="stat-value">{pct(savingsRate)}</p></div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="dash-tab-bar">
        {TABS.map(t => (
          <button key={t.id} className={`dash-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} type="button">
            <span className="dash-tab-icon">{t.icon}</span>
            <span className="dash-tab-label">{t.label}</span>
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════ */}
      {/* TAB 1 — DASHBOARD                              */}
      {/* ════════════════════════════════════════════════ */}
      {tab === 'dashboard' && (
        <>
          {lifeEvent && !lifeEventMade && (
            <LifeEventCard event={lifeEvent} options={lifeEventOptions} onChoose={handleLifeEvent} choosing={choosing} />
          )}
          {lifeEventResult && (
            <div className="dash-section" style={{ borderLeft: '4px solid var(--green)', marginBottom: '1rem' }}>
              <p style={{ fontSize: '0.9rem' }}><strong>Life event resolved:</strong> {lifeEventResult}</p>
            </div>
          )}

          <NewsCard headline={newsHeadline} explainer={newsExplainer} />

          {weekData && !decisionMade && lifeEventMade && (
            <DecisionCard week={weekData} options={weekOptions} onChoose={handleDecision} choosing={choosing} />
          )}

          {!weekData && decisionMade && lifeEventMade && character.current_week < 36 && !weekLocked && (
            <section className="dash-section" style={{ textAlign: 'center', padding: '1.25rem' }}>
              <p style={{ fontSize: '0.9rem', color: 'var(--gray-400)' }}>No decisions for this week. You're all caught up!</p>
            </section>
          )}

          <AiFeedbackCard feedback={aiFeedback} loading={aiFeedbackLoading} />

          <section className="dash-section advance-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>
                  {character.current_week >= 36 ? 'Simulation complete!'
                    : weekLocked ? '🔒 Waiting for teacher'
                    : advancing ? 'Advancing to next week...'
                    : pendingActions ? 'Complete your decisions to advance'
                    : 'Ready to advance'}
                </p>
                {weekLocked && character.current_week < 36 && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--gray-400)', marginTop: '0.15rem' }}>Your teacher hasn't unlocked the next week yet.</p>
                )}
                {!weekLocked && pendingActions && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--gray-400)', marginTop: '0.15rem' }}>Make all decisions above before moving on.</p>
                )}
              </div>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '0.6rem 1.5rem' }} onClick={handleAdvanceWeek} disabled={!canAdvance || advancing} type="button">
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

          <section className="dash-section">
            <h2 className="dash-section-title">Net Worth Over Time</h2>
            <NetWorthChart data={history} />
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Monthly Budget Breakdown</h2>
            <BudgetBreakdown latest={latest} />
          </section>
        </>
      )}

      {/* ════════════════════════════════════════════════ */}
      {/* TAB 2 — MY JOURNEY                             */}
      {/* ════════════════════════════════════════════════ */}
      {tab === 'journey' && (
        <>
          <section className="dash-section">
            <h2 className="dash-section-title">Net Worth Over Time</h2>
            <NetWorthChart data={history} large />
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Week-by-Week Overview</h2>
            <JourneyTable history={history} decisions={allDecisions} />
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Pending Consequences</h2>
            <ConsequenceTracker decisions={allDecisions} latest={latest} />
          </section>
        </>
      )}

      {/* ════════════════════════════════════════════════ */}
      {/* TAB 3 — MY FINANCES                            */}
      {/* ════════════════════════════════════════════════ */}
      {tab === 'finances' && (
        <>
          <section className="dash-section">
            <h2 className="dash-section-title">Monthly Budget Breakdown</h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--gray-400)', marginBottom: '0.5rem' }}>Your actual spending vs recommended percentages</p>
            <BudgetBreakdown latest={latest} showRecommended />
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Credit Score</h2>
            <CreditScoreDisplay score={latest.credit_score} showBreakdown history={history} />
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Debt Tracker</h2>
            <DebtTracker latest={latest} />
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Investment Portfolio</h2>
            <InvestmentPortfolio unlocked={unlockedCategories.includes('investing')} savings={Number(latest.savings)} />
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Compound Interest — The Power of Starting Early</h2>
            <CompoundInterestCalc />
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Savings Goals</h2>
            <SavingsGoals savings={Number(latest.savings)} characterId={character.id} />
          </section>

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
                        <div className="grade-bar-track"><div className="grade-bar-fill" style={{ width: `${score}%`, background: g.color }} /></div>
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

          {allBadges.length > 0 && (
            <section className="dash-section" style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1rem' }}>
                <h2 className="dash-section-title" style={{ marginBottom: 0 }}>Achievements</h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--gray-400)', fontWeight: 600 }}>{Object.keys(earnedBadgeIds).length} of {allBadges.length} earned</span>
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
                        <p className="badge-desc">{earned ? badge.description : badge.condition_description}</p>
                        {earned && (
                          <p className="badge-date">{new Date(earned).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                        )}
                      </div>
                    )
                  })}
              </div>
            </section>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════ */}
      {/* TAB 4 — MY CLASS                               */}
      {/* ════════════════════════════════════════════════ */}
      {tab === 'class' && (
        <MyClassTab sectionId={sectionId} character={character} latest={latest} />
      )}
    </div>
  )
}
