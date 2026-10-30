import { useEffect, useState } from 'react'
import { useSession } from './session'
import LoadingScreen from './components/LoadingScreen'
import MedApp from './medapp/MedApp'
import AdminApp from './medapp/AdminApp'
import MedLogin from './medapp/MedLogin'

export default function App() {
  const { user, restoring, dbEpoch } = useSession()
  // Brief loading screen after a successful login, before the medapp shell.
  // Derived during render (not set in an effect) so the shell never flashes first.
  const [bootedFor, setBootedFor] = useState<number>()
  const booting = !!user?.id && bootedFor !== user.id

  useEffect(() => {
    if (!user?.id) {
      setBootedFor(undefined) // signed out: show it again on the next sign-in
      return
    }
    if (bootedFor === user.id) return
    const id = user.id
    const t = setTimeout(() => setBootedFor(id), 5000)
    return () => clearTimeout(t)
  }, [user?.id, bootedFor])

  // All hooks above are called unconditionally every render, so it is safe to
  // branch on their results here.
  if (restoring) return <LoadingScreen />
  if (!user) return <MedLogin />
  if (booting) return <LoadingScreen />

  // The admin (owner) gets the admin shell and can open any chemist; cashiers
  // and managers work in their own chemist. Keyed on the open chemist's
  // database so every screen reloads its data after a switch.
  return user.role === 'owner' ? <AdminApp key={dbEpoch} /> : <MedApp key={dbEpoch} />
}
