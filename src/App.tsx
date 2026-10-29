import { useEffect, useState } from 'react'
import { useSession } from './session'
import LoadingScreen from './components/LoadingScreen'
import MedApp from './medapp/MedApp'
import MedLogin from './medapp/MedLogin'

export default function App() {
  const { user, restoring } = useSession()
  const [booting, setBooting] = useState(false)

  // Brief loading screen after a successful login, before the medapp shell.
  useEffect(() => {
    if (!user) return
    setBooting(true)
    const t = setTimeout(() => setBooting(false), 5000)
    return () => clearTimeout(t)
  }, [user])

  // All hooks above are called unconditionally every render, so it is safe to
  // branch on their results here.
  if (restoring) return <LoadingScreen />
  if (!user) return <MedLogin />
  if (booting) return <LoadingScreen />

  // Single till shell for every logged-in role (cashier, manager, owner).
  // A dedicated admin dashboard does not exist yet — it will be built when
  // requested.
  return <MedApp />
}
