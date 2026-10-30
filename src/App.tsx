import { useEffect, useState } from 'react'
import { useSession } from './session'
import LoadingScreen from './components/LoadingScreen'
import MedApp from './medapp/MedApp'
import AdminApp from './medapp/AdminApp'
import MedLogin from './medapp/MedLogin'

export default function App() {
  const { user, restoring, dbEpoch } = useSession()
  const [booting, setBooting] = useState(false)

  // Brief loading screen after a successful login, before the medapp shell.
  useEffect(() => {
    if (!user?.id) return
    setBooting(true)
    const t = setTimeout(() => setBooting(false), 5000)
    return () => clearTimeout(t)
  }, [user?.id])

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
