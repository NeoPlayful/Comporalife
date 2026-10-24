import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ui/ErrorBoundary';
import LoadingState from './components/ui/LoadingState';
import AppLayout from './components/layout/AppLayout';
import AuthGuard from './components/layout/AuthGuard';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import LoginPage from './pages/auth/LoginPage';
import RegisterPage from './pages/auth/RegisterPage';
import ResetPasswordPage from './pages/auth/ResetPasswordPage';
import NotFoundPage from './pages/NotFoundPage';
const AccountDetailPage = lazy(() => import('./pages/AccountDetailPage'));
const AccountsPage = lazy(() => import('./pages/AccountsPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const BudgetsPage = lazy(() => import('./pages/BudgetsPage'));
const PortfoliosPage = lazy(() => import('./pages/PortfoliosPage'));
const PortfolioDetailPage = lazy(() => import('./pages/PortfolioDetailPage'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const CompoundPage = lazy(() => import('./pages/CompoundPage'));
const MonteCarloPage = lazy(() => import('./pages/MonteCarloPage'));
const GoalsPage = lazy(() => import('./pages/GoalsPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const ImportsPage = lazy(() => import('./pages/ImportsPage'));
const ImportNewPage = lazy(() => import('./pages/ImportNewPage'));
const ImportWorkbenchPage = lazy(() => import('./pages/ImportWorkbenchPage'));
const RulesPage = lazy(() => import('./pages/RulesPage'));
const UnmatchedPage = lazy(() => import('./pages/UnmatchedPage'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<AuthGuard />}>
        <Route path="/" element={
            <ErrorBoundary>
              <Suspense fallback={<LoadingState />}>
                <AppLayout />
              </Suspense>
            </ErrorBoundary>
          }>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="accounts" element={<AccountsPage />} />
          <Route path="accounts/:id" element={<AccountDetailPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="budgets" element={<BudgetsPage />} />
          <Route path="portfolios" element={<PortfoliosPage />} />
          <Route path="portfolios/:id" element={<PortfolioDetailPage />} />
          <Route path="imports" element={<ImportsPage />} />
          <Route path="imports/new" element={<ImportNewPage />} />
          <Route path="imports/rules" element={<RulesPage />} />
          <Route path="imports/unmatched" element={<UnmatchedPage />} />
          <Route path="imports/:id" element={<ImportWorkbenchPage />} />
          <Route path="categories" element={<CategoriesPage />} />
          <Route path="compound" element={<CompoundPage />} />
          <Route path="monte-carlo" element={<MonteCarloPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
