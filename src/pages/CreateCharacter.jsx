import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

// ─── Constants ──────────────────────────────────────────

const STEP_TITLES = [
  '',
  'Character Name',
  'Build Your Avatar',
  'Choose Your Path',
  'Pick Your Location',
  'Money Personality',
  'Your Starting Snapshot',
]

const SKIN_TONES = [
  { label: 'Default', modifier: '' },
  { label: 'Light', modifier: '\u{1F3FB}' },
  { label: 'Medium-light', modifier: '\u{1F3FC}' },
  { label: 'Medium', modifier: '\u{1F3FD}' },
  { label: 'Medium-dark', modifier: '\u{1F3FE}' },
  { label: 'Dark', modifier: '\u{1F3FF}' },
]

const CHARACTER_STYLES = [
  { base: '🧑', label: 'Person' },
  { base: '👩', label: 'Woman' },
  { base: '👨', label: 'Man' },
  { base: '👱‍♀️', label: 'Blonde woman' },
  { base: '👱', label: 'Blonde man' },
  { base: '🧔', label: 'Beard' },
  { base: '👩‍🦱', label: 'Curly woman' },
  { base: '👨‍🦱', label: 'Curly man' },
  { base: '👩‍🦰', label: 'Red hair woman' },
  { base: '👨‍🦰', label: 'Red hair man' },
  { base: '👩‍🦳', label: 'White hair woman' },
  { base: '👨‍🦳', label: 'White hair man' },
  { base: '🧑‍🦲', label: 'Bald' },
]

const BACKGROUND_COLORS = [
  '#E6F1FB', '#E1F5EE', '#EEEDFE', '#FAEEDA',
  '#FBEAF0', '#F1EFE8', '#FAECE7', '#EAF3DE',
  '#FCEBEB', '#D3D1C7', '#B5D4F4', '#9FE1CB',
  '#FAC775', '#F4C0D1', '#CECBF6', '#C0DD97',
]

