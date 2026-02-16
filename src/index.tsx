import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { v4 as uuidv4 } from 'uuid'

type Bindings = {
  DB: D1Database;
  GOOGLE_CALENDAR_API_KEY?: string;
  GOOGLE_CALENDAR_ID?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_REDIRECT_URI?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

type Task = {
  id: string;
  title: string;
  category: 'future' | 'now' | 'maintain' | 'chore';
  minutes: number;
  status: 'todo' | 'done' | 'deleted';
  created_at: string;
  due_date?: string;
  priority?: 'high' | 'medium' | 'low';
}

type TimeSlot = {
  start: string; // HH:mm
  end: string;   // HH:mm
  title: string;
  type: 'fixed' | 'lunch' | 'dinner' | 'reply' | 'deep' | 'light' | 'family';
  color?: string;
}

type ScheduleBlock = {
  start: Date;
  end: Date;
  title: string;
  type: string;
  minutes: number;
}

type Subtask = {
  id: string;
  task_id: string;
  title: string;
  minutes: number;
  order_index: number;
  status: 'todo' | 'done';
  created_at: string;
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for API routes (restrict origin in production)
app.use('/api/*', cors({
  origin: (origin) => origin || '*',
}))

// ========================================
// Schedule Generation Helper Functions
// ========================================

// 15分刻みに切り上げ
function ceil15(date: Date): Date {
  const minutes = date.getMinutes()
  const remainder = minutes % 15
  if (remainder === 0) return new Date(date)
  
  const newDate = new Date(date)
  newDate.setMinutes(minutes + (15 - remainder))
  newDate.setSeconds(0)
  newDate.setMilliseconds(0)
  return newDate
}

// 時刻を HH:mm 形式に変換
function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5)
}

// HH:mm を Date に変換（今日の日付で）
function parseTime(timeStr: string, baseDate: Date = new Date()): Date {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const date = new Date(baseDate)
  date.setHours(hours, minutes, 0, 0)
  return date
}

// 時間範囲が重複しているかチェック
function hasOverlap(start1: Date, end1: Date, start2: Date, end2: Date): boolean {
  return start1 < end2 && end1 > start2
}

// スケジュールブロックが他のブロックと衝突するかチェック
function checkConflict(block: ScheduleBlock, blocks: ScheduleBlock[]): boolean {
  return blocks.some(b => hasOverlap(block.start, block.end, b.start, b.end))
}

// 指定時刻から空き時間を探す（前後にスライド）
function findAvailableSlot(
  preferredStart: Date,
  duration: number, // 分
  blocks: ScheduleBlock[],
  minTime?: Date,
  maxTime?: Date
): Date | null {
  const trySlot = (start: Date): boolean => {
    if (minTime && start < minTime) return false
    const end = new Date(start.getTime() + duration * 60000)
    if (maxTime && end > maxTime) return false
    
    const testBlock: ScheduleBlock = {
      start,
      end,
      title: 'test',
      type: 'test',
      minutes: duration
    }
    return !checkConflict(testBlock, blocks)
  }
  
  // まず希望時刻を試す
  if (trySlot(preferredStart)) {
    return preferredStart
  }
  
  // 後ろにずらす
  for (let offset = 15; offset <= 90; offset += 15) {
    const newStart = new Date(preferredStart.getTime() + offset * 60000)
    if (trySlot(newStart)) {
      return newStart
    }
  }
  
  // 前にずらす
  for (let offset = 15; offset <= 180; offset += 15) {
    const newStart = new Date(preferredStart.getTime() - offset * 60000)
    if (trySlot(newStart)) {
      return newStart
    }
  }
  
  return null
}

// 夜ご飯の時間を探す（20:00〜24:00の間で60分）
function findDinnerSlot(baseDate: Date, blocks: ScheduleBlock[]): Date | null {
  const candidates = [
    '21:00', // デフォルト推奨
    '20:30',
    '21:30',
    '20:00',
    '22:00',
    '23:00'
  ]
  
  const maxTime = parseTime('24:00', baseDate)
  
  for (const timeStr of candidates) {
    const start = parseTime(timeStr, baseDate)
    const end = new Date(start.getTime() + 60 * 60000)
    
    if (end > maxTime) continue
    
    const testBlock: ScheduleBlock = {
      start,
      end,
      title: 'dinner',
      type: 'dinner',
      minutes: 60
    }
    
    if (!checkConflict(testBlock, blocks)) {
      return start
    }
  }
  
  return null
}

async function ensureOAuthTokensTable(DB: D1Database) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expiry_at INTEGER NOT NULL,
      scope TEXT,
      token_type TEXT,
      updated_at TEXT NOT NULL
    )
  `).run()
}

async function getStoredOAuthToken(DB: D1Database) {
  await ensureOAuthTokensTable(DB)
  const { results } = await DB.prepare(
    'SELECT access_token, refresh_token, expiry_at, scope, token_type FROM oauth_tokens WHERE id = 1'
  ).all()
  return results.length > 0
    ? (results[0] as {
        access_token: string;
        refresh_token?: string;
        expiry_at: number;
        scope?: string;
        token_type?: string;
      })
    : null
}

async function saveOAuthToken(
  DB: D1Database,
  token: {
    access_token: string;
    refresh_token?: string;
    expiry_at: number;
    scope?: string;
    token_type?: string;
  }
) {
  await ensureOAuthTokensTable(DB)
  await DB.prepare(
    `INSERT INTO oauth_tokens (id, access_token, refresh_token, expiry_at, scope, token_type, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       expiry_at = excluded.expiry_at,
       scope = excluded.scope,
       token_type = excluded.token_type,
       updated_at = excluded.updated_at`
  ).bind(
    token.access_token,
    token.refresh_token || null,
    token.expiry_at,
    token.scope || null,
    token.token_type || 'Bearer',
    new Date().toISOString()
  ).run()
}

function isOAuthConfigured(env: Bindings): boolean {
  return !!(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET && env.GOOGLE_CALENDAR_ID)
}

function getOAuthRedirectUri(c: { env: Bindings; req: { url: string } }): string {
  if (c.env.GOOGLE_OAUTH_REDIRECT_URI) {
    return c.env.GOOGLE_OAUTH_REDIRECT_URI
  }
  return new URL('/api/calendar/oauth/callback', c.req.url).toString()
}

async function refreshGoogleAccessToken(c: { env: Bindings; req: { url: string } }) {
  const { DB, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } = c.env
  const token = await getStoredOAuthToken(DB)
  if (!token?.refresh_token || !GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
    return null
  }

  const body = new URLSearchParams({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: token.refresh_token,
    grant_type: 'refresh_token'
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!response.ok) return null
  const data = await response.json() as any
  if (!data.access_token || !data.expires_in) return null

  const refreshed = {
    access_token: data.access_token as string,
    refresh_token: token.refresh_token,
    expiry_at: Date.now() + Number(data.expires_in) * 1000,
    scope: (data.scope as string) || token.scope,
    token_type: (data.token_type as string) || 'Bearer'
  }
  await saveOAuthToken(DB, refreshed)
  return refreshed.access_token
}

async function getGoogleAccessToken(c: { env: Bindings; req: { url: string } }) {
  const { DB } = c.env
  const token = await getStoredOAuthToken(DB)
  if (!token) return null

  const earlyRefreshMargin = 60 * 1000
  if (Date.now() < Number(token.expiry_at) - earlyRefreshMargin) {
    return token.access_token
  }

  return refreshGoogleAccessToken(c)
}

async function fetchCalendarEvents(
  c: { env: Bindings; req: { url: string } },
  timeMin: string,
  timeMax: string
) {
  const { GOOGLE_CALENDAR_API_KEY, GOOGLE_CALENDAR_ID } = c.env

  if (!GOOGLE_CALENDAR_ID) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Google Calendar ID not configured',
        message: 'Please set GOOGLE_CALENDAR_ID in your environment variables'
      }
    }
  }

  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&singleEvents=true&orderBy=startTime`
  let url = base
  let headers: Record<string, string> = {}

  if (isOAuthConfigured(c.env)) {
    const accessToken = await getGoogleAccessToken(c)
    if (!accessToken) {
      return {
        ok: false,
        status: 401,
        body: {
          error: 'Google OAuth not connected',
          message: 'Connect Google Calendar with OAuth to access private calendars',
          authUrl: '/api/calendar/oauth/start'
        }
      }
    }
    headers = { Authorization: `Bearer ${accessToken}` }
  } else if (GOOGLE_CALENDAR_API_KEY) {
    url = `${base}&key=${encodeURIComponent(GOOGLE_CALENDAR_API_KEY)}`
  } else {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Google Calendar API not configured',
        message: 'Set OAuth credentials for private calendars or API key for public calendars'
      }
    }
  }

  const response = await fetch(url, { headers })
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Unknown Google API error' }))
    return {
      ok: false,
      status: response.status,
      body: { error: 'Failed to fetch calendar events', details: errorData }
    }
  }

  const data = await response.json() as any
  return { ok: true, status: 200, body: data.items || [] }
}

