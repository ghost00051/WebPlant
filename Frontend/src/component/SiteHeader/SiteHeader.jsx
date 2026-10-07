import { Link } from 'react-router-dom'
import LogoMark from '../../assets/LogoMark.svg'
import { MAIN_NAV, HOME_PATH } from '../../data/siteMap.js'
import './SiteHeader.css'

function SiteHeader({ activePath }) {
    return (
        <header className='siteHeader'>
            <Link className='siteHeaderBrand' to={HOME_PATH} aria-label='Лейка — на главную'>
                <img src={LogoMark} alt='' />
                <span>Лейка</span>
            </Link>
            <nav className='siteHeaderNav' aria-label='Разделы сайта'>
                {MAIN_NAV.map(item => (
                    <Link
                        key={item.path}
                        to={item.path}
                        className={activePath === item.path ? 'isActive' : undefined}
                        aria-current={activePath === item.path ? 'page' : undefined}
                    >
                        {item.label}
                    </Link>
                ))}
            </nav>
            <Link className='siteHeaderLogin' to='/login'>Войти</Link>
        </header>
    )
}

export default SiteHeader
