export interface BranchPickerModel {
  toggle(poiId: string): void
  selected(): string[]
}

/** A UI-independent selection model so existing favorites can never be submitted again. */
export function createBranchPicker(poiIds: readonly string[], existing: ReadonlySet<string>): BranchPickerModel {
  const allowed = new Set(poiIds.filter(poiId => !existing.has(poiId)))
  const selection = new Set<string>()

  return {
    toggle(poiId) {
      if (!allowed.has(poiId)) return
      if (selection.has(poiId)) selection.delete(poiId)
      else selection.add(poiId)
    },
    selected() { return [...selection] },
  }
}

export interface BranchItem {
  poiId: string
  name: string
  address?: string
  businessArea?: string
  distanceMeters: number
  status?: 'created' | 'existing' | 'failed'
  failureCode?: string
}

export interface FavoriteBatchResult {
  created: string[]
  existing: string[]
  duplicateSelections: string[]
  failed: Array<{ poiId: string; code: string }>
}

export function applyBatchResult(items: readonly BranchItem[], result: FavoriteBatchResult): BranchItem[] {
  const created = new Set(result.created)
  const existing = new Set(result.existing)
  const failed = new Map(result.failed.map(item => [item.poiId, item.code]))
  return items.map(item => {
    if (created.has(item.poiId)) return { ...item, status: 'created' }
    if (existing.has(item.poiId)) return { ...item, status: 'existing' }
    const failureCode = failed.get(item.poiId)
    return failureCode ? { ...item, status: 'failed', failureCode } : item
  })
}

interface ToggleEvent {
  currentTarget: { dataset: { poiId?: unknown } }
}

interface BranchPickerComponent {
  properties: { items: BranchItem[]; selectedPoiIds: string[] }
  triggerEvent(name: 'change', detail: { poiIds: string[] }): void
  onToggle(event: ToggleEvent): void
}

if (typeof Component === 'function') {
  Component<BranchPickerComponent>({
    properties: {
      items: { type: Array, value: [] },
      selectedPoiIds: { type: Array, value: [] },
    },
    methods: {
      onToggle(this: BranchPickerComponent, event: ToggleEvent) {
        const poiId = event.currentTarget.dataset.poiId
        if (typeof poiId !== 'string') return

        const existing = new Set(this.properties.items
          .filter(item => item.status === 'created' || item.status === 'existing')
          .map(item => item.poiId))
        const model = createBranchPicker(this.properties.items.map(item => item.poiId), existing)
        for (const selectedPoiId of this.properties.selectedPoiIds) model.toggle(selectedPoiId)
        model.toggle(poiId)
        this.triggerEvent('change', { poiIds: model.selected() })
      },
    },
  })
}
