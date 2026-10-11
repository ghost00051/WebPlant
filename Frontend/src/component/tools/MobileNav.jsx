import { ADD_TAB, MOBILE_NAV_TABS } from './tabs.js'
import './mobileNav.css'

function MobileNav({ activeTab, onTabChange }) {
    return (
        <nav className='mobileNav' aria-label='Основная навигация'>
            <div className='mobileNav__tabs'>
                {MOBILE_NAV_TABS.map(tab => {
                    const isActive = tab.id === activeTab

                    return (
                        <button
                            key={tab.id}
                            type='button'
                            className={`mobileNav__tab${isActive ? ' is-active' : ''}`}
                            aria-current={isActive ? 'page' : undefined}
                            onClick={() => onTabChange?.(tab.id)}
                        >
                            <img src={tab.icon} alt='' />
                            <span>{tab.label}</span>
                        </button>
                    )
                })}
            </div>
            {ADD_TAB && (
                <button
                    type='button'
                    className='mobileNav__add'
                    aria-label={ADD_TAB.label}
                    onClick={() => onTabChange?.(ADD_TAB.id)}
                >
                    <img src={ADD_TAB.icon} alt='' />
                </button>
            )}
        </nav>
    )
}

export default MobileNav
