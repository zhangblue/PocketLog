import type { AccountLabel, Category, ViewId } from '../domain/types'
import { createFinanceApi, type FinanceApi } from '../api/financeApi'
import { FinanceProvider } from './FinanceProvider'
import { OverviewPage } from '../features/overview/OverviewPage'
import { TransactionsPage } from '../features/transactions/TransactionsPage'
import { AnalyticsPage } from '../features/analytics/AnalyticsPage'
import { MonthlyReportPage } from '../features/reports/MonthlyReportPage'
import { LabelsPage } from '../features/settings/LabelsPage'
import { AppShell } from '../layout/AppShell'

export interface AppProps {
  initialView?: ViewId
  categories?: Category[]
  accounts?: AccountLabel[]
  api?: FinanceApi
}

export function App({ initialView = 'overview', categories, accounts, api }: AppProps) {
  return (
    <FinanceProvider api={api ?? createFinanceApi()} initialView={initialView} initialCategories={categories} initialAccounts={accounts}>
      <AppShell transactionsPage={<TransactionsPage />} analyticsPage={<AnalyticsPage />} reportsPage={<MonthlyReportPage />} labelsPage={<LabelsPage />}><OverviewPage /></AppShell>
    </FinanceProvider>
  )
}
