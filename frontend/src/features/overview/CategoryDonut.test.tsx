import { describe, expect, it } from 'vitest'
import { render } from '../../test/render'
import { CategoryDonut } from './CategoryDonut'

describe('CategoryDonut', () => {
  it('没有分类数据时展示明确空态', async () => {
    const { container } = await render(<CategoryDonut breakdown={[]} categories={[]} onCategoryClick={() => undefined} />)

    expect(container.textContent).toContain('暂无支出分类数据')
    expect(container.querySelector('[aria-label="支出分类文字图例"]')).toBeNull()
  })
})
