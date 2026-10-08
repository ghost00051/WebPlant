import { Link } from 'react-router-dom'
import { HOME_PATH } from '../../data/siteMap.js'

function Breadcrumbs({ items }) {
    const trail = [{ label: 'Главная', path: HOME_PATH }, ...items]

    return (
        <nav className='contentBreadcrumbs' aria-label='Навигационная цепочка'>
            <ol>
                {trail.map((item, index) => {
                    const isLast = index === trail.length - 1
                    return (
                        <li key={`${item.label}-${index}`}>
                            {item.path && !isLast
                                ? <Link to={item.path}>{item.label}</Link>
                                : <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>}
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}

export default Breadcrumbs
