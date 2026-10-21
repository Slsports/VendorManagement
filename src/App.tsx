import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from '@/context/AuthContext'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/lib/constants'
import { homeRouteForRole } from '@/lib/navigation'
import { RequireAuth, PublicOnly } from '@/components/auth/RequireAuth'
import { RequireRole } from '@/components/auth/RequireRole'
import { RequireAccounting } from '@/components/auth/RequireAccounting'
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
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'))
const AccountingHome = lazy(() => import('@/pages/accounting/AccountingHome'))
const AccountingMailPage = lazy(() => import('@/pages/accounting/AccountingMailPage'))
const AccountingContactsPage = lazy(() => import('@/pages/accounting/AccountingContactsPage'))
const AccountingContactPage = lazy(() => import('@/pages/accounting/AccountingContactPage'))
const AccountingTasksPage = lazy(() => import('@/pages/accounting/AccountingTasksPage'))
const AccountingCalendarPage = lazy(() => import('@/pages/accounting/AccountingCalendarPage'))
const ProceduresPage = lazy(() => import('@/pages/accounting/ProceduresPage'))
const ProcedurePage = lazy(() => import('@/pages/accounting/ProcedurePage'))
const InsurancePage = lazy(() => import('@/pages/accounting/InsurancePage'))
const PolicyPage = lazy(() => import('@/pages/accounting/PolicyPage'))
const RecipientPage = lazy(() => import('@/pages/accounting/RecipientPage'))
const ContractsPage = lazy(() => import('@/pages/accounting/ContractsPage'))
const ContractPage = lazy(() => import('@/pages/accounting/ContractPage'))
const AccountingDocumentsPage = lazy(() => import('@/pages/accounting/AccountingDocumentsPage'))
const InventoryCountPage = lazy(() => import('@/pages/inventory/InventoryCountPage'))
const ItemNamesPage = lazy(() => import('@/pages/inventory/ItemNamesPage'))
const ReviewQueue = lazy(() => import('@/pages/review/ReviewQueue'))
const RepGroupList = lazy(() => import('@/pages/rep-groups/RepGroupList'))
const WorldwideContacts = lazy(() => import('@/pages/contacts/WorldwideContacts'))
const RepGroupDetail = lazy(() => import('@/pages/rep-groups/RepGroupDetail'))
const LinesPage = lazy(() => import('@/pages/lines/LinesPage'))
const MergeReport = lazy(() => import('@/pages/review/MergeReport'))
const OrderList = lazy(() => import('@/pages/orders/OrderList'))
const OrderDetail = lazy(() => import('@/pages/orders/OrderDetail'))
const OrderEdit = lazy(() => import('@/pages/orders/OrderEdit'))
const PurchaseOrderList = lazy(() => import('@/pages/purchase-orders/PurchaseOrderList'))
const ReturnList = lazy(() => import('@/pages/returns/ReturnList'))
const ShipmentList = lazy(() => import('@/pages/shipments/ShipmentList'))
const FreightBillList = lazy(() => import('@/pages/freight/FreightBillList'))
const FreightBillDetail = lazy(() => import('@/pages/freight/FreightBillDetail'))
const CarrierPage = lazy(() => import('@/pages/freight/CarrierPage'))
const RoutingReceipt = lazy(() => import('@/pages/public/RoutingReceipt'))
const VendorConfirmForm = lazy(() => import('@/pages/public/VendorConfirmForm'))
const ContactConfirmationsPage = lazy(() => import('@/pages/vendors/ContactConfirmationsPage'))
const RoutingLetterPage = lazy(() => import('@/pages/freight/RoutingLetterPage'))
const FreightQuoteList = lazy(() => import('@/pages/freight/FreightQuoteList'))
const FreightQuoteDetail = lazy(() => import('@/pages/freight/FreightQuoteDetail'))
const BuyingShowList = lazy(() => import('@/pages/buying-shows/BuyingShowList'))
const PaymentList = lazy(() => import('@/pages/payments/PaymentList'))
const SalesReportsHub = lazy(() => import('@/pages/sales-reports/SalesReportsHub'))
const ReportList = lazy(() => import('@/pages/reports/ReportList'))
const ProductSourcing = lazy(() => import('@/pages/product-sourcing/ProductSourcing'))
const FileManager = lazy(() => import('@/pages/file-manager/FileManager'))
const SearchPage = lazy(() => import('@/pages/search/SearchPage'))
const UploadInvoice = lazy(() => import('@/pages/upload/UploadInvoice'))
const LsPoPage = lazy(() => import('@/pages/orders/LsPoPage'))
const HelpPage = lazy(() => import('@/pages/help/HelpPage'))
const TasksPage = lazy(() => import('@/pages/tasks/TasksPage'))
const SuppliesPage = lazy(() => import('@/pages/supplies/SuppliesPage'))
const SettingsLayout = lazy(() => import('@/pages/settings/SettingsLayout'))
const OrganizationSettings = lazy(() => import('@/pages/settings/OrganizationSettings'))
const StoreSettings = lazy(() => import('@/pages/settings/StoreSettings'))
const PlaceholderSettings = lazy(() => import('@/pages/settings/PlaceholderSettings'))
const UserSettings = lazy(() => import('@/pages/settings/UserSettings'))
const PartnerSettings = lazy(() => import('@/pages/settings/PartnerSettings'))
const ReviewAssignmentSettings = lazy(() => import('@/pages/settings/ReviewAssignmentSettings'))
const MailSettings = lazy(() => import('@/pages/settings/MailSettings'))
const LightspeedSettings = lazy(() => import('@/pages/settings/LightspeedSettings'))
const LightspeedCallback = lazy(() => import('@/pages/settings/LightspeedCallback'))
const BillcomSettings = lazy(() => import('@/pages/settings/BillcomSettings'))
const MailPage = lazy(() => import('@/pages/mail/MailPage'))
const ThreadPage = lazy(() => import('@/pages/mail/ThreadPage'))
const MailWithPage = lazy(() => import('@/pages/mail/MailWithPage'))
const OrderCheckPage = lazy(() => import('@/pages/orders/OrderCheckPage'))
const VendorScoresReport = lazy(() => import('@/pages/reports/VendorScoresReport'))
const PoUseReport = lazy(() => import('@/pages/reports/PoUseReport'))

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
          {/* vendors' pages from our emails: no login (Dana, Oct 13) */}
          <Route path={`${ROUTES.routingReceipt}/:token`} element={<Suspense fallback={null}><RoutingReceipt /></Suspense>} />
          <Route path={`${ROUTES.vendorConfirm}/:token`} element={<Suspense fallback={null}><VendorConfirmForm /></Suspense>} />
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
                <Route path={ROUTES.contactConfirmations} element={<ContactConfirmationsPage />} />
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
                <Route path={ROUTES.mailWith} element={<MailWithPage />} />
                <Route path={ROUTES.team} element={<TeamPage />} />
                <Route path={ROUTES.tasks} element={<TasksPage />} />
                <Route path={ROUTES.supplies} element={<SuppliesPage />} />
                <Route path={ROUTES.notifications} element={<NotificationsPage />} />
                <Route path={`${ROUTES.mail}/:id`} element={<ThreadPage />} />
                <Route path={ROUTES.mergeReport} element={<MergeReport />} />
                <Route path={ROUTES.orders} element={<OrderList />} />
                <Route path={`${ROUTES.orderChecks}/:id`} element={<OrderCheckPage />} />
                <Route path={`${ROUTES.lsPos}/:id`} element={<LsPoPage />} />
                <Route path={`${ROUTES.orders}/:id`} element={<OrderDetail />} />
                <Route path={`${ROUTES.orders}/:id/edit`} element={<OrderEdit />} />
                <Route path={ROUTES.purchaseOrders} element={<PurchaseOrderList />} />
                <Route path={ROUTES.returns} element={<ReturnList />} />
                <Route path={ROUTES.shipments} element={<ShipmentList />} />
                <Route path={ROUTES.freight} element={<FreightBillList />} />
                <Route path={`${ROUTES.freightCarriers}/:id`} element={<CarrierPage />} />
                <Route path={ROUTES.freightQuotes} element={<FreightQuoteList />} />
                <Route path={ROUTES.routingLetter} element={<RoutingLetterPage />} />
                <Route path={`${ROUTES.freightQuotes}/:id`} element={<FreightQuoteDetail />} />
                <Route path={`${ROUTES.freight}/:id`} element={<FreightBillDetail />} />
                <Route path={ROUTES.buyingShows} element={<BuyingShowList />} />
                <Route path={ROUTES.salesReports} element={<SalesReportsHub />} />
                <Route path={`${ROUTES.inventoryCounts}/:id`} element={<InventoryCountPage />} />
                <Route path={ROUTES.itemNames} element={<ItemNamesPage />} />
                <Route path={ROUTES.reports} element={<ReportList />} />
                <Route path={ROUTES.vendorScores} element={<VendorScoresReport />} />
                <Route path={ROUTES.poUse} element={<PoUseReport />} />
                <Route path={ROUTES.productSourcing} element={<ProductSourcing />} />
                <Route path={ROUTES.files} element={<FileManager />} />
                <Route path={ROUTES.search} element={<SearchPage />} />
              </Route>

              <Route element={<RequireRole roles={['admin', 'manager']} />}>
                <Route path={ROUTES.payments} element={<PaymentList />} />
              </Route>

              <Route element={<RequireAccounting />}>
                <Route path={ROUTES.accounting} element={<AccountingHome />} />
                <Route path={ROUTES.accountingMail} element={<AccountingMailPage />} />
                <Route path={ROUTES.accountingContacts} element={<AccountingContactsPage />} />
                <Route path={`${ROUTES.accountingContacts}/:id`} element={<AccountingContactPage />} />
                <Route path={ROUTES.accountingTasks} element={<AccountingTasksPage />} />
                <Route path={ROUTES.accountingCalendar} element={<AccountingCalendarPage />} />
                <Route path={ROUTES.accountingProcedures} element={<ProceduresPage />} />
                <Route path={`${ROUTES.accountingProcedures}/:id`} element={<ProcedurePage />} />
                <Route path={ROUTES.accountingInsurance} element={<InsurancePage />} />
                <Route path={`${ROUTES.accountingInsurance}/who/:id`} element={<RecipientPage />} />
                <Route path={`${ROUTES.accountingInsurance}/:id`} element={<PolicyPage />} />
                <Route path={ROUTES.accountingContracts} element={<ContractsPage />} />
                <Route path={`${ROUTES.accountingContracts}/:id`} element={<ContractPage />} />
                <Route path={ROUTES.accountingDocuments} element={<AccountingDocumentsPage />} />
              </Route>

              <Route element={<RequireRole roles={['admin']} />}>
                <Route path={ROUTES.settings} element={<SettingsLayout />}>
                  <Route index element={<Navigate to="organization" replace />} />
                  <Route path="organization" element={<OrganizationSettings />} />
                  <Route path="stores" element={<StoreSettings />} />
                  <Route path="users" element={<UserSettings />} />
                  <Route path="notifications" element={<NotificationsPage embedded />} />
                  <Route path="worldwide" element={<PartnerSettings />} />
                  <Route path="review-assignments" element={<ReviewAssignmentSettings />} />
                  <Route path="mail" element={<MailSettings />} />
                  <Route path="lightspeed" element={<LightspeedSettings />} />
                  <Route path="billcom" element={<BillcomSettings />} />
                  <Route path=":tab" element={<PlaceholderSettings />} />
                </Route>
                <Route path={ROUTES.lightspeedCallback} element={<LightspeedCallback />} />
              </Route>

              <Route element={<RequireRole roles={['uploader', 'admin', 'manager', 'buyer']} />}>
                <Route path={ROUTES.upload} element={<UploadInvoice />} />
              </Route>

              <Route path={ROUTES.help} element={<HelpPage />} />
              <Route path={`${ROUTES.help}/:slug`} element={<HelpPage />} />
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
