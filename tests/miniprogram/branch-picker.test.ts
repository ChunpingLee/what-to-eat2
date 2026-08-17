import { describe, expect, it } from 'vitest'
import { applyBatchResult, createBranchPicker } from '../../miniprogram/components/branch-picker/index'

describe('branch picker model', () => {
  it('allows multiple branches but never selects an existing favorite', () => {
    const model = createBranchPicker(['p1', 'p2', 'p3'], new Set(['p2']))

    model.toggle('p1')
    model.toggle('p3')
    model.toggle('p2')

    expect(model.selected()).toEqual(['p1', 'p3'])
  })

  it('deselects a selected branch when it is tapped again', () => {
    const model = createBranchPicker(['p1'], new Set())

    model.toggle('p1')
    model.toggle('p1')

    expect(model.selected()).toEqual([])
  })

  it('ignores repeated taps for an existing favorite', () => {
    const model = createBranchPicker(['p1'], new Set(['p1']))

    model.toggle('p1')
    model.toggle('p1')

    expect(model.selected()).toEqual([])
  })

  it('keeps successful branches joined when another selected branch fails', () => {
    const branches = [
      { poiId: 'p1', name: '店 A', distanceMeters: 100 },
      { poiId: 'p2', name: '店 B', distanceMeters: 200 },
    ]

    expect(applyBatchResult(branches, {
      created: ['p1'], existing: [], duplicateSelections: [],
      failed: [{ poiId: 'p2', code: 'DATABASE_PERMISSION_DENIED' }],
    })).toEqual([
      { poiId: 'p1', name: '店 A', distanceMeters: 100, status: 'created' },
      { poiId: 'p2', name: '店 B', distanceMeters: 200, status: 'failed', failureCode: 'DATABASE_PERMISSION_DENIED' },
    ])
  })
})
