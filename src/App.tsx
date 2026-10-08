import { lazy } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/context/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/lib/constants'
import { homeRouteForRole } from '@/lib/navigation'
import { RequireAuth, PublicOnly } from '@/components/auth/RequireAuth'
import { RequireRole } from '@/components/auth/RequireRole'
import { AppShell } from '@/components/layout/AppShell'
import LoginPage from '@/pages/auth/Login'
import ForgotPasswordPage from '@/pages/auth/ForgotPassword'
import ResetPasswordPage from '@/pages/auth/ResetPassword'
import NotFoundPage from '@/pages/NotFound'

const DashboardPage = lazy(() => import('@/pages/Dashboard'))
const VendorList = lazy(() => import('@/pages/vendors/VendorList'))
const VendorDetail = lazy(() => import('@/pages/vendors/VendorDetail'))
const VendorForm = lazy(() => import('@/pages/vendors/VendorForm'))
const BulkImportPage = lazy(() => import('@/pages/vendors/BulkImportPage'))
const WorkingOrdersPage = lazy(() => import('@/pages/mail/WorkingOrdersPage'))
const TeamPage = lazy(() => import('@/pages/TeamPage'))
const ReviewQueue = lazy(() => import('@/pages/review/ReviewQueue'))
const RepGroupList = lazy(() => import('@/pages/rep-groups/RepGroupList'))
const WorldwideContacts = lazy(() => import('@/pages/contacts/WorldwideContacts'))
const RepGroupDetail = lazy(() => import('@/pages/rep-groups/RepGroupDetail'))
const LinesPage = lazy(() => import('@/pages/lines/LinesPage'))
const MergeReport = lazy(() => import('@/pages/review/MergeReport'))
const OrderList = lazy(() => import('@/pages/orders/OrderList'))
const OrderDetail = lazy(() => import('@/pages/orders/OrderDetail'))
const PurchaseOrderList = lazy(() => import('@/pages/purchase-orders/PurchaseOrderList'))
const ReturnList = lazy(() => import('@/pages/returns/ReturnList'))
const ShipmentList = lazy(() => import('@/pages/shipments/ShipmentList'))
const FreightBillList = lazy(() => import('@/pages/freight/FreightBillList'))
const FreightBillDetail = lazy(() => import('@/pages/freight/FreightBillDetail'))
const BuyingShowList = lazy(() => import('@/pages/buying-shows/BuyingShowList'))
const PaymentList = lazy(() => import('@/pages/payments/PaymentList'))
const SalesReportsHub = lazy(() => import('@/pages/sales-reports/SalesReportsHub'))
const ReportList = lazy(() => import('@/pages/reports/ReportList'))
const ProductSourcing = lazy(() => import('@/pages/product-sourcing/ProductSourcing'))
const FileManager = lazy(() => import('@/pages/file-manager/FileManager'))
const SearchPage = lazy(() => import('@/pages/search/SearchPage'))
const UploadInvoice = lazy(() => import('@/pages/upload/UploadInvoice'))
const SettingsLayout = lazy(() => import('@/pages/settings/SettingsLayout'))
const OrganizationSettings = lazy(() => import('@/pages/settings/OrganizationSettings'))
const StoreSettings = lazy(() => import('@/pages/settings/StoreSettings'))
const PlaceholderSettings = lazy(() => import('@/pages/settings/PlaceholderSettings'))
const PartnerSettings = lazy(() => import('@/pages/settings/PartnerSettings'))
const ReviewAssignmentSettings = lazy(() => import('@/pages/settings/ReviewAssignmentSettings'))
const MailSettings = lazy(() => import('@/pages/settings/MailSettings'))
const MailPage = lazy(() => import('@/pages/mail/MailPage'))
const ThreadPage = lazy(() => import('@/pages/mail/ThreadPage'))
const VendorScoresReport = lazy(() => import('@/pages/reports/VendorScoresReport'))

const STAFF = ['admin', 'manager', 'buyer', 'viewer'] as const

