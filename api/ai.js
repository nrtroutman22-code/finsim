export const config = {
  runtime: 'nodejs20.x',
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[api/ai] ANTHROPIC_API_KEY is not set in environment variables')
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch (e) {
    console.error('[api/ai] Failed to parse request body:', e.message)
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const { prompt, max_tokens = 1000 } = body || {}
  if (!prompt) {
    console.error('[api/ai] No prompt in request body. Body was:', JSON.stringify(body))
    return res.status(400).json({ error: 'prompt is required' })
  }

  console.log('[api/ai] Calling Anthropic API, prompt length:', prompt.length)

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const responseText = await response.text()

    if (!response.ok) {
      console.error('[api/ai] Anthropic API error:', response.status, responseText)
      return res.status(response.status).json({ error: responseText })
    }

    const data = JSON.parse(responseText)
    console.log('[api/ai] Success, response length:', data.content?.[0]?.text?.length || 0)
    return res.status(200).json(data)
  } catch (err) {
    console.error('[api/ai] Unexpected error:', err.message, err.stack)
    return res.status(500).json({ error: err.message })
  }
}