function extractJsonArray(text: string): any[] {
  const trimmed = text.trim()
  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) return parsed
  } catch {}

  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start >= 0 && end > start) {
    const snippet = trimmed.slice(start, end + 1)
    try {
      const parsed = JSON.parse(snippet)
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  return []
}

async function callOpenAIDecompose(env: Bindings, prompt: string) {
  if (!env.OPENAI_API_KEY) return null
  const model = env.OPENAI_MODEL || 'gpt-4.1-mini'
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a task decomposition assistant. Return ONLY JSON array. Each item: {"title":string,"minutes":number}.'
        },
        { role: 'user', content: prompt }
      ]
    })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`OpenAI API error: ${response.status} ${detail}`)
  }
  const data = await response.json() as any
  const text = data?.choices?.[0]?.message?.content || '[]'
  return extractJsonArray(text)
}

async function callGeminiDecompose(env: Bindings, prompt: string) {
  if (!env.GEMINI_API_KEY) return null
  const model = env.GEMINI_MODEL || 'gemini-1.5-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig: { temperature: 0.2 },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: {
        parts: [
          {
            text:
              'Return ONLY JSON array. Each item: {"title":string,"minutes":number}.'
          }
        ]
      }
    })
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Gemini API error: ${response.status} ${detail}`)
  }
  const data = await response.json() as any
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
  return extractJsonArray(text)
}

function normalizeSubtasks(raw: any[], totalMinutes: number): Array<{ title: string; minutes: number }> {
  const cleaned = raw
    .map((x) => ({
      title: typeof x?.title === 'string' ? x.title.trim() : '',
      minutes: Number(x?.minutes)
    }))
    .filter((x) => x.title.length > 0 && Number.isFinite(x.minutes) && x.minutes > 0)
    .slice(0, 12)

  if (cleaned.length === 0) return []

  const minPerStep = 10
  const normalized = cleaned.map((x) => ({ ...x, minutes: Math.max(minPerStep, Math.round(x.minutes)) }))
  const sum = normalized.reduce((acc, x) => acc + x.minutes, 0)
  const target = Math.max(totalMinutes || 30, minPerStep * normalized.length)
  const scale = sum > 0 ? target / sum : 1

  return normalized.map((x) => ({
    title: x.title,
    minutes: Math.max(minPerStep, Math.round(x.minutes * scale))
  }))
}

// API Routes

// Get all tasks with filters/search/sort
app.get('/api/tasks', async (c) => {
  const { DB } = c.env
  const q = (c.req.query('q') || '').trim()
  const status = c.req.query('status') || 'all'
  const category = c.req.query('category') || 'all'
  const priority = c.req.query('priority') || 'all'
  const due = c.req.query('due') || 'all'
  const sort = c.req.query('sort') || 'due_asc'

  const whereClauses: string[] = ['status != ?']
  const values: (string | number)[] = ['deleted']

  if (q) {
    whereClauses.push('title LIKE ?')
    values.push(`%${q}%`)
  }

  if (status === 'todo' || status === 'done') {
    whereClauses.push('status = ?')
    values.push(status)
  }

  if (['future', 'now', 'maintain', 'chore'].includes(category)) {
    whereClauses.push('category = ?')
    values.push(category)
  }

  if (['high', 'medium', 'low'].includes(priority)) {
    whereClauses.push('priority = ?')
    values.push(priority)
  }

  const today = new Date().toISOString().split('T')[0]
  if (due === 'overdue') {
    whereClauses.push('due_date IS NOT NULL AND due_date < ?')
    values.push(today)
  } else if (due === 'today') {
    whereClauses.push('due_date = ?')
    values.push(today)
  } else if (due === 'three_days') {
    whereClauses.push('due_date IS NOT NULL AND due_date BETWEEN ? AND date(?, \'+3 day\')')
    values.push(today, today)
  } else if (due === 'week') {
    whereClauses.push('due_date IS NOT NULL AND due_date BETWEEN ? AND date(?, \'+7 day\')')
    values.push(today, today)
  } else if (due === 'none') {
    whereClauses.push('due_date IS NULL')
  }

  const orderByMap: Record<string, string> = {
    due_asc: 'CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, created_at DESC',
    due_desc: 'CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date DESC, created_at DESC',
    priority: "CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, due_date ASC",
    created_desc: 'created_at DESC',
    created_asc: 'created_at ASC'
  }
  const orderBy = orderByMap[sort] || orderByMap.due_asc

  const sql = `SELECT * FROM tasks WHERE ${whereClauses.join(' AND ')} ORDER BY ${orderBy}`
  const { results } = await DB.prepare(sql).bind(...values).all()
  return c.json(results)
})

// Task statistics
app.get('/api/tasks/stats', async (c) => {
  const { DB } = c.env
  const today = new Date().toISOString().split('T')[0]

  const { results } = await DB.prepare(
    'SELECT category, status, due_date FROM tasks WHERE status != ?'
  ).bind('deleted').all()

  const tasks = results as Array<{ category: string; status: string; due_date?: string | null }>
  const total = tasks.length
  const done = tasks.filter((t) => t.status === 'done').length
  const todo = tasks.filter((t) => t.status === 'todo').length
  const overdue = tasks.filter((t) => t.status === 'todo' && t.due_date && t.due_date < today).length
  const completionRate = total > 0 ? Math.round((done / total) * 100) : 0

  const byCategory = {
    future: tasks.filter((t) => t.category === 'future').length,
    now: tasks.filter((t) => t.category === 'now').length,
    maintain: tasks.filter((t) => t.category === 'maintain').length,
    chore: tasks.filter((t) => t.category === 'chore').length
  }

  return c.json({
    total,
    todo,
    done,
    overdue,
    completionRate,
    byCategory
  })
})

async function ensureSubtasksTable(DB: D1Database) {
  await DB.prepare(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 15,
      order_index INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'done')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run()
}

// Get subtasks by task
app.get('/api/tasks/:id/subtasks', async (c) => {
  const { DB } = c.env
  const taskId = c.req.param('id')
  await ensureSubtasksTable(DB)

  const { results } = await DB.prepare(
    'SELECT * FROM subtasks WHERE task_id = ? ORDER BY order_index ASC, created_at ASC'
  ).bind(taskId).all()

  return c.json(results)
})

// Toggle subtask done/todo
app.post('/api/subtasks/:id/toggle', async (c) => {
  const { DB } = c.env
  const subtaskId = c.req.param('id')
  await ensureSubtasksTable(DB)

  const { results } = await DB.prepare(
    'SELECT status FROM subtasks WHERE id = ?'
  ).bind(subtaskId).all()

  if (results.length === 0) {
    return c.json({ error: 'Subtask not found' }, 404)
  }

  const current = results[0].status as string
  const next = current === 'done' ? 'todo' : 'done'
  await DB.prepare('UPDATE subtasks SET status = ? WHERE id = ?').bind(next, subtaskId).run()

  return c.json({ status: next })
})

// AI decomposition and save subtasks
app.post('/api/tasks/:id/decompose', async (c) => {
  const { DB } = c.env
  const taskId = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))
  const provider = body?.provider || 'auto'

  const { results } = await DB.prepare(
    'SELECT id, title, minutes, category, priority, due_date FROM tasks WHERE id = ? AND status != ?'
  ).bind(taskId, 'deleted').all()

  if (results.length === 0) {
    return c.json({ error: 'Task not found' }, 404)
  }

  const task = results[0] as any
  const totalMinutes = Number(task.minutes) || 30
  const prompt =
    `以下のタスクを「実行可能な最小単位」に分解してください。\n` +
    `条件:\n` +
    `- 1ステップは10〜45分\n` +
    `- 行動が明確で、今すぐ着手できる表現\n` +
    `- 最大8ステップ\n` +
    `- 出力はJSON配列のみ: [{"title":"...","minutes":15}]\n\n` +
    `タスク名: ${task.title}\n` +
    `想定時間: ${totalMinutes}分\n` +
    `カテゴリ: ${task.category || 'now'}\n` +
    `優先度: ${task.priority || 'medium'}\n` +
    `期日: ${task.due_date || '未設定'}`

  let rawSteps: any[] | null = null

  if (provider === 'openai') {
    rawSteps = await callOpenAIDecompose(c.env, prompt)
  } else if (provider === 'gemini') {
    rawSteps = await callGeminiDecompose(c.env, prompt)
  } else {
    try {
      rawSteps = await callOpenAIDecompose(c.env, prompt)
    } catch {
      rawSteps = null
    }
    if (!rawSteps || rawSteps.length === 0) {
      rawSteps = await callGeminiDecompose(c.env, prompt)
    }
  }

  if (!rawSteps || rawSteps.length === 0) {
    return c.json({
      error: 'AI decomposition unavailable',
      message: 'Set OPENAI_API_KEY or GEMINI_API_KEY and try again'
    }, 400)
  }

  const steps = normalizeSubtasks(rawSteps, totalMinutes)
  if (steps.length === 0) {
    return c.json({ error: 'Failed to parse AI response' }, 500)
  }

  await ensureSubtasksTable(DB)
  await DB.prepare('DELETE FROM subtasks WHERE task_id = ?').bind(taskId).run()

  for (let i = 0; i < steps.length; i += 1) {
    await DB.prepare(
      'INSERT INTO subtasks (id, task_id, title, minutes, order_index, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      uuidv4(),
      taskId,
      steps[i].title,
      steps[i].minutes,
      i + 1,
      'todo',
      new Date().toISOString()
    ).run()
  }

  const { results: saved } = await DB.prepare(
    'SELECT * FROM subtasks WHERE task_id = ? ORDER BY order_index ASC'
  ).bind(taskId).all()

  return c.json({ provider, subtasks: saved })
})

// Get single task
app.get('/api/tasks/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const { results } = await DB.prepare(
    'SELECT * FROM tasks WHERE id = ?'
  ).bind(id).all()
  
  if (results.length === 0) {
    return c.json({ error: 'Task not found' }, 404)
  }
  
  return c.json(results[0])
})

// Create new task
app.post('/api/tasks', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  
  const id = uuidv4()
  const task: Task = {
    id,
    title: body.title,
    category: body.category || 'chore',
    minutes: body.minutes || 15,
    status: 'todo',
    created_at: new Date().toISOString(),
    due_date: body.due_date || null,
    priority: body.priority || 'medium'
  }
  
  await DB.prepare(
    'INSERT INTO tasks (id, title, category, minutes, status, created_at, due_date, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    task.id,
    task.title,
    task.category,
    task.minutes,
    task.status,
    task.created_at,
    task.due_date,
    task.priority
  ).run()
  
  return c.json(task, 201)
})

// Update task
app.put('/api/tasks/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const updates: string[] = []
  const values: any[] = []
  
  if (body.title !== undefined) {
    updates.push('title = ?')
    values.push(body.title)
  }
  if (body.category !== undefined) {
    updates.push('category = ?')
    values.push(body.category)
  }
  if (body.minutes !== undefined) {
    updates.push('minutes = ?')
    values.push(body.minutes)
  }
  if (body.status !== undefined) {
    updates.push('status = ?')
    values.push(body.status)
  }
  if (body.due_date !== undefined) {
    updates.push('due_date = ?')
    values.push(body.due_date)
  }
  if (body.priority !== undefined) {
    updates.push('priority = ?')
    values.push(body.priority)
  }
  
  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400)
  }
  
  values.push(id)
  
  await DB.prepare(
    `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run()
  
  const { results } = await DB.prepare(
    'SELECT * FROM tasks WHERE id = ?'
  ).bind(id).all()
  
  return c.json(results[0])
})

