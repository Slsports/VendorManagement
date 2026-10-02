import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/context/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/lib/constants'
import { RequireAuth, PublicOnly } from '@/components/auth/RequireAuth'
import LoginPage from '@/pages/auth/Login'
import ForgotPasswordPage from '@/pages/auth/ForgotPassword'
import ResetPasswordPage from '@/pages/auth/ResetPassword'
import DashboardPage from '@/pages/Dashboard'
import NotFoundPage from '@/pages/NotFound'

/** While a password-recovery session is pending, every protected page routes to the reset form. */
function RecoveryGate({ children }: { children: React.ReactNode }) {
  const { passwordRecoveryPending } = useAuth()
  if (passwordRecoveryPending) return <Navigate to={ROUTES.resetPassword} replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<PublicOnly />}>
            <Route path={ROUTES.login} element={<LoginPage />} />
            <Route path={ROUTES.forgotPassword} element={<ForgotPasswordPage />} />
          </Route>

          <Route element={<RequireAuth />}>
            <Route path={ROUTES.resetPassword} element={<ResetPasswordPage />} />
            <Route
              path={ROUTES.dashboard}
              element={
                <RecoveryGate>
                  <DashboardPage />
                </RecoveryGate>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
        <Toaster
          position="top-right"
          toastOptions={{
            style: { borderRadius: '0.75rem', fontSize: '0.875rem' },
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  )
}
