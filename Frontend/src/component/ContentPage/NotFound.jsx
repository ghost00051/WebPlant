import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import Breadcrumbs from './Breadcrumbs.jsx'
import { markPageAsNotFound } from '../../utils/seo.js'

function NotFound({ backPath, backLabel, message }) {
    useEffect(() => markPageAsNotFound(), [])

    return (
        <>
            <Breadcrumbs items={[{ label: backLabel, path: backPath }]} />
            <div className='contentHero'>
                <h1>Страница не найдена</h1>
                <p className='contentLead'>{message}</p>
            </div>
            <div className='contentCta'>
                <p>Все материалы раздела доступны по ссылке ниже.</p>
                <Link to={backPath}>{backLabel}</Link>
            </div>
        </>
    )
}

export default NotFound
