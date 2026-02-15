import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

import { API_BASE } from '../config'
const STORAGE_KEY = 'write_password'

interface AuthContextType {
  password: string | null
  setPassword: (pw: string) => void
  clearPassword: () => void
  isAuthenticated: boolean
  verifyPassword: (pw: string) => Promise<boolean>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [password, setPasswordState] = useState<string | null>(null)
  const [isVerified, setIsVerified] = useState(false)

  const setPassword = useCallback((pw: string) => {
    setPasswordState(pw)
    setIsVerified(true)
    localStorage.setItem(STORAGE_KEY, pw)
  }, [])

  const clearPassword = useCallback(() => {
    setPasswordState(null)
    setIsVerified(false)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const verifyPassword = useCallback(async (pw: string): Promise<boolean> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      })
      return res.ok
    } catch {
      return false
    }
  }, [])

  // Verify stored password on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      verifyPassword(stored).then(valid => {
        if (valid) {
          setPasswordState(stored)
          setIsVerified(true)
        } else {
          localStorage.removeItem(STORAGE_KEY)
          setIsVerified(false)
        }
      })
    }
  }, [verifyPassword])

  return (
    <AuthContext.Provider value={{
      password,
      setPassword,
      clearPassword,
      isAuthenticated: isVerified && password !== null,
      verifyPassword,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export function getStoredPassword(): string | null {
  return localStorage.getItem(STORAGE_KEY)
}
