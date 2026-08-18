import type { CategoryBreakdown } from '../../domain/selectors'
import type { Category } from '../../domain/types'

function gradientFor(items: Array<CategoryBreakdown & { color: string }>) {
  let start = 0
  const segments = items.map(item => {
    const end = start + item.ratio * 100
    const segment = `${item.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`
    start = end
    return segment
  })
  return `conic-gradient(${segments.join(', ')})`
}

export function CategoryDonut({
  breakdown,
  categories,
  onCategoryClick,
}: {
  breakdown: CategoryBreakdown[]
  categories: Category[]
  onCategoryClick(categoryId: string): void
}) {
  const items = breakdown.flatMap(item => {
    const category = categories.find(candidate => candidate.id === item.categoryId)
    return category ? [{ ...item, category, color: category.color }] : []
  })

  if (items.length === 0) {
    return <p className="category-empty" role="status">暂无支出分类数据</p>
  }

  return (
    <div className="category-breakdown">
      <div className="category-donut" aria-hidden="true" style={{ background: gradientFor(items) }} />
      <ul className="category-legend" aria-label="支出分类文字图例">
        {items.map(item => (
          <li key={item.categoryId}>
            <button type="button" onClick={() => onCategoryClick(item.categoryId)}>
              <span className="category-color" aria-hidden="true" style={{ background: item.color }} />
              {item.category.name}
              <strong>{Math.round(item.ratio * 100)}%</strong>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
