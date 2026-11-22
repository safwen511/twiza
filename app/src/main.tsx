import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const Dashboard = lazy(() => import('./dashboard/Dashboard'))
const FarmerApp = lazy(() => import('./farmer/FarmerApp'))
const isFarmer = location.pathname.startsWith('/farmer')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>{isFarmer ? <FarmerApp /> : <Dashboard />}</Suspense>
  </StrictMode>,
)
