import React, { useState, useRef, useEffect } from 'react'
import Tree from '../../../img/Tree.svg'
import Calender from '../../../img/Calender.svg'
import Human from '../../../img/Human.svg'
import Chat from '../../../img/Chat.svg'
import '../tools/tools.css'

const TABS = [
  { id: 'home', icon: Human, label: 'Домашний экран', className: 'homeGo', styleClass: 'homeGod-style' },
  { id: 'tree', icon: Tree, label: 'Добавить растение', className: 'home', styleClass: 'home-style' },
  { id: 'calendar', icon: Calender, label: 'Календарь', className: 'products', styleClass: 'products-style' },
  { id: 'chat', icon: Chat, label: 'Чат', className: 'services', styleClass: 'services-style' },
  { id: 'human', icon: Human, label: 'Личный кабинет', className: 'about', styleClass: 'about-style' },
]

function Tools() {
  const [activeIndex, setActiveIndex] = useState(0)
  const [followLeft, setFollowLeft] = useState(null)
  const listRef = useRef(null)
  const activeTab = TABS[activeIndex]

  useEffect(() => {
    const updatePosition = () => {
      const ul = listRef.current
      if (!ul) return

      const activeLi = ul.querySelector('li.active')
      const follow = ul.querySelector('li.follow')
      if (!activeLi || !follow) return

      const ulRect = ul.getBoundingClientRect()
      const liRect = activeLi.getBoundingClientRect()


      const activeCenter = liRect.left - ulRect.left + liRect.width / 2


      const followWidth = follow.offsetWidth || 60

      setFollowLeft(activeCenter - followWidth / 2)
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [activeIndex])

  return (
    <div className="toolsWrapper">
      <div className={`tabbar tab-style1 ${activeTab.styleClass}`}>
        <ul ref={listRef}>
          {TABS.map((tab, index) => (
            <li
              key={tab.id}
              className={`${tab.className} ${index === activeIndex ? 'active' : ''}`}
              onClick={() => setActiveIndex(index)}
            >
              <img src={tab.icon} alt={tab.label} />
              <span className="tab-label">{tab.label}</span>
            </li>
          ))}

          <li
            className="follow"
            style={followLeft !== null ? { left: `${followLeft}px` } : undefined}
          >
            &nbsp;
          </li>
        </ul>
      </div>
    </div>
  )
}

export default Tools