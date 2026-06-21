import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { triggerTeacherLifeEvent } from '../lib/simulationEngine'

const NAV = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'roster', label: 'Roster', icon: '👥' },
  { id: 'gradebook', label: 'Gradebook', icon: '📝' },
  { id: 'sim', label: 'Sim Controls', icon: '⚙️' },
  { id: 'display', label: 'Class Display', icon: '📺' },
  { id: 'reports', label: 'Reports', icon: '📈' },
  { id: 'demo', label: 'Student View', icon: '👁️' },
]

const PATH_CATEGORIES = {
  'retail-food': 'Work', trades: 'Work', 'office-admin': 'Work',
  military: 'Work', 'gig-freelance': 'Work', healthcare: 'Work',
  'cc-parttime': 'CC', 'cc-fulltime': 'CC',
  'uni-oncampus': 'Uni', 'uni-offcampus': 'Uni',
}
const PATH_COLORS = { Work: '#3b82f6', CC: '#8b5cf6', Uni: '#f59e0b' }

function money(n) {
  const v = Number(n) || 0
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })
}

function letterGrade(s) {
  if (s >= 90) return 'A'
  if (s >= 80) return 'B'
  if (s >= 70) return 'C'
  if (s >= 60) return 'D'
  return 'F'
}

function gradeColor(s) {
  if (s >= 80) return '#16a34a'
  if (s >= 60) return '#eab308'
  return '#dc2626'
}

function daysSince(d) {
  if (!d) return 999
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
}

function statusBadge(student) {
  const days = daysSince(student.lastActive)
  if (days >= 3 || student.netWorthDecline) return { label: 'At-risk', color: '#dc2626', bg: '#fef2f2' }
  if (student.weeksBehind > 0) return { label: 'Behind', color: '#f59e0b', bg: '#fffbeb' }
  return { label: 'On track', color: '#16a34a', bg: '#f0fdf4' }
}

// ─── Overview ───────────────────────────────────────────

