import React, { useState } from 'react'
import Plus from '../../../img/plus-circle.svg'
import Message from '../../../img/message-circle.svg'
import Home from '../../../img/Home.svg'
import Chat from '../../../img/user.svg'
import '../tools/tools.css'
import './adaptiv.css'

const TABS = [
    { id: 'home',     icon: Home,    label: 'Главная' },
    { id: 'add',      icon: Plus,    label: 'Добавить' },
    { id: 'chat',     icon: Message, label: 'Чат с ИИ' },
    { id: 'profile',  icon: Chat,    label: 'Профиль' },
]

function Tools({ onTabChange }) {
    const [activeIndex, setActiveIndex] = useState(0)

    const handleTabClick = (index) => {
        setActiveIndex(index)
        onTabChange?.(TABS[index].id)
    }

    return (
        <div className="toolsWrapper">
            <nav className="tabbar">
                <ul>
                    {TABS.map((tab, index) => (
                        <li
                            key={tab.id}
                            className={index === activeIndex ? 'active' : ''}
                            onClick={() => handleTabClick(index)}
                            aria-label={tab.label}
                            role="button"
                        >
                            <img src={tab.icon} alt="" />
                            <span className="tab-label">{tab.label}</span>
                        </li>
                    ))}
                </ul>
            </nav>
        </div>
    )
}

export default Tools