// Delete task (soft delete)
app.delete('/api/tasks/:id', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  await DB.prepare(
    'UPDATE tasks SET status = ? WHERE id = ?'
  ).bind('deleted', id).run()
  
  return c.json({ success: true })
})

// Toggle task completion
app.post('/api/tasks/:id/toggle', async (c) => {
  const { DB } = c.env
  const id = c.req.param('id')
  
  const { results } = await DB.prepare(
    'SELECT status FROM tasks WHERE id = ?'
  ).bind(id).all()
  
  if (results.length === 0) {
    return c.json({ error: 'Task not found' }, 404)
  }
  
  const currentStatus = results[0].status as string
  const newStatus = currentStatus === 'done' ? 'todo' : 'done'
  
  await DB.prepare(
    'UPDATE tasks SET status = ? WHERE id = ?'
  ).bind(newStatus, id).run()
  
  return c.json({ status: newStatus })
})

// Google OAuth status
app.get('/api/calendar/oauth/status', async (c) => {
  const mode = isOAuthConfigured(c.env) ? 'oauth' : (c.env.GOOGLE_CALENDAR_API_KEY ? 'api_key' : 'none')
  const token = await getStoredOAuthToken(c.env.DB)

  return c.json({
    mode,
    connected: !!token,
    hasCalendarId: !!c.env.GOOGLE_CALENDAR_ID,
    authUrl: '/api/calendar/oauth/start'
  })
})

