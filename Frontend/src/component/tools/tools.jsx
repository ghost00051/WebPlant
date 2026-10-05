import Plus from '../../../img/plus-circle.svg'
import Message from '../../../img/message-circle.svg'
import Home from '../../../img/Home.svg'
import Chat from '../../../img/user.svg'
import '../tools/tools.css'
import './adaptiv.css'

const TABS = [
    { id: 'home', icon: Home, label: 'Главная' },
    { id: 'add', icon: Plus, label: 'Добавить' },
    { id: 'chat', icon: Message, label: 'Чат с ИИ' },
    { id: 'profile', icon: Chat, label: 'Профиль' },
]

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
        </div>
    )
}

export default Tools