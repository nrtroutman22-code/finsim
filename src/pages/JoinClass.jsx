import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

const POLL_INTERVAL = 30_000

export default function JoinClass() {
  const { session, profile, loading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [classCode, setClassCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [enrollmentId, setEnrollmentId] = useState(null)
  const [waitingStatus, setWaitingStatus] = useState('pending')
  const pollRef = useRef(null)
  const inviteHandled = useRef(false)

  const checkEnrollment = useCallback(async (eid) => {
    const { data } = await supabase
      .from('enrollments')
      .select('status')
      .eq('id', eid)
      .single()
    if (data?.status === 'approved') {
      setWaitingStatus('approved')
      clearInterval(pollRef.current)
      setTimeout(() => navigate('/create-character', { replace: true }), 1200)
    }
  }, [navigate])

  // Poll while waiting for approval
  useEffect(() => {
    if (!enrollmentId) return
    pollRef.current = setInterval(() => checkEnrollment(enrollmentId), POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [enrollmentId, checkEnrollment])

  // Auto-join via invite token in URL
  useEffect(() => {
    const token = searchParams.get('token')
    if (!token || !session || inviteHandled.current) return
    inviteHandled.current = true

    async function joinViaInvite() {
      setSubmitting(true)
      setError(null)
      const { data, error: rpcErr } = await supabase.rpc('join_section_by_invite', {
        p_invite_token: token,
      })
      if (rpcErr) {
        setError(friendlyError(rpcErr.message))
        setSubmitting(false)
        return
      }
      setEnrollmentId(data)
      setSubmitting(false)
    }
    joinViaInvite()
  }, [session, searchParams])

  // Check for existing pending enrollment on load
  useEffect(() => {
    if (!session) return
    async function checkExisting() {
      const { data } = await supabase
        .from('enrollments')
        .select('id, status')
        .eq('student_id', session.user.id)
        .limit(1)
        .single()
      if (data?.status === 'pending') {
        setEnrollmentId(data.id)
      } else if (data?.status === 'approved') {
        navigate('/create-character', { replace: true })
      }
    }
    checkExisting()
  }, [session, navigate])

  if (loading) {
    return (
      <div className="page-center">
        <p style={{ color: 'var(--gray-400)' }}>Loading...</p>
      </div>
    )
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const code = classCode.trim().toUpperCase()
    if (!code) return

    setSubmitting(true)
    setError(null)

    const { data, error: rpcErr } = await supabase.rpc('join_section_by_code', {
      p_class_code: code,
    })
    if (rpcErr) {
      setError(friendlyError(rpcErr.message))
      setSubmitting(false)
      return
    }
    setEnrollmentId(data)
    setSubmitting(false)
  }

  // Waiting screen
  if (enrollmentId) {
    return (
      <div className="page-center">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center' }}>
          <div style={{ fontSize: '3rem' }}>
            {waitingStatus === 'approved' ? '✅' : '⏳'}
          </div>
          <h2 style={{ fontSize: '1.25rem' }}>
            {waitingStatus === 'approved'
              ? 'You\'re approved!'
              : 'Waiting for teacher approval'}
          </h2>
          <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', lineHeight: 1.6 }}>
            {waitingStatus === 'approved'
              ? 'Redirecting you to create your character...'
              : 'Your teacher has been notified and will approve your request soon. This page checks automatically.'}
          </p>
          {waitingStatus !== 'approved' && (
            <button
              className="btn btn-primary"
              onClick={() => checkEnrollment(enrollmentId)}
              type="button"
            >
              Check now
            </button>
          )}
        </div>
      </div>
    )
  }

  // Code entry screen
  return (
    <div className="page-center">
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>📋 Join a Class</h1>
          <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem', lineHeight: 1.5 }}>
            Ask your teacher for your class code. It looks like <strong style={{ fontFamily: 'monospace', color: 'var(--gray-700)' }}>FIN-XXXX</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <input
            className={`input ${error ? 'input-error' : ''}`}
            type="text"
            placeholder="FIN-XXXX"
            value={classCode}
            onChange={(e) => { setClassCode(e.target.value); setError(null) }}
            style={{ textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.1em', fontWeight: 600 }}
            autoFocus
          />
          <button className="btn btn-primary" type="submit" disabled={submitting || !classCode.trim()}>
            {submitting ? (
              <><span className="spinner" /> Joining...</>
            ) : 'Join Class'}
          </button>
        </form>

        {error && <div className="error-msg">{error}</div>}

        <div style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--gray-400)', lineHeight: 1.5 }}>
          <p>Your teacher will need to approve your request before you can start.</p>
          <p style={{ marginTop: '0.3rem' }}>If you have an invite link, just click it and you'll join automatically.</p>
        </div>
      </div>
    </div>
  )
}

function friendlyError(msg) {
  if (msg.includes('Invalid or inactive class code')) return 'That code didn\'t work. Double-check the code with your teacher — it should look like FIN-XXXX.'
  if (msg.includes('Invalid or inactive invite link')) return 'This invite link is expired or invalid. Ask your teacher for a new one.'
  if (msg.includes('duplicate key') || msg.includes('already exists') || msg.includes('unique constraint'))
    return 'You\'re already enrolled in this class. Your teacher may still need to approve you.'
  if (msg.includes('Only students can join')) return 'Only student accounts can join a class. Sign out and sign back in as a student.'
  if (msg.includes('network') || msg.includes('fetch')) return 'Connection error. Check your internet and try again.'
  return msg
}
