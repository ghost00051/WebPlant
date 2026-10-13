import IconTile from '../../assets/IconTile.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { TABS } from './tabs.js'
import '../tools/tools.css'
import './dark-theme.css'
import './adaptiv.css'
import './tools.desktop.css'

function Tools({ onTabChange, activeTab }) {
    const selectedTab = activeTab || TABS[0].id

    const handleTabClick = tab => {
        onTabChange?.(tab.id)
    }

    return (
        <div className="toolsWrapper">
            <nav className="tabbar">
                <ul>
                    {TABS.map(tab => (
                        <li
                            key={tab.id}
                            className={tab.id === selectedTab ? 'active' : ''}
                        >
                            <button
                                type='button'
                                className='tabbarButton'
                                onClick={() => handleTabClick(tab)}
                                aria-label={tab.label}
                                aria-current={tab.id === selectedTab ? 'page' : undefined}
                            >
                                <img src={tab.icon} alt="" />
                                <span className="tab-label">{tab.label}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>
            <button
                type="button"
                className="desktopAssistantLink"
                onClick={() => onTabChange?.('chat')}
            >
                <ThemedIcon src={IconTile} alt="" />
                <span>
                    <strong>Спросить ИИ-помощника</strong>
                    <small>Подскажет, когда и как поливать</small>
                </span>
            </button>
        </div>
    )
}

export default Tools