// Start OAuth flow
app.get('/api/calendar/oauth/start', async (c) => {
  const { GOOGLE_OAUTH_CLIENT_ID } = c.env
  if (!isOAuthConfigured(c.env) || !GOOGLE_OAUTH_CLIENT_ID) {
    return c.json({
      error: 'Google OAuth not configured',
      message: 'Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_CALENDAR_ID'
    }, 400)
  }

  const redirectUri = getOAuthRedirectUri(c)
  const scope = 'https://www.googleapis.com/auth/calendar.readonly'
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(GOOGLE_OAUTH_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&include_granted_scopes=true`
  return c.redirect(authUrl)
})

// OAuth callback
app.get('/api/calendar/oauth/callback', async (c) => {
  const { DB, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET } = c.env
  const code = c.req.query('code')
  const oauthError = c.req.query('error')

  if (oauthError) {
    const safeError = String(oauthError).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    return c.html(`<h1>OAuth failed</h1><p>${safeError}</p><p><a href="/">戻る</a></p>`, 400)
  }
  if (!code || !GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) {
    return c.html('<h1>OAuth failed</h1><p>Missing code or OAuth config.</p><p><a href="/">戻る</a></p>', 400)
  }

  const redirectUri = getOAuthRedirectUri(c)
  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!response.ok) {
    const errorData = await response.text()
    const safeErrorData = errorData.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    return c.html(`<h1>OAuth failed</h1><pre>${safeErrorData}</pre><p><a href="/">戻る</a></p>`, 400)
  }

  const data = await response.json() as any
  const existing = await getStoredOAuthToken(DB)
  const refreshToken = data.refresh_token || existing?.refresh_token

  if (!data.access_token || !refreshToken || !data.expires_in) {
    return c.html('<h1>OAuth failed</h1><p>Invalid token response.</p><p><a href="/">戻る</a></p>', 400)
  }

  await saveOAuthToken(DB, {
    access_token: data.access_token,
    refresh_token: refreshToken,
    expiry_at: Date.now() + Number(data.expires_in) * 1000,
    scope: data.scope,
    token_type: data.token_type || 'Bearer'
  })

  return c.redirect('/?oauth=success')
})

// Disconnect OAuth
app.post('/api/calendar/oauth/disconnect', async (c) => {
  const { DB } = c.env
  await ensureOAuthTokensTable(DB)
  await DB.prepare('DELETE FROM oauth_tokens WHERE id = 1').run()
  return c.json({ success: true })
})

// Google Calendar Integration
app.get('/api/calendar/events', async (c) => {
  try {
    const now = new Date()
    const futureDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const result = await fetchCalendarEvents(c, now.toISOString(), futureDate.toISOString())
    return c.json(result.body, result.status as 200 | 400 | 401 | 403 | 500)
  } catch (error) {
    return c.json({
      error: 'Failed to fetch calendar events',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Get today's calendar events (for schedule generation)
app.get('/api/calendar/today', async (c) => {
  try {
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(now)
    todayEnd.setHours(23, 59, 59, 999)

    const result = await fetchCalendarEvents(c, todayStart.toISOString(), todayEnd.toISOString())
    if (!result.ok) {
      return c.json(result.body, result.status as 200 | 400 | 401 | 403 | 500)
    }

    const fixedEvents = (result.body as any[]).map((event: any) => {
      const start = new Date(event.start.dateTime || event.start.date)
      const end = new Date(event.end.dateTime || event.end.date)
      return {
        start: formatTime(start),
        end: formatTime(end),
        title: event.summary || 'Untitled'
      }
    })

    return c.json(fixedEvents)
  } catch (error) {
    return c.json({
      error: 'Failed to fetch today\'s calendar events',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500)
  }
})

// Convert calendar event to task
app.post('/api/calendar/convert', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  
  const id = uuidv4()
  const task: Task = {
    id,
    title: body.summary || 'Untitled Event',
    category: body.category || 'now',
    minutes: body.minutes || 60,
    status: 'todo',
    created_at: new Date().toISOString(),
    due_date: body.start ? new Date(body.start).toISOString().split('T')[0] : null,
    priority: body.priority || 'medium'
  }
  
  await DB.prepare(
    'INSERT INTO tasks (id, title, category, minutes, status, created_at, due_date, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    task.id,
    task.title,
    task.category,
    task.minutes,
    task.status,
    task.created_at,
    task.due_date,
    task.priority
  ).run()
  
  return c.json(task, 201)
})

// Convert multiple calendar events to tasks
app.post('/api/calendar/convert-all', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  const events = Array.isArray(body.events) ? body.events : []

  if (events.length === 0) {
    return c.json({ created: 0, skipped: 0, message: 'No events provided' })
  }

  let created = 0
  let skipped = 0

  for (const event of events) {
    const summary = event.summary || 'Untitled Event'
    const startRaw = event.start?.dateTime || event.start?.date
    const dueDate = startRaw ? new Date(startRaw).toISOString().split('T')[0] : null

    const checkSql = dueDate
      ? 'SELECT id FROM tasks WHERE title = ? AND due_date = ? AND status != ? LIMIT 1'
      : 'SELECT id FROM tasks WHERE title = ? AND due_date IS NULL AND status != ? LIMIT 1'
    const checkStmt = dueDate
      ? DB.prepare(checkSql).bind(summary, dueDate, 'deleted')
      : DB.prepare(checkSql).bind(summary, 'deleted')
    const { results } = await checkStmt.all()

    if (results.length > 0) {
      skipped += 1
      continue
    }

    await DB.prepare(
      'INSERT INTO tasks (id, title, category, minutes, status, created_at, due_date, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      uuidv4(),
      summary,
      'now',
      60,
      'todo',
      new Date().toISOString(),
      dueDate,
      'medium'
    ).run()

    created += 1
  }

  return c.json({ created, skipped })
})

// Generate today's schedule
app.post('/api/schedule/generate', async (c) => {
  const { DB } = c.env
  const body = await c.req.json()
  
  const now = new Date()
  const t0 = now
  const baseDate = new Date(now)
  baseDate.setHours(0, 0, 0, 0)
  
  // 1. 計画開始時刻を決定（t0 + 15分、15分刻みに切り上げ）
  const planStartTime = new Date(t0.getTime() + 15 * 60000)
  const planStart = ceil15(planStartTime)
  
  // 2. 固定予定を配置
  const fixedEvents = body.fixedEvents || []
  const blocks: ScheduleBlock[] = fixedEvents.map((event: any) => ({
    start: parseTime(event.start, baseDate),
    end: parseTime(event.end, baseDate),
    title: event.title,
    type: 'fixed',
    minutes: Math.round((parseTime(event.end, baseDate).getTime() - parseTime(event.start, baseDate).getTime()) / 60000)
  }))
  
  const result: TimeSlot[] = []
  const warnings: string[] = []
  
  // 固定予定を結果に追加
  fixedEvents.forEach((event: any) => {
    result.push({
      start: event.start,
      end: event.end,
      title: event.title,
      type: 'fixed',
      color: '#ef4444'
    })
  })
  
  // 3. 返信枠を配置（3時間ごと、15分）
  const replyInterval = 3 * 60 // 3時間（分）
  let currentReplyTime = new Date(planStart)
  const endOfDay = parseTime('20:00', baseDate) // 20時まで
  
  while (currentReplyTime < endOfDay) {
    const replyEnd = new Date(currentReplyTime.getTime() + 15 * 60000)
    const replyBlock: ScheduleBlock = {
      start: currentReplyTime,
      end: replyEnd,
      title: '返信枠',
      type: 'reply',
      minutes: 15
    }
    
    // 衝突チェック
    if (checkConflict(replyBlock, blocks)) {
      // 空き時間を探す（±30分以内）
      const availableStart = findAvailableSlot(
        currentReplyTime,
        15,
        blocks,
        planStart,
        endOfDay
      )
      
      if (availableStart) {
        replyBlock.start = availableStart
        replyBlock.end = new Date(availableStart.getTime() + 15 * 60000)
      }
    }
    
    if (!checkConflict(replyBlock, blocks)) {
      blocks.push(replyBlock)
      result.push({
        start: formatTime(replyBlock.start),
        end: formatTime(replyBlock.end),
        title: '返信枠',
        type: 'reply',
        color: '#3b82f6'
      })
    }
    
    currentReplyTime = new Date(currentReplyTime.getTime() + replyInterval * 60000)
  }
  
  // 4. ランチを配置（t0 + 6時間、60分）
  const lunchPreferred = new Date(t0.getTime() + 6 * 60 * 60000)
  const lunchStart = ceil15(lunchPreferred)
  const dinnerTimeStart = parseTime('20:00', baseDate)
  
  const availableLunchStart = findAvailableSlot(
    lunchStart,
    60,
    blocks,
    planStart,
    dinnerTimeStart
  )
  
  if (availableLunchStart) {
    const lunchBlock: ScheduleBlock = {
      start: availableLunchStart,
      end: new Date(availableLunchStart.getTime() + 60 * 60000),
      title: 'ランチ',
      type: 'lunch',
      minutes: 60
    }
    blocks.push(lunchBlock)
    result.push({
      start: formatTime(lunchBlock.start),
      end: formatTime(lunchBlock.end),
      title: 'ランチ 🍽️',
      type: 'lunch',
      color: '#10b981'
    })
  } else {
    warnings.push('⚠️ ランチ枠を確保できませんでした')
  }
  
  // 5. 夜ご飯を配置（20:00〜24:00の間で60分）
  const dinnerStart = findDinnerSlot(baseDate, blocks)
  
  if (dinnerStart) {
    const dinnerBlock: ScheduleBlock = {
      start: dinnerStart,
      end: new Date(dinnerStart.getTime() + 60 * 60000),
      title: '夜ご飯',
      type: 'dinner',
      minutes: 60
    }
    blocks.push(dinnerBlock)
    result.push({
      start: formatTime(dinnerBlock.start),
      end: formatTime(dinnerBlock.end),
      title: '夜ご飯 🍽️',
      type: 'dinner',
      color: '#f59e0b'
    })
  } else {
    warnings.push('⚠️ 夜ご飯枠を確保できませんでした（会食などで代替されている可能性）')
  }
  
  // 6. 家族時間（20:00〜24:00）
  const familyStart = parseTime('20:00', baseDate)
  const familyEnd = parseTime('24:00', baseDate)
  result.push({
    start: formatTime(familyStart),
    end: formatTime(familyEnd),
    title: '家族時間',
    type: 'family',
    color: '#8b5cf6'
  })
  
  // 7. タスクDBから今日やるべきタスクを取得
  const { results: tasks } = await DB.prepare(
    "SELECT * FROM tasks WHERE status = ? AND (due_date IS NULL OR due_date <= ?) ORDER BY CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC, created_at ASC"
  ).bind('todo', new Date().toISOString().split('T')[0]).all()
  
  // タスクを深い作業（45-90分）と軽作業（15-30分）に分類
  const deepTasks = (tasks as Task[]).filter(t => t.minutes >= 45)
  const lightTasks = (tasks as Task[]).filter(t => t.minutes < 45)
  
  // 8. 残りの空き時間にタスクを配置
  const dayEnd = parseTime('20:00', baseDate)
  
  // 空き時間を15分刻みで探してタスクを配置
  let currentTime = new Date(planStart)
  
  const tasksToPlace = [...deepTasks, ...lightTasks]
  
  for (const task of tasksToPlace) {
    let placed = false
    
    while (currentTime < dayEnd && !placed) {
      const taskEnd = new Date(currentTime.getTime() + task.minutes * 60000)
      
      if (taskEnd > dayEnd) break
      
      const taskBlock: ScheduleBlock = {
        start: currentTime,
        end: taskEnd,
        title: task.title,
        type: task.category,
        minutes: task.minutes
      }
      
      if (!checkConflict(taskBlock, blocks)) {
        blocks.push(taskBlock)
        
        const categoryColors: Record<string, string> = {
          future: '#ef4444',
          now: '#3b82f6',
          maintain: '#10b981',
          chore: '#9ca3af'
        }
        
        result.push({
          start: formatTime(taskBlock.start),
          end: formatTime(taskBlock.end),
          title: `${task.title} (${task.minutes}分)`,
          type: task.category,
          color: categoryColors[task.category] || '#9ca3af'
        })
        
        placed = true
        currentTime = taskEnd
      } else {
        currentTime = new Date(currentTime.getTime() + 15 * 60000)
      }
    }
    
    if (!placed) {
      warnings.push(`⚠️ タスク「${task.title}」(${task.minutes}分)を配置できませんでした`)
    }
  }
  
  // 結果を時刻順にソート
  result.sort((a, b) => a.start.localeCompare(b.start))
  
  // 押下時刻とランチ予定時刻を計算
  const pressedHour = t0.getHours()
  const pressedMinute = t0.getMinutes()
  const lunchTime = new Date(t0.getTime() + 6 * 60 * 60000)
  const lunchHour = lunchTime.getHours()
  const lunchMinute = lunchTime.getMinutes()
  
  return c.json({
    schedule: result,
    warnings,
    metadata: {
      planStart: formatTime(planStart),
      generatedAt: new Date().toISOString(),
      pressedTime: `${pressedHour}時${pressedMinute}分`,
      lunchPlannedTime: `${lunchHour}時${lunchMinute}分頃`,
      pressedAt: {
        hour: pressedHour,
        minute: pressedMinute
      },
      lunchPlanned: {
        hour: lunchHour,
        minute: lunchMinute
      }
    }
  })
})

// Frontend
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>未来投資型タスク管理</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          @keyframes pulse-border {
            0%, 100% { border-color: rgb(239, 68, 68); }
            50% { border-color: rgb(252, 165, 165); }
          }
          .urgent-task {
            animation: pulse-border 2s ease-in-out infinite;
            border-width: 2px;
          }
          .category-future { border-left: 4px solid rgb(239, 68, 68); }
          .category-now { border-left: 4px solid rgb(59, 130, 246); }
          .category-maintain { border-left: 4px solid rgb(34, 197, 94); }
          .category-chore { border-left: 4px solid rgb(156, 163, 175); }
        </style>
    </head>
    <body class="bg-gray-50 min-h-screen">
        <div class="container mx-auto px-4 py-8 max-w-6xl">
            <!-- Header -->
            <div class="mb-8">
                <h1 class="text-3xl font-bold text-gray-800 mb-2">
                    <i class="fas fa-rocket mr-2 text-blue-600"></i>
                    未来投資型タスク管理
                </h1>
                <p class="text-gray-600">「目の前の忙しさ」に埋没せず、「未来の売上（種まき）」を確実に実行</p>
            </div>

            <!-- Stats -->
            <div id="statsCards" class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6"></div>

            <!-- Google Calendar Section -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <div class="flex items-center justify-between mb-3">
                    <h2 class="text-xl font-semibold text-gray-800">
                        <i class="fas fa-calendar-alt mr-2 text-blue-600"></i>
                        Googleカレンダー連携
                    </h2>
                    <div class="flex gap-2">
                        <button id="oauthConnect" class="bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg transition">
                            <i class="fab fa-google mr-2"></i>Google接続
                        </button>
                        <button id="oauthDisconnect" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded-lg transition hidden">
                            <i class="fas fa-unlink mr-2"></i>切断
                        </button>
                        <button id="convertAllEvents" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition disabled:opacity-50" disabled>
                            <i class="fas fa-layer-group mr-2"></i>一括タスク化
                        </button>
                        <button id="syncCalendar" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition">
                            <i class="fas fa-sync mr-2"></i>予定を取得
                        </button>
                    </div>
                </div>
                <div id="oauthStatus" class="text-sm mb-3 text-gray-600"></div>
                <div id="calendarEvents" class="space-y-2"></div>
            </div>

            <!-- Schedule Generation Section -->
            <div class="bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg shadow-md p-6 mb-6 border-2 border-purple-200">
                <div class="mb-4">
                    <h2 class="text-xl font-semibold text-gray-800 mb-2">
                        <i class="fas fa-clock mr-2 text-purple-600"></i>
                        本日の予定表を自動生成
                    </h2>
                    <p class="text-sm text-gray-600">食事時間（ランチ・夜ご飯）を自動配置し、タスクを最適なスケジュールに変換します</p>
                </div>

                <!-- Pressed Time Display -->
                <div id="pressedTimeDisplay" class="mb-4 p-3 bg-white rounded-lg border border-purple-200 hidden">
                    <p class="text-sm text-gray-600">
                        <i class="fas fa-hand-pointer mr-2 text-purple-600"></i>
                        <span id="pressedTimeText" class="font-semibold text-purple-700"></span>
                    </p>
                </div>

                <!-- Fixed Events Input -->
                <div class="mb-4">
                    <div class="flex items-center justify-between mb-2">
                        <label class="block text-sm font-medium text-gray-700">
                            今日の固定予定（会食・打合せ・移動など）
                        </label>
                        <button id="loadFromCalendar" 
                                class="text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded transition">
                            <i class="fas fa-cloud-download-alt mr-1"></i>カレンダーから取得
                        </button>
                    </div>
                    <div id="fixedEventsList" class="space-y-2 mb-2">
                        <!-- Fixed events will be added here -->
                    </div>
                    <div class="flex gap-2">
                        <input type="time" id="fixedEventStart" 
                               class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                               placeholder="開始">
                        <input type="time" id="fixedEventEnd" 
                               class="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                               placeholder="終了">
                        <input type="text" id="fixedEventTitle" 
                               class="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                               placeholder="予定名（例: 顧客A社訪問）">
                        <button type="button" id="addFixedEvent" 
                                class="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition">
                            <i class="fas fa-plus"></i>
                        </button>
                    </div>
                </div>

                <button id="generateSchedule" 
                        class="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold py-3 rounded-lg transition shadow-lg">
                    <i class="fas fa-magic mr-2"></i>予定表を生成
                </button>
            </div>

            <!-- Generated Schedule Display -->
            <div id="scheduleDisplay" class="bg-white rounded-lg shadow-md p-6 mb-6 hidden">
                <h2 class="text-xl font-semibold text-gray-800 mb-4">
                    <i class="fas fa-calendar-check mr-2 text-green-600"></i>
                    生成された本日の予定表
                </h2>
                <div id="scheduleWarnings" class="mb-4"></div>
                <div id="scheduleTimeline" class="space-y-1"></div>
            </div>

            <!-- Task Input Form -->
            <div class="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 class="text-xl font-semibold text-gray-800 mb-4">
                    <i class="fas fa-plus-circle mr-2 text-green-600"></i>
                    新しいタスク
                </h2>
                <form id="taskForm" class="space-y-4">
                    <div>
                        <label class="block text-sm font-medium text-gray-700 mb-2">タスク名</label>
                        <input type="text" id="taskTitle" required 
                               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                               placeholder="例: 新規事業提案資料作成">
                    </div>
                    
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">カテゴリ</label>
                            <select id="taskCategory" 
                                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="future">🟥 未来（最優先）</option>
                                <option value="now" selected>🟦 直近の売上</option>
                                <option value="maintain">🟩 維持・ルーティン</option>
                                <option value="chore">⬜ 雑務</option>
                            </select>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">優先度</label>
                            <select id="taskPriority" 
                                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                                <option value="high">🔥 高</option>
                                <option value="medium" selected>⚡ 中</option>
                                <option value="low">☁️ 低</option>
                            </select>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">期日</label>
                            <input type="date" id="taskDueDate" 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">時間（分）</label>
                            <input type="number" id="taskMinutes" value="15" min="1" 
                                   class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500">
                        </div>
                    </div>
                    
                    <button type="submit" 
                            class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition">
                        <i class="fas fa-plus mr-2"></i>タスクを追加
                    </button>
                </form>
            </div>

            <!-- Task List -->
            <div class="bg-white rounded-lg shadow-md p-6">
                <h2 class="text-xl font-semibold text-gray-800 mb-4">
                    <i class="fas fa-tasks mr-2 text-purple-600"></i>
                    タスク一覧
                </h2>
                <div class="grid grid-cols-1 md:grid-cols-7 gap-3 mb-4">
                    <input id="searchInput" type="text" placeholder="検索（タスク名）" class="md:col-span-2 px-3 py-2 border border-gray-300 rounded-lg">
                    <select id="statusFilter" class="px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="all">ステータス: すべて</option>
                        <option value="todo" selected>未完了</option>
                        <option value="done">完了</option>
                    </select>
                    <select id="categoryFilter" class="px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="all">カテゴリ: すべて</option>
                        <option value="future">未来</option>
                        <option value="now">直近</option>
                        <option value="maintain">維持</option>
                        <option value="chore">雑務</option>
                    </select>
                    <select id="priorityFilter" class="px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="all">優先度: すべて</option>
                        <option value="high">高</option>
                        <option value="medium">中</option>
                        <option value="low">低</option>
                    </select>
                    <select id="dueFilter" class="px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="all">期限: すべて</option>
                        <option value="overdue">期限切れ</option>
                        <option value="today">今日まで</option>
                        <option value="three_days">3日以内</option>
                        <option value="week">1週間以内</option>
                        <option value="none">期限なし</option>
                    </select>
                    <select id="sortSelect" class="px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="due_asc" selected>並び: 期日が近い順</option>
                        <option value="priority">並び: 優先度順</option>
                        <option value="due_desc">並び: 期日が遠い順</option>
                        <option value="created_desc">並び: 新しい順</option>
                        <option value="created_asc">並び: 古い順</option>
                    </select>
                </div>
                <div id="taskList" class="space-y-3"></div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
        <script>
          const API_BASE = '/api';
          const calendarEventsCache = [];
          let currentTasks = [];
          const subtasksByTaskId = {};
          const expandedSubtasks = {};

          function escapeHtml(str) {
            return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
          }
          
          function getTaskFilters() {
            return {
              q: document.getElementById('searchInput').value.trim(),
              status: document.getElementById('statusFilter').value,
              category: document.getElementById('categoryFilter').value,
              priority: document.getElementById('priorityFilter').value,
              due: document.getElementById('dueFilter').value,
              sort: document.getElementById('sortSelect').value
            };
          }

          function isOAuthError(error) {
            return error?.response?.status === 401 && error?.response?.data?.authUrl;
          }

          async function loadOAuthStatus() {
            try {
              const res = await axios.get(\`\${API_BASE}/calendar/oauth/status\`);
              const statusEl = document.getElementById('oauthStatus');
              const connectBtn = document.getElementById('oauthConnect');
              const disconnectBtn = document.getElementById('oauthDisconnect');

              if (res.data.mode === 'oauth') {
                if (res.data.connected) {
                  statusEl.textContent = 'OAuth接続済み: 非公開カレンダーを取得できます。';
                  statusEl.className = 'text-sm mb-3 text-green-700';
                  connectBtn.classList.add('hidden');
                  disconnectBtn.classList.remove('hidden');
                } else {
                  statusEl.textContent = 'OAuth未接続: 「Google接続」から認可してください。';
                  statusEl.className = 'text-sm mb-3 text-amber-700';
                  connectBtn.classList.remove('hidden');
                  disconnectBtn.classList.add('hidden');
                }
              } else if (res.data.mode === 'api_key') {
                statusEl.textContent = 'APIキー方式: 公開カレンダーのみ取得可能です。';
                statusEl.className = 'text-sm mb-3 text-blue-700';
                connectBtn.classList.remove('hidden');
                disconnectBtn.classList.add('hidden');
              } else {
                statusEl.textContent = 'Googleカレンダー未設定: OAuth設定またはAPIキー設定が必要です。';
                statusEl.className = 'text-sm mb-3 text-red-700';
                connectBtn.classList.remove('hidden');
                disconnectBtn.classList.add('hidden');
              }
            } catch (error) {
              console.error('Failed to load OAuth status:', error);
            }
          }
          
          // Load tasks
          async function loadTasks() {
            try {
              const filters = getTaskFilters();
              const params = new URLSearchParams();
              Object.entries(filters).forEach(([key, value]) => {
                if (value && value !== 'all') params.append(key, value);
              });
              const response = await axios.get(\`\${API_BASE}/tasks?\${params.toString()}\`);
              renderTasks(response.data);
            } catch (error) {
              console.error('Failed to load tasks:', error);
            }
          }

          // Load task stats
          async function loadStats() {
            try {
              const response = await axios.get(\`\${API_BASE}/tasks/stats\`);
              renderStats(response.data);
            } catch (error) {
              console.error('Failed to load stats:', error);
            }
          }

          function renderStats(stats) {
            const el = document.getElementById('statsCards');
            const cards = [
              { label: '総タスク', value: stats.total, className: 'bg-slate-100 text-slate-800' },
              { label: '未完了', value: stats.todo, className: 'bg-blue-100 text-blue-800' },
              { label: '完了', value: stats.done, className: 'bg-green-100 text-green-800' },
              { label: '完了率', value: stats.completionRate + '%', className: 'bg-indigo-100 text-indigo-800' },
              { label: '期限切れ', value: stats.overdue, className: 'bg-red-100 text-red-800' }
            ];

            el.innerHTML = cards.map(card => \`
              <div class="rounded-lg px-4 py-3 \${card.className}">
                <p class="text-xs font-medium opacity-80">\${card.label}</p>
                <p class="text-2xl font-bold">\${card.value}</p>
              </div>
            \`).join('');
          }
          
          // Calculate days until due
          function calculateDaysUntil(dueDate) {
            if (!dueDate) return null;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const due = new Date(dueDate);
            due.setHours(0, 0, 0, 0);
            const diff = Math.floor((due - today) / (1000 * 60 * 60 * 24));
            return diff;
          }
          
          // Get urgency class and label
          function getUrgencyInfo(dueDate, status) {
            if (!dueDate || status === 'done') return { class: '', label: '' };
            
            const days = calculateDaysUntil(dueDate);
            
            if (days < 0) {
              return { 
                class: 'bg-red-50 urgent-task border-red-500', 
                label: \`⚠️ \${Math.abs(days)}日遅れ\` 
              };
            } else if (days === 0) {
              return { 
                class: 'bg-red-50 urgent-task border-red-500', 
                label: '🔥 今日まで' 
              };
            } else if (days <= 3) {
              return { 
                class: 'bg-red-50 urgent-task border-red-500', 
                label: \`⚡ あと\${days}日\` 
              };
            } else {
              return { 
                class: '', 
                label: \`📅 \${dueDate}\` 
              };
            }
          }
          
          // Render tasks
          function renderTasks(tasks) {
            currentTasks = tasks;
            const taskList = document.getElementById('taskList');
            
            if (tasks.length === 0) {
              taskList.innerHTML = '<p class="text-gray-500 text-center py-8">タスクがありません</p>';
              return;
            }
            
            taskList.innerHTML = tasks.map(task => {
              const urgency = getUrgencyInfo(task.due_date, task.status);
              const isDone = task.status === 'done';
              
              const priorityColors = {
                high: 'bg-red-100 text-red-800',
                medium: 'bg-orange-100 text-orange-800',
                low: 'bg-gray-100 text-gray-600'
              };
              
              const priorityLabels = {
                high: '🔥 高',
                medium: '⚡ 中',
                low: '☁️ 低'
              };
              const priorityKey = priorityLabels[task.priority] ? task.priority : 'medium';
              
              return \`
                <div class="border rounded-lg p-4 category-\${task.category} \${urgency.class} \${isDone ? 'opacity-60' : ''}">
                  <div class="flex items-start gap-3">
                    <button onclick="toggleTask('\${task.id}')" 
                            class="mt-1 w-6 h-6 rounded-full border-2 \${isDone ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-blue-500'} transition flex-shrink-0 flex items-center justify-center">
                      \${isDone ? '<i class="fas fa-check text-white text-xs"></i>' : ''}
                    </button>
                    
                    <div class="flex-1 min-w-0">
                      <div class="flex items-start justify-between gap-2 mb-2">
                        <h3 class="text-lg font-semibold \${isDone ? 'line-through text-gray-500' : 'text-gray-800'}">
                          \${escapeHtml(task.title)}
                        </h3>
                        <div class="flex items-center gap-2">
                          <button onclick="decomposeTask('\${task.id}', '\${escapeHtml(task.title).replace(/'/g, "\\\\&#039;")}')"
                                  class="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-2 py-1 rounded transition">
                            AI分解
                          </button>
                          <button onclick="toggleSubtasks('\${task.id}')" 
                                  class="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 px-2 py-1 rounded transition">
                            \${expandedSubtasks[task.id] ? '閉じる' : '工程表示'}
                          </button>
                          <button onclick="deleteTask('\${task.id}')" 
                                  class="text-red-600 hover:text-red-800 transition flex-shrink-0">
                            <i class="fas fa-trash"></i>
                          </button>
                        </div>
                      </div>
                      
                      <div class="flex flex-wrap gap-2 text-sm">
                        <span class="\${priorityColors[priorityKey]} px-2 py-1 rounded">
                          \${priorityLabels[priorityKey]}
                        </span>
                        <span class="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                          ⏱️ \${task.minutes}分
                        </span>
                        \${urgency.label ? \`<span class="font-semibold text-red-600">\${urgency.label}</span>\` : ''}
                      </div>
                      \${expandedSubtasks[task.id] ? renderSubtaskSection(task.id) : ''}
                    </div>
                  </div>
                </div>
              \`;
            }).join('');
          }

          function renderSubtaskSection(taskId) {
            const subtasks = subtasksByTaskId[taskId] || [];
            if (subtasks.length === 0) {
              return '<div class="mt-3 text-xs text-gray-500">サブタスクなし。AI分解を押してください。</div>';
            }

            return \`
              <div class="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <p class="text-xs font-semibold text-gray-600 mb-2">実行ステップ</p>
                <div class="space-y-1">
                  \${subtasks.map((s) => \`
                    <div class="flex items-center justify-between text-sm bg-white rounded px-2 py-1 border">
                      <button onclick="toggleSubtask('\${s.id}', '\${taskId}')" class="text-left flex-1 \${s.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}">
                        \${s.order_index}. \${escapeHtml(s.title)}
                      </button>
                      <span class="text-xs text-gray-500 ml-2">\${s.minutes}分</span>
                    </div>
                  \`).join('')}
                </div>
              </div>
            \`;
          }

          async function loadSubtasks(taskId) {
            try {
              const res = await axios.get(\`\${API_BASE}/tasks/\${taskId}/subtasks\`);
              subtasksByTaskId[taskId] = res.data;
              renderTasks(currentTasks);
            } catch (error) {
              console.error('Failed to load subtasks:', error);
            }
          }

          window.toggleSubtasks = async (taskId) => {
            expandedSubtasks[taskId] = !expandedSubtasks[taskId];
            if (expandedSubtasks[taskId]) {
              await loadSubtasks(taskId);
            } else {
              renderTasks(currentTasks);
            }
          };

          window.toggleSubtask = async (subtaskId, taskId) => {
            try {
              await axios.post(\`\${API_BASE}/subtasks/\${subtaskId}/toggle\`);
              await loadSubtasks(taskId);
            } catch (error) {
              console.error('Failed to toggle subtask:', error);
            }
          };

          window.decomposeTask = async (taskId, taskTitle) => {
            try {
              const run = confirm(\`「\${taskTitle}」をAIで実行可能ステップに分解しますか？\`);
              if (!run) return;
              await axios.post(\`\${API_BASE}/tasks/\${taskId}/decompose\`, { provider: 'auto' });
              expandedSubtasks[taskId] = true;
              await loadSubtasks(taskId);
              alert('AI分解して保存しました');
            } catch (error) {
              console.error('Failed to decompose task:', error);
              const msg = error?.response?.data?.message || 'AI分解に失敗しました（APIキー設定を確認してください）';
              alert(msg);
            }
          };

          // Filter and search bindings
          let searchTimer = null;
          document.getElementById('searchInput').addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(loadTasks, 250);
          });
          ['statusFilter', 'categoryFilter', 'priorityFilter', 'dueFilter', 'sortSelect'].forEach((id) => {
            document.getElementById(id).addEventListener('change', loadTasks);
          });
          
          // Add task
          document.getElementById('taskForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const task = {
              title: document.getElementById('taskTitle').value,
              category: document.getElementById('taskCategory').value,
              priority: document.getElementById('taskPriority').value,
              due_date: document.getElementById('taskDueDate').value || null,
              minutes: parseInt(document.getElementById('taskMinutes').value)
            };
            
            try {
              await axios.post(\`\${API_BASE}/tasks\`, task);
              document.getElementById('taskForm').reset();
              document.getElementById('taskMinutes').value = '15';
              loadTasks();
              loadStats();
            } catch (error) {
              console.error('Failed to add task:', error);
              alert('タスクの追加に失敗しました');
            }
          });
          
          // Toggle task completion
          async function toggleTask(id) {
            try {
              await axios.post(\`\${API_BASE}/tasks/\${id}/toggle\`);
              loadTasks();
              loadStats();
            } catch (error) {
              console.error('Failed to toggle task:', error);
            }
          }
          
          // Delete task
          async function deleteTask(id) {
            if (!confirm('このタスクを削除しますか？')) return;
            
            try {
              await axios.delete(\`\${API_BASE}/tasks/\${id}\`);
              loadTasks();
              loadStats();
            } catch (error) {
              console.error('Failed to delete task:', error);
            }
          }
          
          // Sync Google Calendar
          document.getElementById('syncCalendar').addEventListener('click', async () => {
            try {
              const response = await axios.get(\`\${API_BASE}/calendar/events\`);
              calendarEventsCache.length = 0;
              response.data.forEach(event => calendarEventsCache.push(event));
              document.getElementById('convertAllEvents').disabled = calendarEventsCache.length === 0;
              renderCalendarEvents(response.data);
            } catch (error) {
              console.error('Failed to sync calendar:', error);
              if (isOAuthError(error)) {
                if (confirm('非公開カレンダー取得にはGoogle OAuth接続が必要です。今すぐ接続しますか？')) {
                  window.location.href = error.response.data.authUrl;
                }
              } else if (error.response?.status === 400) {
                alert('Googleカレンダー連携が未設定です。OAuthまたは環境変数を設定してください。');
              } else {
                alert('カレンダーの取得に失敗しました');
              }
            }
          });

          // Connect/disconnect OAuth
          document.getElementById('oauthConnect').addEventListener('click', () => {
            window.location.href = \`\${API_BASE}/calendar/oauth/start\`;
          });
          document.getElementById('oauthDisconnect').addEventListener('click', async () => {
            try {
              await axios.post(\`\${API_BASE}/calendar/oauth/disconnect\`);
              calendarEventsCache.length = 0;
              document.getElementById('convertAllEvents').disabled = true;
              document.getElementById('calendarEvents').innerHTML = '';
              await loadOAuthStatus();
            } catch (error) {
              console.error('Failed to disconnect oauth:', error);
              alert('OAuth切断に失敗しました');
            }
          });

          // Convert all loaded calendar events to tasks
          document.getElementById('convertAllEvents').addEventListener('click', async () => {
            if (calendarEventsCache.length === 0) {
              alert('先に「予定を取得」を押してください');
              return;
            }

            try {
              const response = await axios.post(\`\${API_BASE}/calendar/convert-all\`, {
                events: calendarEventsCache
              });
              loadTasks();
              loadStats();
              alert(\`一括タスク化完了: 追加 \${response.data.created} 件 / スキップ \${response.data.skipped} 件\`);
            } catch (error) {
              console.error('Failed to convert all events:', error);
              alert('一括タスク化に失敗しました');
            }
          });
          
          // Render calendar events
          function renderCalendarEvents(events) {
            const container = document.getElementById('calendarEvents');
            
            if (events.length === 0) {
              container.innerHTML = '<p class="text-gray-500 text-sm">今後7日間の予定はありません</p>';
              return;
            }
            
            container.innerHTML = events.map(event => {
              const start = new Date(event.start.dateTime || event.start.date);
              const startStr = start.toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              
              return \`
                <div class="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div class="flex-1">
                    <p class="font-medium text-gray-800">\${escapeHtml(event.summary)}</p>
                    <p class="text-sm text-gray-600">\${startStr}</p>
                  </div>
                  <button onclick="convertToTask('\${escapeHtml(event.id)}', '\${escapeHtml(event.summary).replace(/'/g, "\\\\&#039;")}', '\${start.toISOString()}')"
                          class="bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm transition">
                    <i class="fas fa-plus mr-1"></i>タスク化
                  </button>
                </div>
              \`;
            }).join('');
          }
          
          // Convert calendar event to task
          async function convertToTask(eventId, summary, start) {
            try {
              await axios.post(\`\${API_BASE}/calendar/convert\`, {
                summary,
                start,
                category: 'now',
                priority: 'medium',
                minutes: 60
              });
              loadTasks();
              loadStats();
              alert('タスクに追加しました！');
            } catch (error) {
              console.error('Failed to convert event:', error);
              alert('タスクの追加に失敗しました');
            }
          }
          
          // Schedule Generation
          const fixedEvents = [];
          
          // Load fixed events from Google Calendar
          document.getElementById('loadFromCalendar').addEventListener('click', async () => {
            try {
              const response = await axios.get(\`\${API_BASE}/calendar/today\`);
              
              // Clear existing events
              fixedEvents.length = 0;
              
              // Add calendar events
              response.data.forEach(event => {
                fixedEvents.push(event);
              });
              
              renderFixedEvents();
              
              if (fixedEvents.length > 0) {
                alert(\`Googleカレンダーから\${fixedEvents.length}件の予定を取得しました！\`);
              } else {
                alert('今日の予定はありません');
              }
            } catch (error) {
              console.error('Failed to load calendar events:', error);
              if (isOAuthError(error)) {
                if (confirm('非公開カレンダー取得にはGoogle OAuth接続が必要です。今すぐ接続しますか？')) {
                  window.location.href = error.response.data.authUrl;
                }
              } else if (error.response?.status === 400) {
                alert('Googleカレンダー連携が未設定です。OAuthまたは環境変数を設定してください。');
              } else {
                alert('カレンダーの取得に失敗しました');
              }
            }
          });
          
          // Add fixed event
          document.getElementById('addFixedEvent').addEventListener('click', () => {
            const start = document.getElementById('fixedEventStart').value;
            const end = document.getElementById('fixedEventEnd').value;
            const title = document.getElementById('fixedEventTitle').value;
            
            if (!start || !end || !title) {
              alert('全ての項目を入力してください');
              return;
            }
            
            fixedEvents.push({ start, end, title });
            renderFixedEvents();
            
            // Clear inputs
            document.getElementById('fixedEventStart').value = '';
            document.getElementById('fixedEventEnd').value = '';
            document.getElementById('fixedEventTitle').value = '';
          });
          
          // Render fixed events
          function renderFixedEvents() {
            const container = document.getElementById('fixedEventsList');
            
            if (fixedEvents.length === 0) {
              container.innerHTML = '<p class="text-sm text-gray-500 py-2">固定予定なし（任意）</p>';
              return;
            }
            
            container.innerHTML = fixedEvents.map((event, index) => \`
              <div class="flex items-center justify-between p-2 bg-red-50 rounded border border-red-200">
                <div class="flex-1">
                  <span class="font-medium text-gray-800">\${event.title}</span>
                  <span class="text-sm text-gray-600 ml-2">\${event.start} 〜 \${event.end}</span>
                </div>
                <button onclick="removeFixedEvent(\${index})" 
                        class="text-red-600 hover:text-red-800 transition">
                  <i class="fas fa-times"></i>
                </button>
              </div>
            \`).join('');
          }
          
          // Remove fixed event
          window.removeFixedEvent = (index) => {
            fixedEvents.splice(index, 1);
            renderFixedEvents();
          };
          
          // Generate schedule
          document.getElementById('generateSchedule').addEventListener('click', async () => {
            try {
              // Display pressed time
              const now = new Date();
              const pressedHour = now.getHours();
              const pressedMinute = now.getMinutes();
              const lunchTime = new Date(now.getTime() + 6 * 60 * 60000);
              const lunchHour = lunchTime.getHours();
              const lunchMinute = lunchTime.getMinutes();
              
              const pressedTimeDisplay = document.getElementById('pressedTimeDisplay');
              const pressedTimeText = document.getElementById('pressedTimeText');
              pressedTimeText.textContent = \`\${pressedHour}時\${pressedMinute}分に押下 → ランチは\${lunchHour}時\${lunchMinute}分頃を予定\`;
              pressedTimeDisplay.classList.remove('hidden');
              
              const response = await axios.post(\`\${API_BASE}/schedule/generate\`, {
                fixedEvents
              });
              
              renderSchedule(response.data);
              
              // Scroll to schedule
              document.getElementById('scheduleDisplay').scrollIntoView({ behavior: 'smooth' });
            } catch (error) {
              console.error('Failed to generate schedule:', error);
              alert('予定表の生成に失敗しました');
            }
          });
          
          // Render generated schedule
          function renderSchedule(data) {
            const displayDiv = document.getElementById('scheduleDisplay');
            displayDiv.classList.remove('hidden');
            
            // Render metadata (pressed time info)
            const warningsDiv = document.getElementById('scheduleWarnings');
            let metadataHtml = '';
            
            if (data.metadata && data.metadata.pressedTime) {
              metadataHtml = \`
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                  <p class="text-sm text-blue-800">
                    <i class="fas fa-info-circle mr-2"></i>
                    <strong>\${data.metadata.pressedTime}に押下</strong> → ランチは<strong>\${data.metadata.lunchPlannedTime}</strong>を目標に配置
                  </p>
                </div>
              \`;
            }
            
            // Render warnings
            if (data.warnings && data.warnings.length > 0) {
              warningsDiv.innerHTML = metadataHtml + \`
                <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p class="font-semibold text-yellow-800 mb-2">
                    <i class="fas fa-exclamation-triangle mr-2"></i>注意事項
                  </p>
                  <ul class="text-sm text-yellow-700 space-y-1">
                    \${data.warnings.map(w => \`<li>\${w}</li>\`).join('')}
                  </ul>
                </div>
              \`;
            } else {
              warningsDiv.innerHTML = metadataHtml;
            }
            
            // Render schedule timeline
            const timelineDiv = document.getElementById('scheduleTimeline');
            
            const typeIcons = {
              fixed: '📌',
              lunch: '🍽️',
              dinner: '🍽️',
              reply: '✉️',
              family: '👨‍👩‍👧‍👦',
              future: '🚀',
              now: '💼',
              maintain: '🔧',
              chore: '📝'
            };
            
            const typeLabels = {
              fixed: '固定予定',
              lunch: 'ランチ',
              dinner: '夜ご飯',
              reply: '返信枠',
              family: '家族時間',
              future: '未来投資',
              now: '直近売上',
              maintain: '維持',
              chore: '雑務'
            };
            
            timelineDiv.innerHTML = data.schedule.map(slot => {
              const icon = typeIcons[slot.type] || '📅';
              const typeLabel = typeLabels[slot.type] || slot.type;
              
              return \`
                <div class="flex items-center gap-3 p-3 rounded-lg border-l-4 hover:bg-gray-50 transition"
                     style="border-color: \${slot.color};">
                  <div class="text-sm font-mono font-semibold text-gray-600 w-24">
                    \${slot.start} - \${slot.end}
                  </div>
                  <div class="flex-1">
                    <span class="text-lg mr-2">\${icon}</span>
                    <span class="font-medium text-gray-800">\${escapeHtml(slot.title)}</span>
                    <span class="text-xs text-gray-500 ml-2">[\${typeLabel}]</span>
                  </div>
                </div>
              \`;
            }).join('');
          }
          
          // Initial render
          renderFixedEvents();
          
          // Initial load
          loadTasks();
          loadStats();
          loadOAuthStatus();

          const oauthResult = new URLSearchParams(window.location.search).get('oauth');
          if (oauthResult === 'success') {
            alert('Google OAuth接続が完了しました');
            const cleanUrl = window.location.pathname;
            window.history.replaceState({}, '', cleanUrl);
          }
        </script>
    </body>
    </html>
  `)
})

export default app
