import { useCallback, useState } from 'react'
import type { Profile } from '../types'

const KEY = 'webshare:profile'

/** Per-device identity in localStorage. null until first-run setup is done. */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return null
      const p = JSON.parse(raw) as Profile
      return typeof p?.name === 'string' && p.name.trim() ? p : null
    } catch {
      return null
    }
  })

  const save = useCallback(async (p: Profile) => {
    localStorage.setItem(KEY, JSON.stringify(p))
    setProfile(p)
  }, [])

  /** Wipe the device identity — drops back to the welcome window. */
  const reset = useCallback(() => {
    localStorage.removeItem(KEY)
    setProfile(null)
  }, [])

  return { profile, save, reset }
}
