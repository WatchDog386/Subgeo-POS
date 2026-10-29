import { useEffect, useState } from 'react'
import { useSession } from './session'
import LoadingScreen from './components/LoadingScreen'
import MedApp from './medapp/MedApp'
import AdminApp from './medapp/AdminApp'
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

  // Admin signs in to the admin shell (To-Do List home); everyone else
  // (cashier / owner) uses the medapp shell.
  return user.name.toUpperCase() === 'ADMIN' ? <AdminApp /> : <MedApp />
}
