import type { AccountLabel, Category, Transaction } from './types'

export const augustRecent: Transaction[] = [
  { id: 'tx-0818-coffee', kind: 'expense', amount: 32, categoryId: 'food', accountId: 'wechat', merchant: '山丘咖啡', occurredAt: '2026-08-18T09:42:00+08:00', note: '早餐咖啡' },
  { id: 'tx-0817-ride', kind: 'expense', amount: 46, categoryId: 'transport', accountId: 'alipay', merchant: '城市出行', occurredAt: '2026-08-17T21:16:00+08:00', note: '晚间打车' },
  { id: 'tx-0817-market', kind: 'expense', amount: 128.6, categoryId: 'shopping', accountId: 'wechat', merchant: '鲜生活超市', occurredAt: '2026-08-17T18:30:00+08:00', note: '日用品' },
  { id: 'tx-0816-music', kind: 'expense', amount: 88, categoryId: 'entertainment', accountId: 'bank', merchant: '云海音乐', occurredAt: '2026-08-16T12:00:00+08:00', note: '年度会员' },
  { id: 'tx-0815-salary', kind: 'income', amount: 12500, categoryId: 'salary', accountId: 'bank', merchant: '八月薪资', occurredAt: '2026-08-15T10:00:00+08:00', note: '工资到账' },
]

export const augustEarlier: Transaction[] = [
  { id: 'tx-0814-rent', kind: 'expense', amount: 3200, categoryId: 'housing', accountId: 'bank', merchant: '八月房租', occurredAt: '2026-08-14T08:00:00+08:00', note: '月租' },
  { id: 'tx-0812-grocery', kind: 'expense', amount: 680.4, categoryId: 'food', accountId: 'wechat', merchant: '本月食材', occurredAt: '2026-08-12T18:00:00+08:00', note: '多次采购合计' },
  { id: 'tx-0810-utilities', kind: 'expense', amount: 420, categoryId: 'housing', accountId: 'bank', merchant: '水电燃气', occurredAt: '2026-08-10T09:00:00+08:00', note: '月度账单' },
  { id: 'tx-0808-shopping', kind: 'expense', amount: 899, categoryId: 'shopping', accountId: 'alipay', merchant: '生活购物', occurredAt: '2026-08-08T16:00:00+08:00', note: '本月购物合计' },
  { id: 'tx-0802-travel', kind: 'expense', amount: 1050, categoryId: 'transport', accountId: 'alipay', merchant: '本月交通', occurredAt: '2026-08-02T20:00:00+08:00', note: '周末出行合计' },
  { id: 'tx-0803-dining', kind: 'expense', amount: 298, categoryId: 'food', accountId: 'wechat', merchant: '朋友聚餐', occurredAt: '2026-08-03T19:30:00+08:00', note: '周末聚餐' },
]

export const julyComparison: Transaction[] = [
  { id: 'tx-0730-food', kind: 'expense', amount: 1232, categoryId: 'food', accountId: 'wechat', merchant: '七月餐饮', occurredAt: '2026-07-30T20:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0728-transport', kind: 'expense', amount: 979, categoryId: 'transport', accountId: 'alipay', merchant: '七月交通', occurredAt: '2026-07-28T20:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0726-shopping', kind: 'expense', amount: 1093, categoryId: 'shopping', accountId: 'alipay', merchant: '七月购物', occurredAt: '2026-07-26T20:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0720-housing', kind: 'expense', amount: 4000, categoryId: 'housing', accountId: 'bank', merchant: '七月居住', occurredAt: '2026-07-20T09:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0718-entertainment', kind: 'expense', amount: 165, categoryId: 'entertainment', accountId: 'wechat', merchant: '七月娱乐', occurredAt: '2026-07-18T19:00:00+08:00', note: '分类月度合计' },
  { id: 'tx-0715-salary', kind: 'income', amount: 12500, categoryId: 'salary', accountId: 'bank', merchant: '七月薪资', occurredAt: '2026-07-15T10:00:00+08:00', note: '工资到账' },
]

export const sampleTransactions = [...augustRecent, ...augustEarlier, ...julyComparison]

export const sampleCategories: Category[] = [
  { id: 'food', name: '餐饮', emoji: '🍜', color: '#4f8a75', kind: 'expense', active: true },
  { id: 'transport', name: '交通', emoji: '🚕', color: '#e5a05e', kind: 'expense', active: true },
  { id: 'shopping', name: '购物', emoji: '🛒', color: '#8eb7a7', kind: 'expense', active: true },
  { id: 'entertainment', name: '娱乐', emoji: '🎵', color: '#d6c9ad', kind: 'expense', active: true },
  { id: 'housing', name: '居住', emoji: '⌂', color: '#738f86', kind: 'expense', active: true },
  { id: 'salary', name: '工资', emoji: '💰', color: '#3f7663', kind: 'income', active: true },
]

export const sampleAccounts: AccountLabel[] = [
  { id: 'cash', name: '现金', active: true },
  { id: 'wechat', name: '微信支付', active: true },
  { id: 'alipay', name: '支付宝', active: true },
  { id: 'bank', name: '银行卡', active: true },
]