/** While a password-recovery session is pending, every protected page routes to the reset form. */
function RecoveryGate({ children }: { children: React.ReactNode }) {
  const { passwordRecoveryPending } = useAuth()
  if (passwordRecoveryPending) return <Navigate to={ROUTES.resetPassword} replace />
  return children
}

/** Uploaders land on their upload screen; everyone else on the dashboard. */
function Home() {
  const { role } = useAuth()
  if (role === 'uploader') return <Navigate to={ROUTES.upload} replace />
  return <DashboardPage />
}

function HomeRedirect() {
  const { role } = useAuth()
  return <Navigate to={homeRouteForRole(role)} replace />
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
              element={
                <RecoveryGate>
                  <AppShell />
                </RecoveryGate>
              }
            >
              <Route path={ROUTES.dashboard} element={<Home />} />

              <Route element={<RequireRole roles={STAFF} />}>
                <Route path={ROUTES.vendors} element={<VendorList />} />
                <Route path={`${ROUTES.vendors}/new`} element={<VendorForm />} />
                <Route path={ROUTES.documentImport} element={<BulkImportPage />} />
                <Route path={`${ROUTES.vendors}/:id`} element={<VendorDetail />} />
                <Route path={`${ROUTES.vendors}/:id/edit`} element={<VendorForm />} />
                <Route path={ROUTES.repGroups} element={<RepGroupList />} />
                <Route path={ROUTES.wwdContacts} element={<WorldwideContacts />} />
                <Route path={`${ROUTES.repGroups}/:id`} element={<RepGroupDetail />} />
                <Route path={ROUTES.lines} element={<LinesPage />} />
                <Route path={ROUTES.review} element={<ReviewQueue />} />
                <Route path={ROUTES.mail} element={<MailPage />} />
                <Route path={ROUTES.workingOrders} element={<WorkingOrdersPage />} />
                <Route path={ROUTES.team} element={<TeamPage />} />
                <Route path={`${ROUTES.mail}/:id`} element={<ThreadPage />} />
                <Route path={ROUTES.mergeReport} element={<MergeReport />} />
                <Route path={ROUTES.orders} element={<OrderList />} />
                <Route path={`${ROUTES.orders}/:id`} element={<OrderDetail />} />
                <Route path={ROUTES.purchaseOrders} element={<PurchaseOrderList />} />
                <Route path={ROUTES.returns} element={<ReturnList />} />
                <Route path={ROUTES.shipments} element={<ShipmentList />} />
                <Route path={ROUTES.freight} element={<FreightBillList />} />
                <Route path={`${ROUTES.freight}/:id`} element={<FreightBillDetail />} />
                <Route path={ROUTES.buyingShows} element={<BuyingShowList />} />
                <Route path={ROUTES.salesReports} element={<SalesReportsHub />} />
                <Route path={ROUTES.reports} element={<ReportList />} />
                <Route path={ROUTES.vendorScores} element={<VendorScoresReport />} />
                <Route path={ROUTES.productSourcing} element={<ProductSourcing />} />
                <Route path={ROUTES.files} element={<FileManager />} />
                <Route path={ROUTES.search} element={<SearchPage />} />
              </Route>

              <Route element={<RequireRole roles={['admin', 'manager']} />}>
                <Route path={ROUTES.payments} element={<PaymentList />} />
              </Route>

              <Route element={<RequireRole roles={['admin']} />}>
                <Route path={ROUTES.settings} element={<SettingsLayout />}>
                  <Route index element={<Navigate to="organization" replace />} />
                  <Route path="organization" element={<OrganizationSettings />} />
                  <Route path="stores" element={<StoreSettings />} />
                  <Route path="worldwide" element={<PartnerSettings />} />
                  <Route path="review-assignments" element={<ReviewAssignmentSettings />} />
                  <Route path="mail" element={<MailSettings />} />
                  <Route path=":tab" element={<PlaceholderSettings />} />
                </Route>
              </Route>

              <Route element={<RequireRole roles={['uploader', 'admin', 'manager']} />}>
                <Route path={ROUTES.upload} element={<UploadInvoice />} />
              </Route>

              <Route path="/home" element={<HomeRedirect />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
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
