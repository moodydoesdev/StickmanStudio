import type { ElevenVoice, VoiceFilters, VoiceSearchResult } from '../../shared/types'
import { loadConfig } from './config'

const BASE = 'https://api.elevenlabs.io'

function apiKey(): string | undefined {
  return (loadConfig().elevenlabsApiKey || process.env.ELEVENLABS_API_KEY)?.trim()
}

function headers(key: string): Record<string, string> {
  return { 'xi-api-key': key, accept: 'application/json' }
}

function pick(o: any, ...keys: string[]): string | undefined {
  for (const k of keys) if (o && o[k]) return String(o[k])
  return undefined
}

/** The user's own/saved voices (small list, filtered client-side). */
export async function listVoices(): Promise<VoiceSearchResult> {
  const key = apiKey()
  if (!key) return { ok: false, error: 'No ElevenLabs API key saved — add it first.' }
  try {
    const res = await fetch(`${BASE}/v1/voices`, { headers: headers(key) })
    if (!res.ok) return { ok: false, error: errMsg(res.status, await res.text().catch(() => '')) }
    const data = (await res.json()) as { voices?: any[] }
    const voices: ElevenVoice[] = (data.voices || []).map((v) => {
      const l = v.labels || {}
      return {
        id: v.voice_id,
        name: v.name,
        category: v.category,
        description: v.description || l.description || undefined,
        previewUrl: v.preview_url || undefined,
        gender: pick(l, 'gender'),
        age: pick(l, 'age'),
        accent: pick(l, 'accent'),
        useCase: pick(l, 'use_case', 'use case', 'usecase'),
        shared: false
      }
    })
    return { ok: true, voices }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** The full public ElevenLabs Voice Library, with server-side filters + paging. */
export async function searchVoices(filters: VoiceFilters, page = 0): Promise<VoiceSearchResult> {
  const key = apiKey()
  if (!key) return { ok: false, error: 'No ElevenLabs API key saved — add it first.' }
  const PAGE_SIZE = 30
  const q = new URLSearchParams()
  q.set('page_size', String(PAGE_SIZE))
  q.set('page', String(page))
  if (filters.search) q.set('search', filters.search)
  if (filters.language) q.set('language', filters.language)
  if (filters.gender) q.set('gender', filters.gender)
  if (filters.age) q.set('age', filters.age)
  if (filters.accent) q.set('accent', filters.accent)
  if (filters.category) q.set('category', filters.category)
  if (filters.useCase) q.set('use_cases', filters.useCase)
  try {
    const res = await fetch(`${BASE}/v1/shared-voices?${q.toString()}`, { headers: headers(key) })
    if (!res.ok) return { ok: false, error: errMsg(res.status, await res.text().catch(() => '')) }
    const data = (await res.json()) as { voices?: any[]; has_more?: boolean }
    const voices: ElevenVoice[] = (data.voices || []).map((v) => ({
      id: v.voice_id,
      name: v.name,
      category: v.category,
      description: v.description || undefined,
      previewUrl: v.preview_url || undefined,
      gender: v.gender || undefined,
      age: v.age || undefined,
      accent: v.accent || undefined,
      language: v.language || undefined,
      useCase: v.use_case || undefined,
      publicOwnerId: v.public_owner_id || undefined,
      shared: true
    }))
    return { ok: true, voices, hasMore: !!data.has_more }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** Add a public library voice to the user's account; returns the usable voice id. */
export async function addVoice(
  publicOwnerId: string,
  voiceId: string,
  name: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = apiKey()
  if (!key) return { ok: false, error: 'No ElevenLabs API key saved.' }
  try {
    const res = await fetch(`${BASE}/v1/voices/add/${publicOwnerId}/${voiceId}`, {
      method: 'POST',
      headers: { ...headers(key), 'content-type': 'application/json' },
      body: JSON.stringify({ new_name: name })
    })
    const data = (await res.json().catch(() => ({}))) as any
    if (!res.ok) {
      // Already in the library is fine — fall back to the original id.
      const detail = JSON.stringify(data).toLowerCase()
      if (detail.includes('already')) return { ok: true, id: voiceId }
      return { ok: false, error: data?.detail?.message || errMsg(res.status, JSON.stringify(data)) }
    }
    return { ok: true, id: data.voice_id || voiceId }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}

function errMsg(status: number, body: string): string {
  if (status === 401) return 'Invalid ElevenLabs API key.'
  return `ElevenLabs API error ${status}: ${body.slice(0, 200)}`
}
