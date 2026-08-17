import { createHash } from 'node:crypto'

export type AccountStatus = 'active' | 'deleting'

export interface AccountState {
  _id: string
  _openid: string
  status: AccountStatus
  updatedAt: string
}

export interface TransactionDocument {
  get(): Promise<{ data: unknown[] }>
  set(options: { data: Record<string, unknown> }): Promise<unknown>
  remove(): Promise<unknown>
}

export interface AccountTransaction {
  collection(name: string): { doc(id: string): TransactionDocument }
}

export class AccountDeletingError extends Error {
  readonly code = 'ACCOUNT_DELETING'
  constructor() {
    super('ACCOUNT_DELETING')
    this.name = 'AccountDeletingError'
  }
}

export function accountDocumentId(openid: string) {
  return createHash('sha256').update(openid).digest('hex')
}

export async function ensureAccountWritable(transaction: AccountTransaction, openid: string, updatedAt: string) {
  const id = accountDocumentId(openid)
  const document = transaction.collection('users').doc(id)
  const result = await document.get()
  const state = result.data[0] as { status?: unknown } | undefined
  if (state?.status === 'deleting') throw new AccountDeletingError()
  if (!state) {
    await document.set({ data: { _id: id, _openid: openid, status: 'active', updatedAt } })
  }
}
