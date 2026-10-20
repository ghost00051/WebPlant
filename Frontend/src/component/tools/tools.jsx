import { useRef, useState } from 'react'
import IconTile from '../../assets/IconTile.svg'
import ThemedIcon from '../ThemedIcon/ThemedIcon'
import { ADD_TAB, PRIMARY_TABS, TAB_ELEMENT_ID, TAB_PANEL_ID } from './tabs.js'
import '../tools/tools.css'
import './dark-theme.css'
import './adaptiv.css'
import './tools.desktop.css'

const TAB_IDS = PRIMARY_TABS.map(tab => tab.id)

function Tools ({ onTabChange, activeTab }) {
    const selectedTab = TAB_IDS.includes(activeTab) ? activeTab : PRIMARY_TABS[0].id
    const [focusedTab, setFocusedTab] = useState(null)
    const buttonsRef = useRef(new Map())

    const tabbableTab = TAB_IDS.includes(focusedTab) ? focusedTab : selectedTab

    const setButtonRef = tabId => node => {
        if (node) {
            buttonsRef.current.set(tabId, node)
        } else {
            buttonsRef.current.delete(tabId)
        }
    }

    const focusTab = tab => {
        setFocusedTab(tab.id)
        buttonsRef.current.get(tab.id)?.focus()
    }

    const handleTabClick = tab => {
        setFocusedTab(tab.id)
        onTabChange?.(tab.id)
    }

    const handleKeyDown = (event, index) => {
        let nextIndex = null

        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            nextIndex = index + 1
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            nextIndex = index - 1
        } else if (event.key === 'Home') {
            nextIndex = 0
        } else if (event.key === 'End') {
            nextIndex = PRIMARY_TABS.length - 1
        }

        if (nextIndex === null) return

        event.preventDefault()
        const nextTab =
            PRIMARY_TABS[(nextIndex + PRIMARY_TABS.length) % PRIMARY_TABS.length]
        focusTab(nextTab)
    }

    return (
        <div className="toolsWrapper">
            <nav className="tabbar" aria-label="Основная навигация">
                <div
                    className="tabbarTabs"
                    role="tablist"
                    aria-label="Разделы приложения"
                >
                    {PRIMARY_TABS.map((tab, index) => {
                        const isActive = tab.id === selectedTab

                        return (
                            <button
                                key={tab.id}
                                ref={setButtonRef(tab.id)}
                                type="button"
                                role="tab"
                                id={TAB_ELEMENT_ID(tab.id)}
                                className={`tabbarButton${isActive ? ' is-active' : ''}`}
                                aria-selected={isActive}
                                aria-controls={isActive ? TAB_PANEL_ID(tab.id) : undefined}
                                tabIndex={tab.id === tabbableTab ? 0 : -1}
                                onClick={() => handleTabClick(tab)}
                                onFocus={() => setFocusedTab(tab.id)}
                                onKeyDown={event => handleKeyDown(event, index)}
                            >
                                <img src={tab.icon} alt="" />
                                <span className="tab-label">{tab.label}</span>
                            </button>
                        )
                    })}
                </div>
                {ADD_TAB && (
                    <button
                        type="button"
                        className="tabbarButton tabbarButtonAdd"
                        aria-label={ADD_TAB.label}
                        onClick={() => onTabChange?.(ADD_TAB.id)}
                    >
                        <img src={ADD_TAB.icon} alt="" />
                        <span className="tab-label">{ADD_TAB.label}</span>
                    </button>
                )}
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