function OverviewPage({ students, onSelectStudent }) {
  const total = students.length
  const avgNW = total ? Math.round(students.reduce((s, st) => s + st.netWorth, 0) / total) : 0
  const avgCredit = total ? Math.round(students.reduce((s, st) => s + st.creditScore, 0) / total) : 0
  const decisionsThisWeek = students.filter(s => s.madeDecisionThisWeek).length
  const atRisk = students.filter(s => statusBadge(s).label === 'At-risk')

  return (
    <div>
      <div className="td-stats">
        <div className="stat-card"><p className="stat-label">Total Students</p><p className="stat-value">{total}</p></div>
        <div className="stat-card"><p className="stat-label">Avg Net Worth</p><p className="stat-value">{money(avgNW)}</p></div>
        <div className="stat-card"><p className="stat-label">Decisions This Week</p><p className="stat-value">{decisionsThisWeek}/{total}</p></div>
        <div className="stat-card"><p className="stat-label">Avg Credit Score</p><p className="stat-value">{avgCredit}</p></div>
      </div>

      {atRisk.length > 0 && (
        <div className="td-alert">
          ⚠️ <strong>{atRisk.length} student{atRisk.length > 1 ? 's' : ''} at risk</strong> — inactive 3+ days or declining net worth.
        </div>
      )}

      <div className="td-table-wrap">
        <table className="td-table">
          <thead>
            <tr>
              <th>Student</th><th>Path</th><th>Net Worth</th>
              <th>Budget</th><th>Debt</th><th>Savings</th><th>Overall</th>
            </tr>
          </thead>
          <tbody>
            {students.map(st => {
              const cat = PATH_CATEGORIES[st.lifePathId] || '—'
              return (
                <tr key={st.id} className="td-row-click" onClick={() => onSelectStudent(st)}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div className="td-mini-avatar" style={{ backgroundColor: st.bgColor }}>{st.emoji}</div>
                      <span>{st.name}</span>
                    </div>
                  </td>
                  <td><span className="td-path-tag" style={{ background: PATH_COLORS[cat] || '#9ca3af' }}>{cat}</span></td>
                  <td>{money(st.netWorth)}</td>
                  <td style={{ color: gradeColor(st.budgetGrade) }}>{letterGrade(st.budgetGrade)}</td>
                  <td style={{ color: gradeColor(st.debtGrade) }}>{letterGrade(st.debtGrade)}</td>
                  <td style={{ color: gradeColor(st.savingsGrade) }}>{letterGrade(st.savingsGrade)}</td>
                  <td style={{ color: gradeColor(st.overallGrade), fontWeight: 700 }}>{letterGrade(st.overallGrade)}</td>
                </tr>
              )
            })}
            {students.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--gray-400)' }}>No students in this section yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Roster ─────────────────────────────────────────────

function RosterPage({ students, sections, currentSectionId, onReload }) {
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('active')
  const [moveModal, setMoveModal] = useState(null)
  const [deactModal, setDeactModal] = useState(null)
  const [removeModal, setRemoveModal] = useState(null)
  const [moveTarget, setMoveTarget] = useState('')
  const [deactReason, setDeactReason] = useState('Medical leave')
  const [processing, setProcessing] = useState(false)

  const active = students.filter(s => s.enrollStatus === 'approved')
  const deactivated = students.filter(s => s.enrollStatus === 'denied')
  const list = (tab === 'active' ? active : deactivated).filter(
    s => s.name.toLowerCase().includes(search.toLowerCase())
  )

  async function doMove() {
    if (!moveModal || !moveTarget) return
    setProcessing(true)
    await supabase.from('enrollments').update({ section_id: moveTarget }).eq('id', moveModal.enrollmentId)
    setMoveModal(null)
    setProcessing(false)
    onReload()
  }
  async function doDeactivate() {
    if (!deactModal) return
    setProcessing(true)
    await supabase.from('enrollments').update({ status: 'denied', deactivation_reason: deactReason }).eq('id', deactModal.enrollmentId)
    setDeactModal(null)
    setProcessing(false)
    onReload()
  }
  async function doReactivate(st) {
    await supabase.from('enrollments').update({ status: 'approved', deactivation_reason: null }).eq('id', st.enrollmentId)
    onReload()
  }
  async function doRemove() {
    if (!removeModal) return
    setProcessing(true)
    await supabase.from('enrollments').delete().eq('id', removeModal.enrollmentId)
    setRemoveModal(null)
    setProcessing(false)
    onReload()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="role-toggle" style={{ width: 'auto' }}>
          <button className={tab === 'active' ? 'active' : ''} onClick={() => setTab('active')}>Active ({active.length})</button>
          <button className={tab === 'deactivated' ? 'active' : ''} onClick={() => setTab('deactivated')}>Deactivated ({deactivated.length})</button>
        </div>
        <input className="input" placeholder="Search students..." value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
      </div>

      <div className="td-table-wrap">
        <table className="td-table">
          <thead><tr><th>Student</th><th>Path</th><th>Progress</th><th>Last Active</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {list.map(st => {
              const badge = statusBadge(st)
              return (
                <tr key={st.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className="td-mini-avatar" style={{ backgroundColor: st.bgColor }}>{st.emoji}</div>{st.name}</div></td>
                  <td><span className="td-path-tag" style={{ background: PATH_COLORS[PATH_CATEGORIES[st.lifePathId]] || '#9ca3af' }}>{PATH_CATEGORIES[st.lifePathId] || '—'}</span></td>
                  <td>
                    <div className="td-progress-bar"><div className="td-progress-fill" style={{ width: `${(st.currentWeek / 36) * 100}%` }} /></div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>W{st.currentWeek}/36</span>
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--gray-500)' }}>{st.lastActive ? `${daysSince(st.lastActive)}d ago` : '—'}</td>
                  <td><span className="td-status-badge" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span></td>
                  <td>
                    {tab === 'active' ? (
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button className="td-action-btn" onClick={() => { setMoveModal(st); setMoveTarget('') }}>Move</button>
                        <button className="td-action-btn" onClick={() => setDeactModal(st)}>Deactivate</button>
                        <button className="td-action-btn td-action-danger" onClick={() => setRemoveModal(st)}>Remove</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <button className="td-action-btn" onClick={() => doReactivate(st)}>Reactivate</button>
                        <button className="td-action-btn td-action-danger" onClick={() => setRemoveModal(st)}>Remove</button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {list.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--gray-400)' }}>No students found.</td></tr>}
          </tbody>
        </table>
      </div>

      {moveModal && (
        <div className="td-modal-overlay" onClick={() => setMoveModal(null)}>
          <div className="td-modal" onClick={e => e.stopPropagation()}>
            <h3>Move {moveModal.name}</h3>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', margin: '0.5rem 0' }}>Transfer to another section:</p>
            <select className="input" value={moveTarget} onChange={e => setMoveTarget(e.target.value)}>
              <option value="">Select section...</option>
              {sections.filter(s => s.id !== currentSectionId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <div className="td-modal-actions">
              <button className="btn btn-secondary" onClick={() => setMoveModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doMove} disabled={!moveTarget || processing}>{processing ? 'Moving...' : 'Move Student'}</button>
            </div>
          </div>
        </div>
      )}

      {deactModal && (
        <div className="td-modal-overlay" onClick={() => setDeactModal(null)}>
          <div className="td-modal" onClick={e => e.stopPropagation()}>
            <h3>Deactivate {deactModal.name}</h3>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', margin: '0.5rem 0' }}>Student data will be preserved. Select a reason:</p>
            <select className="input" value={deactReason} onChange={e => setDeactReason(e.target.value)}>
              {['Medical leave', 'Extended absence', 'Suspension', 'Schedule conflict', 'Other'].map(r => <option key={r}>{r}</option>)}
            </select>
            <div className="td-modal-actions">
              <button className="btn btn-secondary" onClick={() => setDeactModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={doDeactivate} disabled={processing}>{processing ? 'Saving...' : 'Deactivate'}</button>
            </div>
          </div>
        </div>
      )}

      {removeModal && (
        <div className="td-modal-overlay" onClick={() => setRemoveModal(null)}>
          <div className="td-modal" onClick={e => e.stopPropagation()}>
            <h3 style={{ color: '#dc2626' }}>Remove {removeModal.name}?</h3>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', margin: '0.5rem 0' }}>This will permanently delete the student's enrollment, character, and all simulation data. This cannot be undone.</p>
            <div className="td-modal-actions">
              <button className="btn btn-secondary" onClick={() => setRemoveModal(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ background: '#dc2626' }} onClick={doRemove} disabled={processing}>{processing ? 'Removing...' : 'Permanently Remove'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Gradebook ──────────────────────────────────────────

function GradebookPage({ students, sectionId, onReload }) {
  const [weights, setWeights] = useState({ sim: 40, participation: 30, reflection: 20, presentation: 10 })
  const [manualGrades, setManualGrades] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(`finsim_weights_${sectionId}`)
    if (stored) setWeights(JSON.parse(stored))
  }, [sectionId])

  const weightTotal = weights.sim + weights.participation + weights.reflection + weights.presentation

  function updateManual(studentId, field, value) {
    setManualGrades(prev => ({
      ...prev,
      [studentId]: { ...prev[studentId], [field]: Number(value) || 0 },
    }))
  }

  function calcOverall(st) {
    const manual = manualGrades[st.id] || {}
    const reflection = manual.reflection ?? 0
    const presentation = manual.presentation ?? 0
    return Math.round(
      (st.simScore * weights.sim + st.participationScore * weights.participation +
        reflection * weights.reflection + presentation * weights.presentation) / 100
    )
  }

  function saveWeights() {
    localStorage.setItem(`finsim_weights_${sectionId}`, JSON.stringify(weights))
    setSaving(true)
    setTimeout(() => setSaving(false), 1000)
  }

  function exportCSV() {
    const header = 'Student,Sim Score,Participation,Reflection,Presentation,Overall'
    const rows = students.map(st => {
      const m = manualGrades[st.id] || {}
      return `"${st.name}",${st.simScore},${st.participationScore},${m.reflection || 0},${m.presentation || 0},${calcOverall(st)}`
    })
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'gradebook.csv'
    a.click()
  }

  return (
    <div>
      <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: '0.85rem', marginBottom: '1rem' }} onClick={exportCSV}>Export CSV</button>

      <div className="td-table-wrap">
        <table className="td-table">
          <thead><tr><th>Student</th><th>Sim ({weights.sim}%)</th><th>Participation ({weights.participation}%)</th><th>Reflection ({weights.reflection}%)</th><th>Presentation ({weights.presentation}%)</th><th>Overall</th></tr></thead>
          <tbody>
            {students.filter(s => s.enrollStatus === 'approved').map(st => {
              const m = manualGrades[st.id] || {}
              const ov = calcOverall(st)
              return (
                <tr key={st.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className="td-mini-avatar" style={{ backgroundColor: st.bgColor }}>{st.emoji}</div>{st.name}</div></td>
                  <td style={{ color: gradeColor(st.simScore) }}>{st.simScore}</td>
                  <td style={{ color: gradeColor(st.participationScore) }}>{st.participationScore}</td>
                  <td><input className="td-grade-input" type="number" min="0" max="100" value={m.reflection ?? ''} onChange={e => updateManual(st.id, 'reflection', e.target.value)} placeholder="—" /></td>
                  <td><input className="td-grade-input" type="number" min="0" max="100" value={m.presentation ?? ''} onChange={e => updateManual(st.id, 'presentation', e.target.value)} placeholder="—" /></td>
                  <td style={{ fontWeight: 700, color: gradeColor(ov) }}>{letterGrade(ov)} ({ov})</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="td-weights-panel">
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.75rem' }}>Grade Weights</h3>
        <div className="td-weights-grid">
          {[
            ['sim', 'Sim Performance'], ['participation', 'Weekly Participation'],
            ['reflection', 'Written Reflections'], ['presentation', 'Presentations'],
          ].map(([key, label]) => (
            <div key={key} className="td-weight-item">
              <label>{label}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <input className="td-grade-input" type="number" min="0" max="100" value={weights[key]} onChange={e => setWeights(w => ({ ...w, [key]: Number(e.target.value) || 0 }))} />
                <span style={{ color: 'var(--gray-400)', fontSize: '0.85rem' }}>%</span>
              </div>
            </div>
          ))}
        </div>
        {weightTotal !== 100 && <p style={{ color: '#dc2626', fontSize: '0.85rem', marginTop: '0.5rem' }}>Weights must total 100% (currently {weightTotal}%)</p>}
        <button className="btn btn-primary" style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: '0.85rem', marginTop: '0.5rem' }} onClick={saveWeights} disabled={weightTotal !== 100}>
          {saving ? 'Saved!' : 'Save Weights'}
        </button>
      </div>
    </div>
  )
}

// ─── Sim Controls ───────────────────────────────────────

const FEATURES = [
  { id: 'banking', label: 'Banking & Cash Flow' },
  { id: 'budget_tracker', label: 'Budget Tracker' },
  { id: 'tax_sim', label: 'Tax Simulator' },
  { id: 'credit_tracker', label: 'Credit Score Tracker' },
  { id: 'debt_manager', label: 'Debt Manager' },
  { id: 'investing', label: 'Investment Portfolio' },
  { id: 'insurance', label: 'Insurance Module' },
]

function SimControlsPage({ sections, allEvents, recentTriggers, onUpdateWeek, onReloadTriggers }) {
  const [selectedEvent, setSelectedEvent] = useState('')
  const [selectedSection, setSelectedSection] = useState('')
  const [triggerWeek, setTriggerWeek] = useState('')
  const [pushing, setPushing] = useState(false)
  const [pushMsg, setPushMsg] = useState(null)
  const [featureState, setFeatureState] = useState({})

  useEffect(() => {
    const state = {}
    sections.forEach(s => {
      state[s.id] = s.unlocked_categories || []
    })
    setFeatureState(state)
  }, [sections])

  async function handlePushEvent() {
    if (!selectedEvent || !selectedSection || !triggerWeek) return
    setPushing(true)
    setPushMsg(null)
    try {
      const ids = selectedSection === 'all' ? sections.map(s => s.id) : [selectedSection]
      for (const id of ids) await triggerTeacherLifeEvent(id, selectedEvent, Number(triggerWeek))
      const name = allEvents.find(e => e.id === selectedEvent)?.title || 'Event'
      setPushMsg(`"${name}" pushed to ${ids.length} section${ids.length > 1 ? 's' : ''} for week ${triggerWeek}`)
      onReloadTriggers()
      setSelectedEvent('')
      setTriggerWeek('')
    } catch (err) { setPushMsg('Error: ' + err.message) }
    finally { setPushing(false) }
  }

  async function toggleFeature(sectionId, featureId) {
    const current = featureState[sectionId] || []
    const next = current.includes(featureId) ? current.filter(f => f !== featureId) : [...current, featureId]
    setFeatureState(prev => ({ ...prev, [sectionId]: next }))
    await supabase.from('sections').update({ unlocked_categories: next }).eq('id', sectionId)
  }

  return (
    <div>
      {sections.map(sec => (
        <div key={sec.id} className="td-card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>{sec.name}</h3>

          <div className="week-control" style={{ marginBottom: '1rem' }}>
            <div className="week-control-label">
              <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>Week Unlock</span>
              <span className="dash-week-badge" style={{ fontSize: '0.85rem' }}>Week {sec.unlocked_week} of 36</span>
            </div>
            <div className="week-control-bar"><div className="week-control-fill" style={{ width: `${(sec.unlocked_week / 36) * 100}%` }} /></div>
            <div className="week-control-actions">
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => onUpdateWeek(sec.id, sec.unlocked_week - 1)} disabled={sec.unlocked_week <= 0}>- 1 Week</button>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => onUpdateWeek(sec.id, sec.unlocked_week + 1)} disabled={sec.unlocked_week >= 36}>+ 1 Week</button>
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => onUpdateWeek(sec.id, 36)} disabled={sec.unlocked_week >= 36}>Unlock All</button>
            </div>
          </div>

          <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>Feature Unlocks</p>
          <div className="td-feature-grid">
            {FEATURES.map(f => {
              const on = (featureState[sec.id] || []).includes(f.id)
              return (
                <div key={f.id} className="td-feature-row">
                  <span style={{ fontSize: '0.85rem' }}>{f.label}</span>
                  <button className={`td-toggle ${on ? 'on' : ''}`} onClick={() => toggleFeature(sec.id, f.id)} type="button">
                    <div className="td-toggle-thumb" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div className="td-card">
        <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.75rem' }}>⚡ Trigger Life Event</h3>
        <div className="event-trigger-form">
          <div className="event-trigger-row">
            <label className="event-trigger-label">Event</label>
            <select className="input" value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)}>
              <option value="">Select...</option>
              {allEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.is_positive ? '🟢' : '🔴'} {ev.title}</option>)}
            </select>
          </div>
          <div className="event-trigger-row">
            <label className="event-trigger-label">Section</label>
            <select className="input" value={selectedSection} onChange={e => setSelectedSection(e.target.value)}>
              <option value="">Select...</option><option value="all">All sections</option>
              {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="event-trigger-row">
            <label className="event-trigger-label">Week</label>
            <input className="input" type="number" min="1" max="36" placeholder="#" value={triggerWeek} onChange={e => setTriggerWeek(e.target.value)} style={{ maxWidth: 100 }} />
          </div>
          <button className="btn btn-primary" style={{ width: 'auto', padding: '0.5rem 1.25rem', alignSelf: 'flex-start' }} onClick={handlePushEvent} disabled={pushing || !selectedEvent || !selectedSection || !triggerWeek}>{pushing ? 'Pushing...' : 'Push to Students'}</button>
        </div>
        {pushMsg && <div className={pushMsg.startsWith('Error') ? 'error-msg' : 'success-msg'} style={{ marginTop: '0.75rem' }}>{pushMsg}</div>}
        {recentTriggers.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--gray-400)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.4rem' }}>Recent</p>
            {recentTriggers.map(t => {
              const secName = sections.find(s => s.id === t.section_id)?.name || ''
              return <div key={t.id} style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginBottom: '0.2rem' }}><strong>{t.life_events?.title}</strong> → {secName} (W{t.week})</div>
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Class Display ──────────────────────────────────────

function ClassDisplayPage({ students, onReload }) {
  const [shareModal, setShareModal] = useState(null)

  async function toggleShare(st, anonymous) {
    await supabase.from('enrollments').update({ dashboard_shared: true }).eq('id', st.enrollmentId)
    setShareModal(null)
    onReload()
  }

  async function stopSharing(st) {
    await supabase.from('enrollments').update({ dashboard_shared: false }).eq('id', st.enrollmentId)
    onReload()
  }

  return (
    <div>
      <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', marginBottom: '1rem' }}>Share individual student dashboards for class discussion or presentation.</p>
      <div className="td-table-wrap">
        <table className="td-table">
          <thead><tr><th>Student</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {students.filter(s => s.enrollStatus === 'approved').map(st => (
              <tr key={st.id}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className="td-mini-avatar" style={{ backgroundColor: st.bgColor }}>{st.emoji}</div>{st.name}</div></td>
                <td>{st.dashboardShared ? <span className="td-status-badge" style={{ color: '#16a34a', background: '#f0fdf4' }}>Sharing</span> : <span style={{ color: 'var(--gray-400)', fontSize: '0.85rem' }}>Not sharing</span>}</td>
                <td>
                  {st.dashboardShared ? (
                    <button className="td-action-btn" onClick={() => stopSharing(st)}>Stop Sharing</button>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button className="td-action-btn" onClick={() => setShareModal({ student: st, type: 'named' })}>Named</button>
                      <button className="td-action-btn" onClick={() => setShareModal({ student: st, type: 'anon' })}>Anonymous</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {shareModal && (
        <div className="td-modal-overlay" onClick={() => setShareModal(null)}>
          <div className="td-modal" onClick={e => e.stopPropagation()}>
            <h3>Share Dashboard — {shareModal.type === 'named' ? 'Named' : 'Anonymous'}</h3>
            <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', margin: '0.75rem 0' }}>
              {shareModal.type === 'named'
                ? `"${shareModal.student.name}"'s dashboard will be visible with their name and avatar.`
                : `"${shareModal.student.name}"'s dashboard will be shown anonymously as "Student".`}
            </p>
            <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)' }}>Visible data: net worth, credit score, budget breakdown, and financial grades.</p>
            <div className="td-modal-actions">
              <button className="btn btn-secondary" onClick={() => setShareModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => toggleShare(shareModal.student, shareModal.type === 'anon')}>Start Sharing</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Reports ────────────────────────────────────────────

function ReportsPage({ students, sectionName }) {
  function exportProgressCSV() {
    const header = 'Student,Week,Net Worth,Credit Score,Cash,Debt,Status'
    const rows = students.map(st => {
      const b = statusBadge(st)
      return `"${st.name}",${st.currentWeek},${st.netWorth},${st.creditScore},${st.cash},${st.debt},"${b.label}"`
    })
    const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${sectionName || 'class'}_progress.csv`
    a.click()
  }

  const reports = [
    { title: 'Class Progress Report', desc: 'Student standings, weeks completed, and net worth.', action: 'Export CSV', onClick: exportProgressCSV },
    { title: 'Gradebook Export', desc: 'Export all grades for your LMS.', action: 'Export CSV', onClick: exportProgressCSV },
    { title: 'Net Worth Over Time', desc: 'Chart comparing all students\' net worth trajectories.', action: 'View Chart', onClick: () => {} },
    { title: 'At-Risk Students', desc: 'Students with declining finances or inactivity.', action: 'View List', onClick: () => {} },
    { title: 'Path Comparison', desc: 'Compare outcomes by life path choice.', action: 'View Report', onClick: () => {} },
    { title: 'Decision History Log', desc: 'All student decisions across all weeks.', action: 'View Log', onClick: () => {} },
  ]

  return (
    <div className="td-report-grid">
      {reports.map(r => (
        <div key={r.title} className="td-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '0.25rem' }}>{r.title}</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--gray-500)', lineHeight: 1.5 }}>{r.desc}</p>
          </div>
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 1rem', fontSize: '0.85rem', marginTop: '0.75rem', alignSelf: 'flex-start' }} onClick={r.onClick}>{r.action}</button>
        </div>
      ))}
    </div>
  )
}

// ─── Student View (Demo) ────────────────────────────────

const DEMO_LIFE_PATHS = [
  {
    id: 'retail-food', emoji: '🛒', name: 'Retail / Food Service',
    category: 'straight-to-work',
    shortDesc: 'Cashier, server, barista, stock clerk',
    fullDesc: 'Start working right away in retail, restaurants, or customer service. The pay is modest, but you\'re gaining real-world experience and building your resume from day one.',
    jobs: 'Cashier, server, barista, stock clerk, host',
    incomeRange: [1800, 2200], debtRange: [0, 0], savingsRange: [200, 800],
  },
  {
    id: 'trades', emoji: '🔧', name: 'Trades Apprentice',
    category: 'straight-to-work',
    shortDesc: 'Plumber, electrician, welder, HVAC',
    fullDesc: 'Skip the classroom and learn a skilled trade from experienced professionals. The pay starts solid and grows fast as you gain certifications.',
    jobs: 'Plumber, electrician, welder, HVAC technician',
    incomeRange: [2400, 2900], debtRange: [0, 0], savingsRange: [300, 1000],
  },
  {
    id: 'office-admin', emoji: '💼', name: 'Office / Admin',
    category: 'straight-to-work',
    shortDesc: 'Receptionist, data entry, office assistant',
    fullDesc: 'Land a steady office job with predictable hours and basic benefits. Not the most exciting, but a reliable foundation.',
    jobs: 'Receptionist, data entry clerk, office assistant',
    incomeRange: [2200, 2600], debtRange: [0, 0], savingsRange: [300, 900],
  },
  {
    id: 'military', emoji: '🪖', name: 'Military Enlistment',
    category: 'straight-to-work',
    shortDesc: 'Active duty with housing and benefits',
    fullDesc: 'Enlist in the armed forces for structured life, steady pay, housing allowance, and veterans\' benefits. Discipline required.',
    jobs: 'Active duty — various roles and specialties',
    incomeRange: [2100, 2500], debtRange: [0, 0], savingsRange: [500, 1200],
  },
  {
    id: 'gig-freelance', emoji: '📱', name: 'Gig / Freelance',
    category: 'straight-to-work',
    shortDesc: 'Rideshare, delivery, tutoring, social media',
    fullDesc: 'Be your own boss in the gig economy. Your schedule is flexible and the ceiling is high, but income swings week to week.',
    jobs: 'Rideshare driver, delivery, tutor, social media freelancer',
    incomeRange: [1400, 2800], debtRange: [0, 0], savingsRange: [100, 600],
  },
  {
    id: 'healthcare', emoji: '🏥', name: 'Healthcare Support',
    category: 'straight-to-work',
    shortDesc: 'CNA, medical assistant, home health aide',
    fullDesc: 'Get certified and jump into healthcare. The work is demanding but meaningful, and the field is always hiring.',
    jobs: 'CNA, medical assistant, home health aide, phlebotomist',
    incomeRange: [2300, 2700], debtRange: [0, 0], savingsRange: [300, 900],
  },
  {
    id: 'cc-parttime', emoji: '📚', name: 'CC + Part-Time Work',
    category: 'community-college',
    shortDesc: 'Classes + part-time job, lower income',
    fullDesc: 'Attend community college while working part-time. You\'re balancing classes, studying, and a job — but keeping debt low compared to a four-year school.',
    jobs: 'Part-time retail, campus job, tutoring',
    incomeRange: [1000, 1400], debtRange: [3000, 6000], savingsRange: [100, 500],
  },
  {
    id: 'cc-fulltime', emoji: '⚡', name: 'CC + Full-Time Work',
    category: 'community-college',
    shortDesc: 'Classes + full-time job, higher income',
    fullDesc: 'Tackle community college while working full-time. It\'s exhausting but you\'re earning more and still building toward a degree.',
    jobs: 'Full-time retail, office work, warehouse',
    incomeRange: [1800, 2200], debtRange: [3000, 6000], savingsRange: [200, 600],
  },
  {
    id: 'uni-oncampus', emoji: '🎓', name: 'University On Campus',
    category: 'university',
    shortDesc: 'Dorms, meal plan, campus life',
    fullDesc: 'Live on campus at a four-year university. Between tuition, room and board, and a meal plan, costs are high — but so are the connections and opportunities.',
    jobs: 'Work-study, campus dining, RA, library assistant',
    incomeRange: [800, 1200], debtRange: [8000, 14000], savingsRange: [50, 300],
  },
  {
    id: 'uni-offcampus', emoji: '🏠', name: 'University Off Campus',
    category: 'university',
    shortDesc: 'Apartment, more freedom, more bills',
    fullDesc: 'Attend university but live off campus. You traded the dorm for an apartment — more independence, but also rent, groceries, and utility bills.',
    jobs: 'Part-time work, internships, freelance',
    incomeRange: [800, 1200], debtRange: [8000, 14000], savingsRange: [50, 400],
  },
]

const DEMO_PATH_CATEGORIES = [
  { id: 'straight-to-work', name: 'Straight to Work' },
  { id: 'community-college', name: 'Community College' },
  { id: 'university', name: 'University' },
]

const DEMO_LOCATIONS = [
  { id: 'big-city', name: 'Big City', description: 'Lots of opportunities but high rent and expenses.', rentLabel: 'Rent', rentRange: [1100, 1400] },
  { id: 'mid-size-city', name: 'Mid-Size City', description: 'A good balance of jobs, amenities, and affordability.', rentLabel: 'Rent', rentRange: [800, 1000] },
  { id: 'small-town', name: 'Small Town', description: 'Lower costs but fewer job options. Your money stretches further.', rentLabel: 'Rent', rentRange: [550, 750] },
  { id: 'living-at-home', name: 'Living at Home', description: 'Stay with family and contribute to household expenses while you save.', rentLabel: 'Family contribution', rentRange: [200, 350], onlyCategories: ['straight-to-work', 'community-college'] },
]

const DEMO_SKIN_TONES = [
  { label: 'Default', modifier: '' },
  { label: 'Light', modifier: '\u{1F3FB}' },
  { label: 'Medium-light', modifier: '\u{1F3FC}' },
  { label: 'Medium', modifier: '\u{1F3FD}' },
  { label: 'Medium-dark', modifier: '\u{1F3FE}' },
  { label: 'Dark', modifier: '\u{1F3FF}' },
]

const DEMO_CHAR_STYLES = [
  { base: '🧑', label: 'Person' }, { base: '👩', label: 'Woman' }, { base: '👨', label: 'Man' },
  { base: '👱‍♀️', label: 'Blonde woman' }, { base: '👱', label: 'Blonde man' }, { base: '🧔', label: 'Beard' },
  { base: '👩‍🦱', label: 'Curly woman' }, { base: '👨‍🦱', label: 'Curly man' },
  { base: '👩‍🦰', label: 'Red hair woman' }, { base: '👨‍🦰', label: 'Red hair man' },
  { base: '👩‍🦳', label: 'White hair woman' }, { base: '👨‍🦳', label: 'White hair man' }, { base: '🧑‍🦲', label: 'Bald' },
]

const DEMO_BG_COLORS = [
  '#E6F1FB', '#E1F5EE', '#EEEDFE', '#FAEEDA',
  '#FBEAF0', '#F1EFE8', '#FAECE7', '#EAF3DE',
  '#FCEBEB', '#D3D1C7', '#B5D4F4', '#9FE1CB',
  '#FAC775', '#F4C0D1', '#CECBF6', '#C0DD97',
]

const DEMO_PERSONALITY_QS = [
  { question: 'How did you handle money in high school?', options: ['Saved almost everything', 'Spent it as fast as I earned it', 'Never really had any', 'Gave a lot of it away'] },
  { question: 'When something goes wrong financially, you...', options: ['Make a plan immediately', 'Ask family for help', 'Stress and avoid it', 'Figure it out as I go'] },
  { question: 'Your biggest financial goal right now is...', options: ['Move out on my own', 'Buy a car', 'Save for something big', 'Just survive month to month'] },
]

const DEMO_PATH_STORIES = {
  'retail-food': 'Right after graduation, you jumped into the workforce, landing a job in food service and retail.',
  'trades': 'You skipped college and started a trades apprenticeship, learning hands-on skills that pay well.',
  'office-admin': 'You found a steady office job right out of high school — not glamorous, but reliable.',
  'military': 'You enlisted in the military after graduation, trading freedom for structure, benefits, and steady pay.',
  'gig-freelance': "You're hustling in the gig economy — rideshare, delivery, freelance work. Flexible but unpredictable.",
  'healthcare': 'You got certified and started working in healthcare. The work is tough but always in demand.',
  'cc-parttime': "You're in community college part-time while working. Balancing school and a job is hard, but you're keeping debt low.",
  'cc-fulltime': "You're tackling community college while working full-time. Exhausting, but you're building toward something.",
  'uni-oncampus': "You're living on campus at a four-year university. The costs are steep, but the experience is worth it.",
  'uni-offcampus': "You're at university but living off campus to save money. More independence, more bills.",
}

const DEMO_LOC_STORIES = {
  'big-city': 'Living in a big city means high rent but endless opportunities.',
  'mid-size-city': 'Your mid-size city has solid job options without the sky-high costs of a major metro.',
  'small-town': "Small-town living keeps costs down, though there's less to spend money on anyway.",
  'living-at-home': 'Staying with family saves a fortune on rent while you build up your savings.',
}

const DEMO_STEP_TITLES = ['', 'Character Name', 'Build Your Avatar', 'Choose Your Path', 'Pick Your Location', 'Money Personality', 'Your Starting Snapshot']

function demoApplySkinTone(emoji, modifier) {
  if (!modifier) return emoji
  const chars = [...emoji]
  return chars[0] + modifier + chars.slice(1).join('')
}

function demoRand(min, max) {
  return Math.round(min + Math.random() * (max - min))
}

function demoGenFinancials(path, location) {
  const monthlyIncome = demoRand(path.incomeRange[0], path.incomeRange[1])
  const startingSavings = demoRand(path.savingsRange[0], path.savingsRange[1])
  const startingDebt = demoRand(path.debtRange[0], path.debtRange[1])
  const monthlyRent = demoRand(location.rentRange[0], location.rentRange[1])
  const otherExpenses = demoRand(400, 600)
  return { monthlyIncome, startingSavings, startingDebt, monthlyRent, monthlyExpenses: monthlyRent + otherExpenses, netWorth: startingSavings - startingDebt, creditScore: 650 }
}

function DemoPage() {
  const [phase, setPhase] = useState('pick')
  const [step, setStep] = useState(1)
  const [charName, setCharName] = useState('')
  const [skinTone, setSkinTone] = useState('')
  const [styleBase, setStyleBase] = useState('🧑')
  const [bgColor, setBgColor] = useState('#E6F1FB')
  const [demoPath, setDemoPath] = useState(null)
  const [demoLocation, setDemoLocation] = useState(null)
  const [personality, setPersonality] = useState([null, null, null])
  const [financials, setFinancials] = useState(null)
  const [backstory, setBackstory] = useState('')
  const [demoWeek, setDemoWeek] = useState(0)

  function resetAll() {
    setPhase('pick')
    setStep(1)
    setCharName('')
    setSkinTone('')
    setStyleBase('🧑')
    setBgColor('#E6F1FB')
    setDemoPath(null)
    setDemoLocation(null)
    setPersonality([null, null, null])
    setFinancials(null)
    setBackstory('')
    setDemoWeek(0)
  }

  const emoji = demoApplySkinTone(styleBase, skinTone)

  function canAdvanceStep() {
    switch (step) {
      case 1: return charName.trim().length >= 2
      case 2: return true
      case 3: return demoPath !== null
      case 4: return demoLocation !== null
      case 5: return personality.every(a => a !== null)
      default: return true
    }
  }

  function handleStepNext() {
    if (step === 5) {
      const fin = demoGenFinancials(demoPath, demoLocation)
      setFinancials(fin)
      const trait = { 'Saved almost everything': "You've always been a natural saver", 'Spent it as fast as I earned it': "You've never been great at holding onto money", 'Never really had any': 'Money was always tight growing up', 'Gave a lot of it away': "You've always been generous, sometimes too generous" }[personality[0]] || "You're still figuring out your relationship with money"
      const goal = { 'Move out on my own': 'getting your own place', 'Buy a car': 'saving up for a car', 'Save for something big': 'saving up for something big', 'Just survive month to month': 'just getting through each month' }[personality[2]] || 'finding your footing'
      setBackstory(`${DEMO_PATH_STORIES[demoPath.id]} ${DEMO_LOC_STORIES[demoLocation.id]} ${trait}, and your biggest goal right now is ${goal}.`)
    }
    setStep(step + 1)
  }

  function handleLaunchSim() {
    setPhase('dashboard')
    setDemoWeek(0)
  }

  function selectPath(path) {
    if (demoPath?.category !== path.category) setDemoLocation(null)
    setDemoPath(path)
  }

  const availableLocations = DEMO_LOCATIONS.filter(
    loc => !loc.onlyCategories || loc.onlyCategories.includes(demoPath?.category)
  )

  // ── Phase: Pick a path (entry screen) ──
  if (phase === 'pick') {
    return (
      <div>
        <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Walk through the full student experience — character creation, financial setup, and the live dashboard. Nothing saves to the database.
        </p>
        <div className="td-demo-paths">
          {DEMO_LIFE_PATHS.map(p => (
            <button key={p.id} className={`option-card ${demoPath?.id === p.id ? 'selected' : ''}`} onClick={() => setDemoPath(p)} type="button">
              <div style={{ fontWeight: 600 }}>{p.emoji} {p.name}</div>
              <div className="option-meta">{money(p.incomeRange[0])}–{money(p.incomeRange[1])}/mo · {p.debtRange[1] > 0 ? money(p.debtRange[0]) + '–' + money(p.debtRange[1]) + ' debt' : 'No debt'}</div>
            </button>
          ))}
        </div>
        <button className="btn btn-primary" style={{ width: 'auto', padding: '0.6rem 1.5rem', marginTop: '1rem' }} onClick={() => { setStep(1); setPhase('wizard') }} disabled={!demoPath}>Launch Demo</button>
      </div>
    )
  }

  // ── Phase: Character creation wizard ──
  if (phase === 'wizard') {
    return (
      <div>
        <div className="td-demo-banner">
          <span>👁️ Demo Mode — Character Creation</span>
          <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.3rem 0.75rem', fontSize: '0.8rem', background: '#7c3aed', color: 'white', border: 'none' }} onClick={resetAll}>Exit Demo</button>
        </div>

        <div style={{ maxWidth: 520, margin: '1rem auto 0' }}>
          <div className="card wizard-card">
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)' }}>Step {step} of 6</p>
              <h2 style={{ fontSize: '1.25rem', margin: '0.25rem 0' }}>{DEMO_STEP_TITLES[step]}</h2>
              <div className="wizard-progress"><div className="wizard-progress-bar" style={{ width: `${(step / 6) * 100}%` }} /></div>
            </div>

            {step === 1 && (
              <div>
                <label className="section-label">What should we call your character?</label>
                <input className="input" type="text" placeholder="Enter a name..." value={charName} onChange={e => setCharName(e.target.value)} maxLength={30} autoFocus />
                {charName.length > 0 && charName.length < 2 && <p style={{ color: 'var(--gray-400)', fontSize: '0.8rem', marginTop: '0.4rem' }}>Name must be at least 2 characters</p>}
              </div>
            )}

            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div className="avatar-preview" style={{ backgroundColor: bgColor }}>{emoji}</div>
                <div>
                  <p className="section-label">Skin tone</p>
                  <div className="emoji-grid">
                    {DEMO_SKIN_TONES.map(tone => (
                      <button key={tone.label} className={`emoji-btn ${skinTone === tone.modifier ? 'selected' : ''}`} onClick={() => setSkinTone(tone.modifier)} title={tone.label} type="button">{demoApplySkinTone('🧑', tone.modifier)}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="section-label">Character style</p>
                  <div className="emoji-grid">
                    {DEMO_CHAR_STYLES.map(style => (
                      <button key={style.label} className={`emoji-btn ${styleBase === style.base ? 'selected' : ''}`} onClick={() => setStyleBase(style.base)} title={style.label} type="button">{demoApplySkinTone(style.base, skinTone)}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="section-label">Background color</p>
                  <div className="color-grid">
                    {DEMO_BG_COLORS.map(color => (
                      <button key={color} className={`color-swatch ${bgColor === color ? 'selected' : ''}`} style={{ backgroundColor: color }} onClick={() => setBgColor(color)} title={color} type="button" />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div>
                {DEMO_PATH_CATEGORIES.map(cat => {
                  const paths = DEMO_LIFE_PATHS.filter(p => p.category === cat.id)
                  return (
                    <div key={cat.id} className="path-group">
                      <p className="path-group-title">{cat.name}</p>
                      <div className="options-grid">
                        {paths.map(path => (
                          <button key={path.id} className={`option-card ${demoPath?.id === path.id ? 'selected' : ''}`} onClick={() => selectPath(path)} type="button">
                            <div style={{ fontWeight: 600 }}>{path.emoji} {path.name}</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginTop: '0.15rem' }}>{path.shortDesc}</div>
                            <div className="option-meta">{money(path.incomeRange[0])}–{money(path.incomeRange[1])}/mo{path.debtRange[1] > 0 ? ` · ${money(path.debtRange[0])}–${money(path.debtRange[1])} debt` : ' · No starting debt'}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {demoPath && (
                  <div className="detail-panel">
                    <p style={{ fontWeight: 600, marginBottom: '0.4rem' }}>{demoPath.emoji} {demoPath.name}</p>
                    <p style={{ marginBottom: '0.4rem' }}>{demoPath.fullDesc}</p>
                    <p style={{ color: 'var(--gray-500)' }}><strong>Job examples:</strong> {demoPath.jobs}</p>
                  </div>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="options-grid">
                {availableLocations.map(loc => (
                  <button key={loc.id} className={`option-card ${demoLocation?.id === loc.id ? 'selected' : ''}`} onClick={() => setDemoLocation(loc)} type="button">
                    <div style={{ fontWeight: 600 }}>{loc.name}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginTop: '0.15rem' }}>{loc.description}</div>
                    <div className="option-meta">{loc.rentLabel}: {money(loc.rentRange[0])}–{money(loc.rentRange[1])}/mo</div>
                  </button>
                ))}
              </div>
            )}

            {step === 5 && (
              <div>
                {DEMO_PERSONALITY_QS.map((q, qi) => (
                  <div key={qi} className="question-group">
                    <p className="question-text">{q.question}</p>
                    <div className="options-grid">
                      {q.options.map(opt => (
                        <button key={opt} className={`option-card ${personality[qi] === opt ? 'selected' : ''}`} onClick={() => { const next = [...personality]; next[qi] = opt; setPersonality(next) }} type="button">{opt}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {step === 6 && financials && (
              <div>
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  <div className="avatar-preview avatar-preview-sm" style={{ backgroundColor: bgColor }}>{emoji}</div>
                  <h3 style={{ fontSize: '1.1rem' }}>{charName}</h3>
                  <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>{demoPath.emoji} {demoPath.name} · {demoLocation.name}</p>
                </div>
                <div style={{ marginBottom: '0.5rem' }}>
                  <div className="summary-row"><span className="summary-label">Monthly Income</span><span className="summary-value">{money(financials.monthlyIncome)}/mo</span></div>
                  <div className="summary-row"><span className="summary-label">{demoLocation.rentLabel}</span><span className="summary-value">{money(financials.monthlyRent)}/mo</span></div>
                  <div className="summary-row"><span className="summary-label">Starting Savings</span><span className="summary-value">{money(financials.startingSavings)}</span></div>
                  <div className="summary-row"><span className="summary-label">Starting Debt</span><span className="summary-value" style={{ color: financials.startingDebt > 0 ? '#dc2626' : 'inherit' }}>{financials.startingDebt > 0 ? money(financials.startingDebt) : 'None'}</span></div>
                  <div className="summary-row"><span className="summary-label">Credit Score</span><span className="summary-value">{financials.creditScore}</span></div>
                </div>
                <div className="backstory"><p>{backstory}</p></div>
              </div>
            )}

            <div className="wizard-nav">
              {step > 1 && <button className="btn btn-secondary" onClick={() => setStep(step - 1)} type="button">Back</button>}
              {step < 6 ? (
                <button className="btn btn-primary" onClick={handleStepNext} disabled={!canAdvanceStep()} type="button">Next</button>
              ) : (
                <button className="btn btn-primary" onClick={handleLaunchSim} type="button">Launch Simulation</button>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Phase: Simulated student dashboard ──
  if (phase === 'dashboard' && financials) {
    const w = demoWeek
    const income = financials.monthlyIncome
    const baseExpenses = financials.monthlyExpenses
    const startDebt = financials.startingDebt
    const startSavings = financials.startingSavings

    const savings = startSavings + w * Math.round(income * 0.08)
    const debt = Math.max(0, startDebt - w * 55)
    const totalExpenses = baseExpenses + (debt > 0 ? Math.max(25, Math.round(debt * 0.02)) : 0)
    const cash = Math.round(income - baseExpenses * 0.65) + Math.round(w * income * 0.03)
    const nw = cash + savings - debt
    const credit = Math.min(850, 650 + w * 3 - (debt > income * 3 ? 10 : 0))
    const savingsRate = Math.max(0, Math.round(((income - totalExpenses) / income) * 100))

    const budgetScore = Math.min(100, Math.max(0, 50 + savingsRate * 2.5))
    const debtScore = debt === 0 ? 95 : Math.max(0, 100 - (debt / income) * 8)
    const savingsScore = Math.min(100, (savings / income) * 25)

    const gradeData = [
      { label: 'Budgeting', score: Math.round(budgetScore) },
      { label: 'Debt Management', score: Math.round(debtScore) },
      { label: 'Savings', score: Math.round(savingsScore) },
    ]

    const historyPts = Array.from({ length: w + 1 }, (_, i) => {
      const s = startSavings + i * Math.round(income * 0.08)
      const d = Math.max(0, startDebt - i * 55)
      const c = Math.round(income - baseExpenses * 0.65) + Math.round(i * income * 0.03)
      return { week: i, net_worth: c + s - d }
    })

    const chartW = 520, chartH = 180, PL = 55, PR = 15, PT = 15, PB = 30
    const pW = chartW - PL - PR, pH = chartH - PT - PB
    const vals = historyPts.map(d => d.net_worth)
    const minV = Math.min(...vals), maxV = Math.max(...vals)
    const range = maxV - minV || 1
    const cx = i => PL + (historyPts.length > 1 ? (i / (historyPts.length - 1)) * pW : pW / 2)
    const cy = v => PT + pH - ((v - minV) / range) * pH
    const chartPoints = historyPts.map((d, i) => `${cx(i)},${cy(d.net_worth)}`).join(' ')
    const yTicks = 4
    const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => minV + (range / yTicks) * i)

    const expItems = [
      { label: 'Rent', amount: Math.round(baseExpenses * 0.5), color: '#3b82f6' },
      { label: 'Food', amount: Math.round(baseExpenses * 0.22), color: '#22c55e' },
      { label: 'Transport', amount: Math.round(baseExpenses * 0.13), color: '#f59e0b' },
      { label: 'Phone / Utilities', amount: Math.round(baseExpenses * 0.08), color: '#8b5cf6' },
      { label: 'Personal', amount: Math.round(baseExpenses * 0.07), color: '#ec4899' },
      { label: 'Savings', amount: Math.max(0, income - totalExpenses), color: '#06b6d4' },
    ]
    const expMax = Math.max(...expItems.map(i => i.amount), 1)

    const creditPct = ((credit - 300) / 550) * 100
    const creditLabel = credit >= 740 ? 'Excellent' : credit >= 670 ? 'Good' : credit >= 580 ? 'Fair' : 'Poor'
    const creditClr = credit >= 740 ? '#16a34a' : credit >= 670 ? '#22c55e' : credit >= 580 ? '#eab308' : '#dc2626'

    return (
      <div>
        <div className="td-demo-banner">
          <span>👁️ Demo Mode — {charName || 'Student'}, {demoPath.emoji} {demoPath.name}, Week {demoWeek}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.3rem 0.75rem', fontSize: '0.8rem' }} onClick={() => { setPhase('pick'); setStep(1); setDemoPath(null); setDemoLocation(null); setFinancials(null) }}>New Character</button>
            <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.3rem 0.75rem', fontSize: '0.8rem', background: '#7c3aed', color: 'white', border: 'none' }} onClick={resetAll}>Exit Demo</button>
          </div>
        </div>

        {/* Top bar */}
        <div className="dash-header" style={{ marginTop: '1rem' }}>
          <div className="dash-header-left">
            <div className="dash-avatar" style={{ backgroundColor: bgColor }}>{emoji}</div>
            <div>
              <h1 className="dash-name">{charName || 'Demo Student'}</h1>
              <p className="dash-subtitle">{demoPath.emoji} {demoPath.name} · {demoLocation.name}</p>
            </div>
          </div>
          <div className="dash-header-right">
            <span className="dash-week-badge">Week {demoWeek} of 36</span>
          </div>
        </div>

        {/* Advance week controls */}
        <section className="dash-section advance-section" style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <p style={{ fontWeight: 600, fontSize: '0.95rem' }}>Simulate advancing weeks</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => setDemoWeek(Math.max(0, demoWeek - 1))} disabled={demoWeek <= 0}>- 1 Week</button>
              <button className="btn btn-primary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => setDemoWeek(Math.min(36, demoWeek + 1))} disabled={demoWeek >= 36}>+ 1 Week</button>
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => setDemoWeek(Math.min(36, demoWeek + 4))} disabled={demoWeek >= 36}>+ 4 Weeks</button>
              <button className="btn btn-secondary" style={{ width: 'auto', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }} onClick={() => setDemoWeek(0)}>Reset</button>
            </div>
          </div>
        </section>

        {/* Stat cards */}
        <div className="dash-stats" style={{ marginTop: '0.75rem' }}>
          <div className="stat-card"><p className="stat-label">Net Worth</p><p className="stat-value">{money(nw)}</p></div>
          <div className="stat-card"><p className="stat-label">Cash on Hand</p><p className="stat-value">{money(cash)}</p></div>
          <div className="stat-card"><p className="stat-label">Monthly Income</p><p className="stat-value">{money(income)}</p></div>
          <div className="stat-card"><p className="stat-label">Monthly Expenses</p><p className="stat-value">{money(totalExpenses)}</p></div>
          <div className="stat-card"><p className="stat-label">Total Debt</p><p className="stat-value" style={{ color: debt > 0 ? '#dc2626' : 'inherit' }}>{debt > 0 ? money(debt) : 'None'}</p></div>
          <div className="stat-card"><p className="stat-label">Savings Rate</p><p className="stat-value">{savingsRate}%</p></div>
        </div>

        {/* Net worth chart */}
        <section className="dash-section">
          <h2 className="dash-section-title">Net Worth Over Time</h2>
          {historyPts.length < 2 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-400)', fontSize: '0.9rem' }}>Chart will appear after Week 1</div>
          ) : (
            <svg viewBox={`0 0 ${chartW} ${chartH}`} style={{ width: '100%', height: 'auto' }}>
              {yLabels.map((v, i) => (
                <g key={i}>
                  <line x1={PL} x2={chartW - PR} y1={cy(v)} y2={cy(v)} stroke="var(--gray-200)" strokeWidth="1" />
                  <text x={PL - 8} y={cy(v) + 4} textAnchor="end" fontSize="10" fill="var(--gray-400)">{money(v)}</text>
                </g>
              ))}
              <polyline fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinejoin="round" points={chartPoints} />
              {historyPts.map((d, i) => <circle key={i} cx={cx(i)} cy={cy(d.net_worth)} r="3.5" fill="var(--green)" />)}
              {historyPts.map((d, i) => (historyPts.length <= 12 || i % Math.ceil(historyPts.length / 12) === 0 || i === historyPts.length - 1) && (
                <text key={`l${i}`} x={cx(i)} y={chartH - 6} textAnchor="middle" fontSize="10" fill="var(--gray-400)">W{d.week}</text>
              ))}
            </svg>
          )}
        </section>

        {/* Budget breakdown */}
        <section className="dash-section">
          <h2 className="dash-section-title">Monthly Budget Breakdown</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {expItems.map(item => (
              <div key={item.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
                  <span style={{ color: 'var(--gray-700)' }}>{item.label}</span>
                  <span style={{ color: 'var(--gray-500)' }}>{money(item.amount)}/mo</span>
                </div>
                <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 4 }}>
                  <div style={{ height: '100%', width: `${(item.amount / expMax) * 100}%`, background: item.color, borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Grades + Credit */}
        <div className="dash-bottom-grid">
          <section className="dash-section">
            <h2 className="dash-section-title">Financial Health</h2>
            <div className="grades-list">
              {gradeData.map(g => {
                const gr = g.score >= 90 ? { letter: 'A', color: '#16a34a' } : g.score >= 80 ? { letter: 'B', color: '#22c55e' } : g.score >= 70 ? { letter: 'C', color: '#eab308' } : g.score >= 60 ? { letter: 'D', color: '#f97316' } : { letter: 'F', color: '#dc2626' }
                return (
                  <div key={g.label} className="grade-row">
                    <span className="grade-label">{g.label}</span>
                    <div className="grade-bar-track"><div className="grade-bar-fill" style={{ width: `${g.score}%`, background: gr.color }} /></div>
                    <span className="grade-letter" style={{ color: gr.color }}>{gr.letter}</span>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="dash-section">
            <h2 className="dash-section-title">Credit Score</h2>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', fontWeight: 700, color: creditClr, lineHeight: 1.2 }}>{credit}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--gray-400)', marginBottom: '0.75rem' }}>{creditLabel}</div>
              <div style={{ height: 10, borderRadius: 5, background: 'linear-gradient(to right, #dc2626, #f97316, #eab308, #22c55e, #16a34a)', position: 'relative' }}>
                <div style={{ position: 'absolute', top: -3, left: `${creditPct}%`, transform: 'translateX(-50%)', width: 16, height: 16, borderRadius: '50%', border: '3px solid white', background: creditClr, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--gray-400)', marginTop: '0.3rem' }}><span>300</span><span>850</span></div>
            </div>
          </section>
        </div>

        <p style={{ color: 'var(--gray-400)', fontSize: '0.85rem', textAlign: 'center', marginTop: '1rem' }}>This is a simulated preview. No data is saved to the database.</p>
      </div>
    )
  }

  return null
}

// ─── Main Teacher Dashboard ─────────────────────────────

export default function TeacherDashboard() {
  const { session, profile, loading: authLoading, signOut } = useAuth()
  const [page, setPage] = useState('overview')
  const [sections, setSections] = useState([])
  const [activeSectionId, setActiveSectionId] = useState(null)
  const [students, setStudents] = useState([])
  const [allEvents, setAllEvents] = useState([])
  const [recentTriggers, setRecentTriggers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const activeSection = sections.find(s => s.id === activeSectionId)

  const loadSections = useCallback(async () => {
    const { data, error: sErr } = await supabase
      .from('sections')
      .select('id, name, class_code, unlocked_week, unlocked_categories, is_active, created_at')
      .order('created_at', { ascending: false })
    if (sErr) throw new Error(sErr.message)

    const withCounts = await Promise.all(
      (data || []).map(async (sec) => {
        const { count } = await supabase
          .from('enrollments')
          .select('id', { count: 'exact', head: true })
          .eq('section_id', sec.id)
          .in('status', ['approved', 'denied'])
        return { ...sec, studentCount: count || 0 }
      })
    )
    setSections(withCounts)
    if (!activeSectionId && withCounts.length > 0) setActiveSectionId(withCounts[0].id)
    return withCounts
  }, [activeSectionId])

  const loadStudents = useCallback(async (sectionId) => {
    if (!sectionId) return
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('id, student_id, status, deactivation_reason, dashboard_shared, updated_at')
      .eq('section_id', sectionId)
      .in('status', ['approved', 'denied'])

    if (!enrollments || enrollments.length === 0) { setStudents([]); return }

    const charResults = await Promise.all(
      enrollments.map(async (e) => {
        const { data: char } = await supabase
          .from('characters')
          .select('id, name, emoji, background_color, life_path_id, current_week')
          .eq('enrollment_id', e.id)
          .single()
        if (!char) return null

        const { data: latest } = await supabase
          .from('financial_states')
          .select('net_worth, cash, savings, debt, credit_score, monthly_income, monthly_expenses')
          .eq('character_id', char.id)
          .order('week', { ascending: false })
          .limit(1)
          .single()

        const { data: allStates } = await supabase
          .from('financial_states')
          .select('net_worth, week')
          .eq('character_id', char.id)
          .order('week', { ascending: false })
          .limit(4)

        const { count: decisionCount } = await supabase
          .from('student_decisions')
          .select('id', { count: 'exact', head: true })
          .eq('character_id', char.id)

        const { data: lastDecision } = await supabase
          .from('student_decisions')
          .select('created_at')
          .eq('character_id', char.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()

        const income = Number(latest?.monthly_income) || 1
        const expenses = Number(latest?.monthly_expenses) || 0
        const savings = Number(latest?.savings) || 0
        const debt = Number(latest?.debt) || 0
        const savingsRate = ((income - expenses) / income) * 100
        const budgetGrade = Math.min(100, Math.max(0, 50 + savingsRate * 2.5))
        const debtGrade = debt === 0 ? 95 : Math.max(0, 100 - (debt / income) * 8)
        const savingsGrade = Math.min(100, (savings / income) * 25)
        const participationScore = char.current_week > 0 ? Math.min(100, Math.round(((decisionCount || 0) / char.current_week) * 100)) : 100
        const nwValues = (allStates || []).map(s => Number(s.net_worth))
        const netWorthDecline = nwValues.length >= 3 && nwValues[0] < nwValues[1] && nwValues[1] < nwValues[2]
        const simScore = Math.min(100, Math.round((budgetGrade * 0.4 + debtGrade * 0.3 + savingsGrade * 0.3)))

        return {
          id: char.id,
          enrollmentId: e.id,
          enrollStatus: e.status,
          deactivationReason: e.deactivation_reason,
          dashboardShared: e.dashboard_shared,
          name: char.name,
          emoji: char.emoji,
          bgColor: char.background_color,
          lifePathId: char.life_path_id,
          currentWeek: char.current_week,
          netWorth: Number(latest?.net_worth) || 0,
          cash: Number(latest?.cash) || 0,
          debt,
          creditScore: latest?.credit_score || 650,
          budgetGrade: Math.round(budgetGrade),
          debtGrade: Math.round(debtGrade),
          savingsGrade: Math.round(savingsGrade),
          overallGrade: Math.round((budgetGrade + debtGrade + savingsGrade) / 3),
          simScore,
          participationScore,
          lastActive: lastDecision?.created_at || e.updated_at,
          madeDecisionThisWeek: (decisionCount || 0) >= char.current_week,
          netWorthDecline,
          weeksBehind: Math.max(0, (activeSection?.unlocked_week || 0) - char.current_week - 1),
        }
      })
    )
    setStudents(charResults.filter(Boolean))
  }, [activeSection])

  const loadEvents = useCallback(async () => {
    const { data } = await supabase.from('life_events').select('id, title, is_positive, category').order('title')
    setAllEvents(data || [])
  }, [])

  const loadTriggers = useCallback(async () => {
    const sectionIds = sections.map(s => s.id)
    if (sectionIds.length === 0) return
    const { data } = await supabase
      .from('section_life_events')
      .select('id, section_id, life_event_id, week, triggered_at, life_events(title)')
      .in('section_id', sectionIds)
      .order('triggered_at', { ascending: false })
      .limit(10)
    setRecentTriggers(data || [])
  }, [sections])

  useEffect(() => {
    if (!session) return
    async function init() {
      try {
        const secs = await loadSections()
        await loadEvents()
        if (secs.length > 0) await loadStudents(secs[0].id)
      } catch (err) { setError(err.message) }
      finally { setLoading(false) }
    }
    init()
  }, [session])

  useEffect(() => {
    if (activeSectionId) loadStudents(activeSectionId)
  }, [activeSectionId, loadStudents])

  useEffect(() => {
    if (sections.length > 0) loadTriggers()
  }, [sections, loadTriggers])

  async function handleUpdateWeek(sectionId, newWeek) {
    const clamped = Math.max(0, Math.min(36, newWeek))
    setSections(prev => prev.map(s => s.id === sectionId ? { ...s, unlocked_week: clamped } : s))
    await supabase.from('sections').update({ unlocked_week: clamped }).eq('id', sectionId)
  }

  async function reload() {
    await loadSections()
    if (activeSectionId) await loadStudents(activeSectionId)
  }

  if (authLoading || loading) return <div className="page-center"><p style={{ color: 'var(--gray-400)' }}>Loading...</p></div>

  const pageTitle = NAV.find(n => n.id === page)?.label || ''

  return (
    <div className="td-layout">
      {/* Mobile hamburger */}
      <button className="td-hamburger" onClick={() => setSidebarOpen(!sidebarOpen)} type="button">☰</button>

      {/* Sidebar */}
      <aside className={`td-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="td-sidebar-top">
          <div className="td-logo">💰 FinSim</div>
          <div className="td-logo-sub">Teacher Portal</div>
        </div>

        <nav className="td-nav">
          {NAV.map(n => (
            <button key={n.id} className={`td-nav-item ${page === n.id ? 'active' : ''}`} onClick={() => { setPage(n.id); setSidebarOpen(false) }} type="button">
              <span className="td-nav-icon">{n.icon}</span>{n.label}
            </button>
          ))}
        </nav>

        <div className="td-sidebar-sections">
          <p className="td-sidebar-label">Sections</p>
          {sections.map(s => (
            <button key={s.id} className={`td-section-pill ${activeSectionId === s.id ? 'active' : ''}`} onClick={() => setActiveSectionId(s.id)} type="button">
              <span>{s.name}</span>
              <span className="td-section-count">{s.studentCount}</span>
            </button>
          ))}
        </div>

        <div className="td-sidebar-footer">
          <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{profile?.display_name || 'Teacher'}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user.email}</div>
          <button className="td-signout-link" onClick={signOut} type="button">Sign out</button>
        </div>
      </aside>

      {/* Main content */}
      <main className="td-main">
        <header className="td-topbar">
          <div>
            <h1 className="td-page-title">{pageTitle}</h1>
            {activeSection && <p className="td-page-sub">{activeSection.name} · {activeSection.class_code}</p>}
          </div>
        </header>

        {error && <div className="error-msg" style={{ marginBottom: '1rem' }}>{error}</div>}

        <div className="td-content">
          {page === 'overview' && <OverviewPage students={students} onSelectStudent={() => {}} />}
          {page === 'roster' && <RosterPage students={students} sections={sections} currentSectionId={activeSectionId} onReload={reload} />}
          {page === 'gradebook' && <GradebookPage students={students} sectionId={activeSectionId} onReload={reload} />}
          {page === 'sim' && <SimControlsPage sections={sections} allEvents={allEvents} recentTriggers={recentTriggers} onUpdateWeek={handleUpdateWeek} onReloadTriggers={loadTriggers} />}
          {page === 'display' && <ClassDisplayPage students={students} onReload={reload} />}
          {page === 'reports' && <ReportsPage students={students} sectionName={activeSection?.name} />}
          {page === 'demo' && <DemoPage />}
        </div>
      </main>
    </div>
  )
}
