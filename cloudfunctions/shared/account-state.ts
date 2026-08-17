import { createHash } from 'node:crypto'

export type AccountStatus = 'active' | 'deleting'

export interface AccountState {
  _id: string
  _openid: string
  status: AccountStatus
  updatedAt: string
}

export interface TransactionDocument {
  get(): Promise<{ data: unknown }>
  set(documentBody: Record<string, unknown>): Promise<unknown>
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

export function accountStateFromDocumentData(data: unknown): { status?: unknown } | undefined {
  const first = Array.isArray(data) ? data[0] : data
  if (typeof first !== 'object' || first === null || Array.isArray(first)) return undefined
  const record = first as Record<string, unknown>
  if (typeof record.data === 'object' && record.data !== null && !Array.isArray(record.data)) {
    return record.data as { status?: unknown }
  }
  return record
}

export async function ensureAccountWritable(transaction: AccountTransaction, openid: string, updatedAt: string) {
  const id = accountDocumentId(openid)
  const document = transaction.collection('users').doc(id)
  const result = await document.get()
  const state = accountStateFromDocumentData(result.data)
  if (state?.status === 'deleting') throw new AccountDeletingError()
  if (!state) {
    await document.set({ _id: id, _openid: openid, status: 'active', updatedAt })
  }
}
