import type { AccountLabel, Category, ViewId } from '../domain/types'
import { createTransactionRepository } from '../data/transactionRepository'
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
  repository?: ReturnType<typeof createTransactionRepository>
}

export function App({ initialView = 'overview', categories, accounts, repository }: AppProps) {
  return (
    <FinanceProvider initialView={initialView} initialCategories={categories} initialAccounts={accounts} repository={repository}>
      <AppShell transactionsPage={<TransactionsPage />} analyticsPage={<AnalyticsPage />} reportsPage={<MonthlyReportPage />} labelsPage={<LabelsPage />}><OverviewPage /></AppShell>
    </FinanceProvider>
  )
}