const LIFE_PATHS = [
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

const PATH_CATEGORIES = [
  { id: 'straight-to-work', name: 'Straight to Work' },
  { id: 'community-college', name: 'Community College' },
  { id: 'university', name: 'University' },
]

const LOCATIONS = [
  {
    id: 'big-city', name: 'Big City',
    description: 'Lots of opportunities but high rent and expenses.',
    rentLabel: 'Rent', rentRange: [1100, 1400],
  },
  {
    id: 'mid-size-city', name: 'Mid-Size City',
    description: 'A good balance of jobs, amenities, and affordability.',
    rentLabel: 'Rent', rentRange: [800, 1000],
  },
  {
    id: 'small-town', name: 'Small Town',
    description: 'Lower costs but fewer job options. Your money stretches further.',
    rentLabel: 'Rent', rentRange: [550, 750],
  },
  {
    id: 'living-at-home', name: 'Living at Home',
    description: 'Stay with family and contribute to household expenses while you save.',
    rentLabel: 'Family contribution', rentRange: [200, 350],
    onlyCategories: ['straight-to-work', 'community-college'],
  },
]

const PERSONALITY_QUESTIONS = [
  {
    question: 'How did you handle money in high school?',
    options: [
      'Saved almost everything',
      'Spent it as fast as I earned it',
      'Never really had any',
      'Gave a lot of it away',
    ],
  },
  {
    question: 'When something goes wrong financially, you...',
    options: [
      'Make a plan immediately',
      'Ask family for help',
      'Stress and avoid it',
      'Figure it out as I go',
    ],
  },
  {
    question: 'Your biggest financial goal right now is...',
    options: [
      'Move out on my own',
      'Buy a car',
      'Save for something big',
      'Just survive month to month',
    ],
  },
]

const PATH_STORIES = {
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

const LOCATION_STORIES = {
  'big-city': 'Living in a big city means high rent but endless opportunities.',
  'mid-size-city': 'Your mid-size city has solid job options without the sky-high costs of a major metro.',
  'small-town': "Small-town living keeps costs down, though there's less to spend money on anyway.",
  'living-at-home': 'Staying with family saves a fortune on rent while you build up your savings.',
}

// ─── Helpers ────────────────────────────────────────────

function applySkinTone(emoji, modifier) {
  if (!modifier) return emoji
  const chars = [...emoji]
  return chars[0] + modifier + chars.slice(1).join('')
}

function rand(min, max) {
  return Math.round(min + Math.random() * (max - min))
}

function money(n) {
  return '$' + n.toLocaleString()
}

function generateFinancials(path, location) {
  const monthlyIncome = rand(path.incomeRange[0], path.incomeRange[1])
  const startingSavings = rand(path.savingsRange[0], path.savingsRange[1])
  const startingDebt = rand(path.debtRange[0], path.debtRange[1])
  const monthlyRent = rand(location.rentRange[0], location.rentRange[1])
  const otherExpenses = rand(400, 600)
  return {
    monthlyIncome,
    startingSavings,
    startingDebt,
    monthlyRent,
    monthlyExpenses: monthlyRent + otherExpenses,
    netWorth: startingSavings - startingDebt,
    creditScore: 650,
  }
}

function generateBackstory(path, location, answers) {
  const traits = {
    'Saved almost everything': "You've always been a natural saver",
    'Spent it as fast as I earned it': "You've never been great at holding onto money",
    'Never really had any': 'Money was always tight growing up',
    'Gave a lot of it away': "You've always been generous, sometimes too generous",
  }
  const goals = {
    'Move out on my own': 'getting your own place',
    'Buy a car': 'saving up for a car',
    'Save for something big': 'saving up for something big',
    'Just survive month to month': 'just getting through each month',
  }
  const trait = traits[answers[0]] || "You're still figuring out your relationship with money"
  const goal = goals[answers[2]] || 'finding your footing'
  return `${PATH_STORIES[path.id]} ${LOCATION_STORIES[location.id]} ${trait}, and your biggest goal right now is ${goal}.`
}

// ─── Component ──────────────────────────────────────────

export default function CreateCharacter() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState(1)
  const [characterName, setCharacterName] = useState('')
  const [skinTone, setSkinTone] = useState('')
  const [styleBase, setStyleBase] = useState('🧑')
  const [bgColor, setBgColor] = useState('#E6F1FB')
  const [selectedPath, setSelectedPath] = useState(null)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [personality, setPersonality] = useState([null, null, null])
  const [financials, setFinancials] = useState(null)
  const [backstory, setBackstory] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  if (loading) return <div className="page-center"><p style={{ color: 'var(--gray-400)' }}>Loading...</p></div>

  const emoji = applySkinTone(styleBase, skinTone)

  function canAdvance() {
    switch (step) {
      case 1: return characterName.trim().length >= 2
      case 2: return true
      case 3: return selectedPath !== null
      case 4: return selectedLocation !== null
      case 5: return personality.every(a => a !== null)
      default: return true
    }
  }

  function handleNext() {
    if (step === 5) {
      setFinancials(generateFinancials(selectedPath, selectedLocation))
      setBackstory(generateBackstory(selectedPath, selectedLocation, personality))
    }
    setStep(step + 1)
  }

  function selectPath(path) {
    if (selectedPath?.category !== path.category) setSelectedLocation(null)
    setSelectedPath(path)
  }

  async function handleLaunch() {
    setSaving(true)
    setError(null)
    try {
      const { data: enrollment, error: eErr } = await supabase
        .from('enrollments')
        .select('id')
        .eq('student_id', session.user.id)
        .eq('status', 'approved')
        .limit(1)
        .single()
      if (eErr) throw new Error('No approved enrollment found. Ask your teacher to approve you first.')

      const { data: character, error: cErr } = await supabase
        .from('characters')
        .insert({
          enrollment_id: enrollment.id,
          name: characterName.trim(),
          emoji,
          skin_tone: skinTone,
          background_color: bgColor,
          life_path_id: selectedPath.id,
          location_id: selectedLocation.id,
          money_personality: personality.map((answer, i) => ({
            question_id: i + 1,
            question: PERSONALITY_QUESTIONS[i].question,
            answer,
          })),
          current_week: 0,
        })
        .select('id')
        .single()
      if (cErr) throw new Error(cErr.message)

      const { error: fErr } = await supabase
        .from('financial_states')
        .insert({
          character_id: character.id,
          week: 0,
          net_worth: financials.netWorth,
          cash: financials.startingSavings,
          monthly_income: financials.monthlyIncome,
          monthly_expenses: financials.monthlyExpenses,
          savings: financials.startingSavings,
          debt: financials.startingDebt,
          credit_score: financials.creditScore,
        })
      if (fErr) throw new Error(fErr.message)

      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const availableLocations = LOCATIONS.filter(
    loc => !loc.onlyCategories || loc.onlyCategories.includes(selectedPath?.category)
  )

  return (
    <div className="page-center" style={{ alignItems: 'flex-start', paddingTop: '2rem' }}>
      <div className="card wizard-card">
        {/* ── Header ── */}
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--gray-400)' }}>Step {step} of 6</p>
          <h2 style={{ fontSize: '1.25rem', margin: '0.25rem 0' }}>{STEP_TITLES[step]}</h2>
          <div className="wizard-progress">
            <div className="wizard-progress-bar" style={{ width: `${(step / 6) * 100}%` }} />
          </div>
        </div>

        {/* ── Step 1: Name ── */}
        {step === 1 && (
          <div>
            <label className="section-label" htmlFor="char-name">What should we call your character?</label>
            <input
              id="char-name"
              className="input"
              type="text"
              placeholder="Enter a name..."
              value={characterName}
              onChange={e => setCharacterName(e.target.value)}
              maxLength={30}
              autoFocus
            />
            {characterName.length > 0 && characterName.length < 2 && (
              <p style={{ color: 'var(--gray-400)', fontSize: '0.8rem', marginTop: '0.4rem' }}>
                Name must be at least 2 characters
              </p>
            )}
          </div>
        )}

        {/* ── Step 2: Avatar ── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div className="avatar-preview" style={{ backgroundColor: bgColor }}>{emoji}</div>

            <div>
              <p className="section-label">Skin tone</p>
              <div className="emoji-grid">
                {SKIN_TONES.map(tone => (
                  <button
                    key={tone.label}
                    className={`emoji-btn ${skinTone === tone.modifier ? 'selected' : ''}`}
                    onClick={() => setSkinTone(tone.modifier)}
                    title={tone.label}
                    type="button"
                  >
                    {applySkinTone('🧑', tone.modifier)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="section-label">Character style</p>
              <div className="emoji-grid">
                {CHARACTER_STYLES.map(style => (
                  <button
                    key={style.label}
                    className={`emoji-btn ${styleBase === style.base ? 'selected' : ''}`}
                    onClick={() => setStyleBase(style.base)}
                    title={style.label}
                    type="button"
                  >
                    {applySkinTone(style.base, skinTone)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="section-label">Background color</p>
              <div className="color-grid">
                {BACKGROUND_COLORS.map(color => (
                  <button
                    key={color}
                    className={`color-swatch ${bgColor === color ? 'selected' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setBgColor(color)}
                    title={color}
                    type="button"
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Life Path ── */}
        {step === 3 && (
          <div>
            {PATH_CATEGORIES.map(cat => {
              const paths = LIFE_PATHS.filter(p => p.category === cat.id)
              return (
                <div key={cat.id} className="path-group">
                  <p className="path-group-title">{cat.name}</p>
                  <div className="options-grid">
                    {paths.map(path => (
                      <button
                        key={path.id}
                        className={`option-card ${selectedPath?.id === path.id ? 'selected' : ''}`}
                        onClick={() => selectPath(path)}
                        type="button"
                      >
                        <div style={{ fontWeight: 600 }}>{path.emoji} {path.name}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginTop: '0.15rem' }}>
                          {path.shortDesc}
                        </div>
                        <div className="option-meta">
                          {money(path.incomeRange[0])}–{money(path.incomeRange[1])}/mo
                          {path.debtRange[1] > 0 && ` · ${money(path.debtRange[0])}–${money(path.debtRange[1])} debt`}
                          {path.debtRange[1] === 0 && ' · No starting debt'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}

            {selectedPath && (
              <div className="detail-panel">
                <p style={{ fontWeight: 600, marginBottom: '0.4rem' }}>{selectedPath.emoji} {selectedPath.name}</p>
                <p style={{ marginBottom: '0.4rem' }}>{selectedPath.fullDesc}</p>
                <p style={{ color: 'var(--gray-500)' }}><strong>Job examples:</strong> {selectedPath.jobs}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Step 4: Location ── */}
        {step === 4 && (
          <div className="options-grid">
            {availableLocations.map(loc => (
              <button
                key={loc.id}
                className={`option-card ${selectedLocation?.id === loc.id ? 'selected' : ''}`}
                onClick={() => setSelectedLocation(loc)}
                type="button"
              >
                <div style={{ fontWeight: 600 }}>{loc.name}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--gray-500)', marginTop: '0.15rem' }}>
                  {loc.description}
                </div>
                <div className="option-meta">
                  {loc.rentLabel}: {money(loc.rentRange[0])}–{money(loc.rentRange[1])}/mo
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Step 5: Money Personality ── */}
        {step === 5 && (
          <div>
            {PERSONALITY_QUESTIONS.map((q, qi) => (
              <div key={qi} className="question-group">
                <p className="question-text">{q.question}</p>
                <div className="options-grid">
                  {q.options.map(opt => (
                    <button
                      key={opt}
                      className={`option-card ${personality[qi] === opt ? 'selected' : ''}`}
                      onClick={() => {
                        const next = [...personality]
                        next[qi] = opt
                        setPersonality(next)
                      }}
                      type="button"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Step 6: Summary ── */}
        {step === 6 && financials && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
              <div className="avatar-preview avatar-preview-sm" style={{ backgroundColor: bgColor }}>{emoji}</div>
              <h3 style={{ fontSize: '1.1rem' }}>{characterName}</h3>
              <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>
                {selectedPath.emoji} {selectedPath.name} · {selectedLocation.name}
              </p>
            </div>

            <div style={{ marginBottom: '0.5rem' }}>
              <div className="summary-row">
                <span className="summary-label">Monthly Income</span>
                <span className="summary-value">{money(financials.monthlyIncome)}/mo</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">{selectedLocation.rentLabel}</span>
                <span className="summary-value">{money(financials.monthlyRent)}/mo</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Starting Savings</span>
                <span className="summary-value">{money(financials.startingSavings)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Starting Debt</span>
                <span className="summary-value" style={{ color: financials.startingDebt > 0 ? '#dc2626' : 'inherit' }}>
                  {financials.startingDebt > 0 ? money(financials.startingDebt) : 'None'}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-label">Credit Score</span>
                <span className="summary-value">{financials.creditScore}</span>
              </div>
            </div>

            <div className="backstory">
              <p>{backstory}</p>
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {error && <div className="error-msg" style={{ marginTop: '1rem' }}>{error}</div>}

        {/* ── Navigation ── */}
        <div className="wizard-nav">
          {step > 1 && (
            <button className="btn btn-secondary" onClick={() => setStep(step - 1)} type="button">
              Back
            </button>
          )}
          {step < 6 ? (
            <button className="btn btn-primary" onClick={handleNext} disabled={!canAdvance()} type="button">
              Next
            </button>
          ) : (
            <button className="btn btn-primary" onClick={handleLaunch} disabled={saving} type="button">
              {saving ? (<><span className="spinner" /> Creating character...</>) : 'Launch Simulation'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
