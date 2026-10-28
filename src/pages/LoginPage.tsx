import { useEffect, useState } from 'react'
import { Lock, User } from 'lucide-react'
import { PIN_LENGTH, useSession } from '../session'

export default function LoginPage() {
  const { login } = useSession()
  const [pin, setPin] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)

  const press = (k: string) => {
    setError(false)
    if (k === '⌫') return setPin((p) => p.slice(0, -1))
    if (k === 'C') return setPin('')
    setPin((p) => (p + k).slice(0, PIN_LENGTH))
  }

  const submit = async () => {
    if (busy || pin.length !== PIN_LENGTH) return
    setBusy(true)
    const ok = await login(pin)
    if (!ok) {
      setError(true)
      setPin('')
      setBusy(false)
    }
  }

  // Physical keyboard support. When the PIN field itself has focus, the input
  // handles digits/backspace natively — appending here as well would double them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === 'Enter') {
        e.preventDefault()
        void submit()
        return
      }
      if (inField) return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') press('⌫')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-white px-4 py-8">
      <div className="w-full max-w-[340px] text-center">
        {/* Brand badge + name */}
        <img
          src="logo.png"
          alt="Subgeo Health Care"
          className="mx-auto mt-4 h-[92px] w-[92px] rounded-full object-cover"
        />
        <p className="mt-2 text-[13px] font-semibold text-[#2f9e44]">Subgeo Health Care</p>

        {/* Username */}
        <div className="mt-6 text-left">
          <label htmlFor="login-name" className="flex items-center gap-1.5 text-[13px] font-semibold text-[#2f9e44]">
            <User size={15} className="text-[#2f9e44]" /> Username
          </label>
          <input
            id="login-name"
            type="text"
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your username"
            className="mt-1 w-full rounded-md border border-slate-200 bg-[#e9e9e9] px-3 py-2 text-[14px] text-slate-700 placeholder:text-slate-400 focus:border-[#2f9e44] focus:outline-none"
          />
        </div>

        {/* Password (staff PIN) */}
        <div className="mt-3 text-left">
          <label htmlFor="login-pin" className="flex items-center gap-1.5 text-[13px] font-semibold text-[#2f9e44]">
            <Lock size={15} className="text-[#2f9e44]" /> Password
          </label>
          <input
            id="login-pin"
            type="password"
            inputMode="numeric"
            autoFocus
            value={pin}
            onChange={(e) => {
              setError(false)
              setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))
            }}
            placeholder={`Enter your ${PIN_LENGTH}-digit staff PIN`}
            className="mt-1 w-full rounded-md border border-slate-200 bg-[#e9e9e9] px-3 py-2 text-[14px] tracking-[0.25em] text-slate-700 placeholder:tracking-normal placeholder:text-slate-400 focus:border-[#2f9e44] focus:outline-none"
          />
          {error ? (
            <p className="mt-1.5 text-[12px] font-medium text-red-500">Wrong PIN, try again</p>
          ) : (
            <p className="mt-1.5 text-[12px] leading-relaxed text-slate-500">
              Enter your {PIN_LENGTH}-digit staff PIN. Ask the owner to create one in Staff.
            </p>
          )}
        </div>

        {/* Login — white pill with green border, matching the old Home button */}
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={submit}
            disabled={pin.length !== PIN_LENGTH || busy}
            className="inline-block w-[104px] rounded-full border-2 border-[#2f9e44] bg-white py-2 text-[13px] font-semibold text-[#2f9e44] transition hover:bg-[#eef9f0] disabled:opacity-50"
          >
            Login
          </button>
        </div>
      </div>
    </div>
  )
}
